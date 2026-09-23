import { config } from './config.js';
import { readJson, writeJson } from './state.js';
import { BANNED_PATTERNS } from './guardrails.js';
import { slugify } from './html.js';

const WIDTH = 1200;
const HEIGHT = 675;
const UTM = 'utm_source=avibrantliving_autopilot&utm_medium=referral';

// Skip clinical or cliché imagery the brief asks us to avoid.
const AVOID = /hospital|stethoscope|syringe|pill|medicine|medication|x-?ray|surgery|surgeon|ambulance|patient bed|iv drip|mask|covid|coffin|funeral|cemetery|grave|model posing|isolated on white|studio shot/i;

// Styling words appended to every search to steer toward warm, natural photos.
const STYLE_HINT = 'warm natural light';

const FALLBACK_QUERIES = {
  'family-support': ['adult daughter with elderly mother', 'holding hands elderly', 'grandmother family kitchen'],
  'care-services': ['senior woman sunlit room', 'caregiver with older man', 'seniors garden walk'],
  'planning-resources': ['older couple reviewing papers', 'senior father and son talking', 'elderly woman reading window'],
};

async function getJson(url, headers) {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`${new URL(url).hostname} responded ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

async function searchUnsplash(query) {
  if (!config.images.unsplashKey) return [];
  const url = `https://api.unsplash.com/search/photos?${new URLSearchParams({
    query, orientation: 'landscape', per_page: '20', content_filter: 'high',
  })}`;
  const data = await getJson(url, { Authorization: `Client-ID ${config.images.unsplashKey}`, 'Accept-Version': 'v1' });
  return data.results.map((p) => ({
    provider: 'unsplash',
    id: `unsplash:${p.id}`,
    description: p.alt_description || p.description || '',
    width: p.width,
    downloadUrl: `${p.urls.raw}&${new URLSearchParams({ w: String(WIDTH), h: String(HEIGHT), fit: 'crop', crop: 'faces,entropy', fm: 'jpg', q: '80' })}`,
    trackUrl: p.links.download_location,
    credit: {
      name: p.user.name,
      profileUrl: `${p.user.links.html}?${UTM}`,
      source: 'Unsplash',
      sourceUrl: `https://unsplash.com/?${UTM}`,
    },
  }));
}

async function searchPexels(query) {
  if (!config.images.pexelsKey) return [];
  const url = `https://api.pexels.com/v1/search?${new URLSearchParams({ query, orientation: 'landscape', per_page: '20' })}`;
  const data = await getJson(url, { Authorization: config.images.pexelsKey });
  return data.photos.map((p) => ({
    provider: 'pexels',
    id: `pexels:${p.id}`,
    description: p.alt || '',
    width: p.width,
    downloadUrl: `${p.src.original}?${new URLSearchParams({ auto: 'compress', cs: 'tinysrgb', fit: 'crop', w: String(WIDTH), h: String(HEIGHT) })}`,
    credit: { name: p.photographer, profileUrl: p.photographer_url, source: 'Pexels', sourceUrl: 'https://www.pexels.com' },
  }));
}

function cleanDescription(text) {
  const cleaned = text.replace(/\s+/g, ' ').replace(/[—–]/g, ',').trim().slice(0, 90);
  return BANNED_PATTERNS.some(({ re }) => re.test(cleaned)) ? '' : cleaned;
}

function pick(candidates, usedIds) {
  return candidates.find((c) => !usedIds.has(c.id) && c.width >= WIDTH && !AVOID.test(c.description));
}

async function findOne(queries, usedIds, logger) {
  for (const query of queries) {
    for (const [name, search] of [['Unsplash', searchUnsplash], ['Pexels', searchPexels]]) {
      try {
        for (const q of [`${query} ${STYLE_HINT}`, query]) {
          const choice = pick(await search(q), usedIds);
          if (choice) return { ...choice, query };
        }
      } catch (err) {
        logger?.warn(`${name} search failed for "${query}": ${err.message}`);
      }
    }
  }
  return null;
}

async function download(image) {
  if (image.trackUrl) {
    // Unsplash API guidelines require pinging download_location when a photo is used.
    await fetch(image.trackUrl, { headers: { Authorization: `Client-ID ${config.images.unsplashKey}` } }).catch(() => {});
  }
  const res = await fetch(image.downloadUrl, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`Image download failed (${res.status}) for ${image.id}`);
  return Buffer.from(await res.arrayBuffer());
}

// Returns 3 images: [featured, inlineAfterH2no2, inlineAfterH2no4], each with a buffer ready to upload.
export async function findImages(post, focus, { logger } = {}) {
  const used = readJson(config.paths.imagesUsed, []);
  const usedIds = new Set(used);
  const modelQueries = post.image_queries.slice(0, 3);
  const images = [];

  for (let i = 0; i < 3; i++) {
    const queries = [modelQueries[i], ...modelQueries.filter((_, j) => j !== i), ...FALLBACK_QUERIES[focus]].filter(Boolean);
    const found = await findOne(queries, usedIds, logger);
    if (!found) throw new Error(`No suitable image found (queries tried: ${queries.join('; ')}).`);
    usedIds.add(found.id);
    const descriptor = cleanDescription(found.description) || found.query;
    const role = i === 0 ? 'featured' : `inline-${i}`;
    images.push({
      ...found,
      role,
      alt: `${post.primary_keyword}: ${descriptor}`,
      filename: `${slugify(post.primary_keyword)}-${role}.jpg`,
      buffer: await download(found),
    });
    logger?.info(`Image ${role}: ${found.id} via ${found.provider} ("${found.query}")`);
  }
  return images;
}

export function rememberImages(images) {
  const used = readJson(config.paths.imagesUsed, []);
  writeJson(config.paths.imagesUsed, [...new Set([...used, ...images.map((i) => i.id)])]);
}

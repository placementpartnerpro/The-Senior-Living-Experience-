import { config } from './config.js';
import { BANNED_PATTERNS, SOURCE_DOMAINS, STAT_PATTERN } from './guardrails.js';
import { countWords, stripTags, textBlocks, extractLinks } from './html.js';
import { articleHtml } from './render.js';

export const WORD_MIN = 900;
export const WORD_MAX = 1400;
export const META_MAX = 155;

const hostOf = (url) => {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
};

export const isSourceDomain = (url) => {
  const host = hostOf(url);
  return !!host && SOURCE_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`));
};

export const isInternal = (url) => hostOf(url) === hostOf(config.wp.siteUrl);

const includesPhrase = (text, phrase) => text.toLowerCase().includes(phrase.toLowerCase());

// Synchronous content checks. Returns { errors, warnings, wordCount }.
export function validatePost(post) {
  const errors = [];
  const warnings = [];
  const kw = post.primary_keyword;
  const article = articleHtml(post);
  const wordCount = countWords(article);

  if (wordCount < WORD_MIN || wordCount > WORD_MAX) {
    errors.push(`Article body is ${wordCount} words; it must be between ${WORD_MIN} and ${WORD_MAX}.`);
  }
  if (post.sections.length + 1 < 4 || post.sections.length + 1 > 6) {
    errors.push(`Post has ${post.sections.length + 1} H2 sections (including the closing); it needs 4 to 6.`);
  }

  // SEO placement
  if (!includesPhrase(post.title, kw)) errors.push(`Title must contain the primary keyword "${kw}".`);
  const firstParagraph = textBlocks(post.intro_html).find((b) => b.tag === 'p')?.text ?? '';
  if (!includesPhrase(firstParagraph, kw)) errors.push(`First paragraph must contain the primary keyword "${kw}".`);
  if (![...post.sections, post.closing].some((s) => includesPhrase(s.heading, kw))) {
    errors.push(`At least one H2 heading must contain the primary keyword "${kw}".`);
  }
  if (!includesPhrase(post.meta_description, kw)) errors.push(`Meta description must contain the primary keyword "${kw}".`);
  if (post.meta_description.length > META_MAX) {
    errors.push(`Meta description is ${post.meta_description.length} characters; it must be under ${META_MAX}.`);
  }
  if (post.title.length > 70) warnings.push(`Title is ${post.title.length} characters; search results truncate around 60.`);
  if (post.tags.length < 3) errors.push('Provide at least 3 tags.');

  // Banned language, checked across every piece of visible text.
  const allText = [post.title, post.meta_description, post.tags.join(' '), stripTags(article)].join('\n');
  for (const { label, re } of BANNED_PATTERNS) {
    const hit = allText.match(re);
    if (hit) errors.push(`Remove banned language: ${label} (found "${hit[0]}").`);
  }

  // Links
  const links = extractLinks(article);
  for (const url of links) {
    if (!isInternal(url) && !isSourceDomain(url)) errors.push(`Link to ${url} is not an allowed source. Remove it or use one of the approved sources.`);
  }
  const hasLink = (target) => links.some((url) => url.replace(/\/+$/, '') === target.replace(/\/+$/, ''));
  if (!hasLink(config.facility.servicesUrl)) errors.push(`Body must link naturally to the services page (${config.facility.servicesUrl}).`);
  if (!hasLink(config.facility.contactUrl)) errors.push(`Body must link naturally to the contact page (${config.facility.contactUrl}).`);

  // Statistics must be sourced in the same paragraph or list item.
  for (const block of textBlocks(article)) {
    if (STAT_PATTERN.test(block.text) && !extractLinks(`<p>${block.html}</p>`).some(isSourceDomain)) {
      errors.push(`Unsourced figure in: "${block.text.slice(0, 120)}". Link a real source from the approved list in that same paragraph, or rewrite without the number.`);
    }
  }

  return { errors, warnings, wordCount };
}

// Network check that external source links resolve. Only hard "not found"
// answers count as broken; many sites answer bots with 403, which is not proof
// the page is missing.
export async function findBrokenLinks(post, { timeoutMs = 10000 } = {}) {
  const external = [...new Set(extractLinks(articleHtml(post)).filter((u) => !isInternal(u)))];
  const broken = [];
  await Promise.all(external.map(async (url) => {
    try {
      const res = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
        signal: AbortSignal.timeout(timeoutMs),
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; avibrantliving-autopilot link check)' },
      });
      if (res.status === 404 || res.status === 410) broken.push({ url, reason: `HTTP ${res.status}` });
      res.body?.cancel();
    } catch (err) {
      if (err.cause?.code === 'ENOTFOUND') broken.push({ url, reason: 'domain not found' });
    }
  }));
  return broken;
}

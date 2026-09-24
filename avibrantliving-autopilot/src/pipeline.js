import fs from 'node:fs';
import path from 'node:path';
import { config, FOCI, SLOTS, missingEnv } from './config.js';
import { createLogger, localDate, localHour } from './logger.js';
import { readJson, writeJson } from './state.js';
import { ensureQueue, pickTopic, markTopicUsed } from './topics.js';
import { applyActiveEpisode } from './episodes.js';
import { generatePost } from './generate.js';
import { findImages, rememberImages } from './images.js';
import { renderPost, articleHtml } from './render.js';
import { countWords, escapeHtml, slugify } from './html.js';
import { ensureTerm, uploadMedia, createPost, isLive } from './wordpress.js';
import { sendEmail, successEmail, failureEmail } from './notify.js';

// "auto" maps the current local hour to a slot, or null if no slot is due. The hour after
// each slot also matches, so a delayed hosted-cron run still publishes; the
// already-published check in runSlot keeps that from double-posting.
export function resolveSlot(slot, now = new Date()) {
  if (slot !== 'auto') return SLOTS[slot] ? slot : null;
  const hour = localHour(now);
  return Object.entries(SLOTS).find(([, s]) => hour === s.hour || hour === s.hour + 1)?.[0] ?? null;
}

function alreadyPublished(date, slot) {
  return readJson(config.paths.history, []).some((h) => h.date === date && h.slot === slot && h.outcome === 'published');
}

function recordHistory(entry) {
  const history = readJson(config.paths.history, []);
  history.push(entry);
  writeJson(config.paths.history, history.slice(-1000));
}

function writePreview({ post, html, images, slot, wordCount }) {
  fs.mkdirSync(config.paths.drafts, { recursive: true });
  const file = path.join(config.paths.drafts, `${localDate()}-${slot}-${slugify(post.primary_keyword)}.html`);
  const featured = images?.[0];
  fs.writeFileSync(file, `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(post.title)}</title>
<meta name="description" content="${escapeHtml(post.meta_description)}">
<style>body{font-family:Georgia,serif;max-width:760px;margin:40px auto;padding:0 16px;line-height:1.65;color:#2d2a26}
img{max-width:100%;height:auto;border-radius:6px}figure{margin:24px 0}figcaption{font-size:13px;color:#6b645c}
.seo{font-family:system-ui,sans-serif;font-size:14px;background:#f6f3ef;padding:12px 16px;border-radius:6px;margin-bottom:24px}
.avl-cta{background:#f3efe8;padding:16px 20px;border-radius:6px}.avl-disclaimer{font-size:14px;color:#6b645c}</style></head>
<body>
<div class="seo"><strong>Draft preview</strong> (${escapeHtml(FOCI[SLOTS[slot].focus].category)}, ${wordCount} words)<br>
Keyword: ${escapeHtml(post.primary_keyword)}<br>Slug: /${escapeHtml(slugify(post.primary_keyword))}/<br>
Meta (${post.meta_description.length} chars): ${escapeHtml(post.meta_description)}<br>Tags: ${escapeHtml(post.tags.join(', '))}</div>
${config.wp.includeH1InBody ? '' : `<h1>${escapeHtml(post.title)}</h1>`}
${featured ? `<img src="${escapeHtml(featured.url)}" alt="${escapeHtml(featured.alt)}">` : ''}
${html}
</body></html>
`);
  return file;
}

/**
 * Runs one slot end to end.
 * mode: "publish" (live), "draft" (WordPress draft for review), or "preview" (local HTML only).
 */
export async function runSlot({ slot: requestedSlot, mode = 'publish', force = false }) {
  const slot = resolveSlot(requestedSlot);
  const runId = `${localDate()}-${slot ?? requestedSlot}-${mode}`;
  const logger = createLogger(runId);
  if (!slot) {
    logger.info(`No slot scheduled for local hour ${localHour()} (${config.timezone}); nothing to do.`);
    return { outcome: 'skipped' };
  }
  const date = localDate();
  const focus = SLOTS[slot].focus;
  const category = FOCI[focus].category;
  const status = mode === 'publish' ? config.wp.postStatus : 'draft';

  if (mode === 'publish' && !force && alreadyPublished(date, slot)) {
    logger.info(`The ${slot} slot already published today; skipping (use --force to publish again).`);
    return { outcome: 'skipped' };
  }

  let topic;
  try {
    const episode = applyActiveEpisode(date);
    const needs = mode === 'preview' ? ['generate'] : ['generate', 'images', 'wordpress', 'email'];
    const missing = missingEnv(needs);
    if (missing.length) throw new Error(`Missing configuration in .env: ${missing.join(', ')}`);

    logger.info(`Starting ${mode} run for ${slot} slot (${category}). Featured partner: ${config.facility.name}${episode ? ` (podcast episode ${episode.number}: ${episode.title})` : ' (no live episode; using .env partner)'}.`);
    await ensureQueue({ logger });
    topic = pickTopic(focus);
    if (!topic) throw new Error(`No topics available for focus "${focus}".`);

    const { post, wordCount, attempts } = await generatePost(topic, { logger });
    logger.info(`Draft passed all checks after ${attempts} attempt(s): "${post.title}" (${wordCount} words).`);

    const canFetchImages = !missingEnv(['images']).length;
    const images = canFetchImages ? await findImages(post, focus, { logger }) : null;
    if (!images) logger.warn('No image API key configured; preview will have no images.');

    if (mode === 'preview') {
      const html = renderPost(post, { inline: images?.slice(1).map((img) => ({ ...img, url: img.downloadUrl })) });
      const file = writePreview({ post, html, images: images?.map((img) => ({ ...img, url: img.downloadUrl })), slot, wordCount });
      logger.info(`Preview written to ${file}`);
      return { outcome: 'preview', file, post };
    }

    const [categoryId, ...tagIds] = await Promise.all([
      ensureTerm('categories', category),
      ...post.tags.map((tag) => ensureTerm('tags', tag)),
    ]);
    const uploaded = [];
    for (const image of images) {
      uploaded.push({ ...image, ...(await uploadMedia(image, { title: post.title })) });
    }
    logger.info('Uploaded images to media library', uploaded.map((u) => u.mediaId));

    const content = renderPost(post, { inline: uploaded.slice(1) });
    const slug = slugify(post.primary_keyword);
    const wpPost = await createPost({
      title: post.title,
      content,
      slug,
      excerpt: post.meta_description,
      status,
      categoryId,
      tagIds,
      featuredMediaId: uploaded[0].mediaId,
      keyword: post.primary_keyword,
      metaDescription: post.meta_description,
    });
    const url = status === 'publish' ? wpPost.link : `${config.wp.siteUrl}/?p=${wpPost.id}&preview=true`;
    logger.info(`WordPress post ${wpPost.id} created with status "${wpPost.status}": ${url}`);

    if (status === 'publish' && !(await isLive(url))) {
      logger.warn(`Post created but ${url} did not return 200 yet (caching or security plugin?).`);
    }

    const preview = writePreview({ post, html: content, images: uploaded, slot, wordCount: countWords(articleHtml(post)) });
    if (mode === 'publish') {
      markTopicUsed(topic, { title: post.title, url, keyword: post.primary_keyword });
      rememberImages(uploaded);
      recordHistory({ date, slot, outcome: 'published', at: new Date().toISOString(), postId: wpPost.id, title: post.title, url, partner: config.facility.name, episode: episode?.number });
    }

    await sendEmail(successEmail({
      title: post.title,
      url,
      keyword: post.primary_keyword,
      wordCount,
      publishedAt: new Date(),
      thumbnailUrl: uploaded[0].url,
      category,
      status,
      partner: config.facility.name,
      episode,
    }));
    logger.info(`Confirmation email sent to ${config.email.to}.`);
    return { outcome: status === 'publish' ? 'published' : 'draft', url, postId: wpPost.id, preview, post };
  } catch (error) {
    logger.error(error.stack || String(error));
    if (mode === 'publish') {
      recordHistory({ date, slot, outcome: 'failed', at: new Date().toISOString(), error: error.message, topic: topic?.topic });
    }
    if (error.draft?.post) {
      const file = writePreview({ ...error.draft, html: renderPost(error.draft.post), slot });
      logger.info(`Rejected draft saved for inspection: ${file}`);
    }
    try {
      if (!missingEnv(['email']).length) {
        await sendEmail(failureEmail({ slot, topic, error, logLines: logger.lines }));
        logger.info(`Failure email sent to ${config.email.to}.`);
      } else {
        logger.error('Email is not configured, so no failure email could be sent.');
      }
    } catch (mailError) {
      logger.error(`Failure email could not be sent: ${mailError.message}`);
    }
    throw error;
  }
}

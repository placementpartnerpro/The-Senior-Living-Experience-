import { config } from './config.js';
import { decodeEntities } from './html.js';

function authHeader() {
  return `Basic ${Buffer.from(`${config.wp.user}:${config.wp.appPassword}`).toString('base64')}`;
}

export async function wpFetch(path, { method = 'GET', json, body, headers = {} } = {}) {
  const res = await fetch(`${config.wp.siteUrl}/wp-json/wp/v2${path}`, {
    method,
    headers: {
      Authorization: authHeader(),
      ...(json ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: json ? JSON.stringify(json) : body,
    signal: AbortSignal.timeout(60000),
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const err = new Error(`WordPress ${method} ${path} failed (${res.status}): ${data?.message ?? String(text).slice(0, 300)}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

// Finds a category or tag by exact name, creating it if missing.
export async function ensureTerm(taxonomy, name) {
  const found = await wpFetch(`/${taxonomy}?${new URLSearchParams({ search: name, per_page: '100' })}`);
  const match = found.find((t) => decodeEntities(t.name).toLowerCase() === name.toLowerCase());
  if (match) return match.id;
  try {
    return (await wpFetch(`/${taxonomy}`, { method: 'POST', json: { name } })).id;
  } catch (err) {
    if (err.data?.code === 'term_exists') return err.data.data.term_id;
    throw err;
  }
}

export async function uploadMedia(image, { title }) {
  const media = await wpFetch('/media', {
    method: 'POST',
    body: image.buffer,
    headers: {
      'Content-Type': 'image/jpeg',
      'Content-Disposition': `attachment; filename="${image.filename}"`,
    },
  });
  const caption = image.credit ? `Photo by ${image.credit.name} on ${image.credit.source}` : '';
  await wpFetch(`/media/${media.id}`, { method: 'POST', json: { alt_text: image.alt, caption, title } });
  return { mediaId: media.id, url: media.source_url };
}

// Meta keys for Yoast and Rank Math are only writable if registered for REST;
// see wordpress/avl-autopilot-seo-meta.php. WordPress ignores unregistered keys.
export async function createPost({ title, content, slug, excerpt, status, categoryId, tagIds, featuredMediaId, keyword, metaDescription }) {
  return wpFetch('/posts', {
    method: 'POST',
    json: {
      title,
      content,
      slug,
      excerpt,
      status,
      categories: [categoryId],
      tags: tagIds,
      featured_media: featuredMediaId,
      meta: {
        _yoast_wpseo_metadesc: metaDescription,
        _yoast_wpseo_focuskw: keyword,
        rank_math_description: metaDescription,
        rank_math_focus_keyword: keyword,
      },
    },
  });
}

export async function checkAuth() {
  return wpFetch('/users/me?context=edit');
}

export async function isLive(url) {
  const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(30000) });
  res.body?.cancel();
  return res.ok;
}

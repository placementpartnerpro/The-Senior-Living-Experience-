// End-to-end run of the publish pipeline with every external HTTP call mocked:
// Anthropic, Unsplash, image CDN, WordPress REST, the published page, and SendGrid.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

Object.assign(process.env, {
  ANTHROPIC_API_KEY: 'test-key',
  ANTHROPIC_BASE_URL: 'https://api.anthropic.test',
  WP_SITE_URL: 'https://www.avibrantliving.com',
  WP_USER: 'julie',
  WP_APP_PASSWORD: 'abcd efgh ijkl mnop',
  FACILITY_NAME: 'Test Facility',
  FACILITY_PHONE: '(619) 555-0100',
  ADVISOR_PHONE: '(858) 555-0199',
  UNSPLASH_ACCESS_KEY: 'unsplash-key',
  NOTIFY_EMAIL: 'office@example.com',
  EMAIL_FROM: 'autopilot@example.com',
  SENDGRID_API_KEY: 'sg-key',
});

const { config } = await import('../src/config.js');
const { runSlot } = await import('../src/pipeline.js');
const { DISCLAIMER } = await import('../src/guardrails.js');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'avl-'));
fs.copyFileSync(config.paths.topics, path.join(tmp, 'topics.json'));
Object.assign(config.paths, {
  topics: path.join(tmp, 'topics.json'),
  topicsUsed: path.join(tmp, 'state/topics-used.json'),
  history: path.join(tmp, 'state/history.json'),
  imagesUsed: path.join(tmp, 'state/images-used.json'),
  logs: path.join(tmp, 'logs'),
  drafts: path.join(tmp, 'drafts'),
});

const filler = (n) => Array.from({ length: n }, (_, i) => `Many families take this one gentle step at a time, and that is okay, note ${i}.`).join(' ');
const draft = (keyword) => ({
  title: `${keyword[0].toUpperCase()}${keyword.slice(1)}: A Gentle Guide`,
  primary_keyword: keyword,
  meta_description: `Gentle guidance on the ${keyword}, how to talk with your mom, and where San Diego families can find support.`,
  tags: ['assisted living', 'family caregivers', 'aging parents', 'san diego'],
  intro_html: `<p>Noticing the ${keyword} can feel heavy.</p><p>${filler(3)}</p>`,
  sections: [
    { heading: `Common ${keyword}`, body_html: `<p>${filler(17)}</p>` },
    { heading: 'Starting the conversation', body_html: `<p>${filler(17)} Learn about <a href="https://www.avibrantliving.com/services/">our care options</a>.</p>` },
    { heading: 'Caring for yourself', body_html: `<ul><li>${filler(8)}</li><li>${filler(8)}</li></ul>` },
    { heading: 'What families often find', body_html: `<p>${filler(17)}</p>` },
  ],
  closing: { heading: 'A calm next step', body_html: `<p>${filler(8)} Please <a href="https://www.theseniorlivingexperience.com/contact/">talk with an advisor</a> anytime.</p>` },
  image_queries: ['daughter with elderly mother', 'holding hands', 'sunlit garden'],
});

const calls = [];
let wpId = 100;
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === 'string' ? input : input.url;
  const method = init.method ?? (typeof input === 'object' ? input.method : 'GET') ?? 'GET';
  const body = init.body ?? (typeof input === 'object' && input.body ? await input.text() : undefined);
  calls.push({ method, url, body });
  const u = new URL(url);

  if (u.hostname === 'api.anthropic.test') {
    const req = JSON.parse(body);
    const kw = req.messages[0].content.match(/use exactly this phrase\): "([^"]+)"/)[1];
    return json({
      id: 'msg_test', type: 'message', role: 'assistant', model: req.model,
      content: [{ type: 'text', text: JSON.stringify(draft(kw)) }],
      stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1000, output_tokens: 2000 },
    });
  }
  if (u.hostname === 'api.unsplash.com' && u.pathname === '/search/photos') {
    const q = u.searchParams.get('query');
    return json({ results: [0, 1, 2].map((i) => ({
      id: `${q.replace(/\W/g, '')}-${i}`, width: 4000, alt_description: i === 0 ? 'doctor with stethoscope in hospital' : `a warm moment ${i}`,
      urls: { raw: `https://images.unsplash.test/photo-${i}?ixid=abc` },
      links: { download_location: `https://api.unsplash.com/photos/${i}/download` },
      user: { name: 'Jane Photographer', links: { html: 'https://unsplash.com/@jane' } },
    })) });
  }
  if (u.hostname === 'api.unsplash.com') return json({ url: 'ok' });
  if (u.hostname === 'images.unsplash.test') return new Response(Buffer.from('fakejpeg'), { status: 200 });
  if (u.hostname === 'www.avibrantliving.com' && u.pathname.startsWith('/wp-json/wp/v2/')) {
    const route = u.pathname.replace('/wp-json/wp/v2', '');
    if (/^\/(categories|tags)$/.test(route) && method === 'GET') return json(route === '/categories' ? [{ id: 7, name: 'Family Support' }] : []);
    if (/^\/(categories|tags)$/.test(route)) return json({ id: ++wpId, name: JSON.parse(body).name }, 201);
    if (route === '/media') return json({ id: ++wpId, source_url: `https://www.avibrantliving.com/wp-content/uploads/${wpId}.jpg` }, 201);
    if (route.startsWith('/media/')) return json({ id: Number(route.split('/')[2]) });
    if (route === '/posts') {
      const p = JSON.parse(body);
      return json({ id: 555, status: p.status, link: `https://www.avibrantliving.com/${p.slug}/` }, 201);
    }
  }
  if (['www.avibrantliving.com', 'www.theseniorlivingexperience.com'].includes(u.hostname)) return new Response('ok', { status: 200 });
  if (u.hostname === 'api.sendgrid.com') return new Response('', { status: 202 });
  throw new Error(`Unmocked fetch: ${method} ${url}`);
};

test('publish run creates a complete post, emails Julie, and consumes the topic', async () => {
  const before = JSON.parse(fs.readFileSync(config.paths.topics, 'utf8'));
  const result = await runSlot({ slot: 'morning', mode: 'publish' });
  assert.equal(result.outcome, 'published');
  assert.equal(result.url, 'https://www.avibrantliving.com/signs-it-is-time-for-assisted-living/');

  const ai = JSON.parse(calls.find((c) => c.url.includes('anthropic.test')).body);
  assert.equal(ai.fallbacks, 'default');
  assert.equal(ai.output_config.format.type, 'json_schema');

  const media = calls.filter((c) => c.url.endsWith('/wp-json/wp/v2/media') && c.method === 'POST');
  assert.equal(media.length, 3, 'three images uploaded');
  const altUpdates = calls.filter((c) => /\/media\/\d+$/.test(c.url)).map((c) => JSON.parse(c.body));
  assert.ok(altUpdates.every((m) => m.alt_text.startsWith('signs it is time for assisted living: ')));
  assert.ok(altUpdates.every((m) => !/stethoscope/.test(m.alt_text)), 'clinical image skipped');
  assert.ok(calls.some((c) => c.url.includes('images.unsplash.test') && c.url.includes('w=1200') && c.url.includes('h=675')));
  assert.ok(calls.some((c) => c.url.includes('/photos/') && c.url.endsWith('/download')), 'Unsplash download tracked');

  const post = JSON.parse(calls.find((c) => c.url.endsWith('/wp-json/wp/v2/posts')).body);
  assert.equal(post.status, 'publish');
  assert.equal(post.slug, 'signs-it-is-time-for-assisted-living');
  assert.deepEqual(post.categories, [7]);
  assert.equal(post.tags.length, 4);
  assert.ok(post.featured_media > 0);
  assert.equal((post.content.match(/<figure/g) || []).length, 2);
  assert.ok(post.content.includes(DISCLAIMER));
  assert.equal(post.meta._yoast_wpseo_focuskw, 'signs it is time for assisted living');

  const mail = JSON.parse(calls.find((c) => c.url.includes('sendgrid')).body);
  assert.equal(mail.subject, 'The Senior Living Experience Published: Signs it is time for assisted living: A Gentle Guide');
  const mailHtml = mail.content.find((c) => c.type === 'text/html').value;
  for (const bit of ['signs-it-is-time-for-assisted-living/', 'Word count', '<img src="https://www.avibrantliving.com/wp-content/uploads/']) {
    assert.ok(mailHtml.includes(bit), `email includes ${bit}`);
  }

  const after = JSON.parse(fs.readFileSync(config.paths.topics, 'utf8'));
  assert.equal(after.length, before.length - 1);
  assert.ok(fs.readdirSync(config.paths.logs)[0].match(/^publish-\d{4}-\d{2}-\d{2}\.log$/));
});

test('a second run in the same slot and day is skipped', async () => {
  const result = await runSlot({ slot: 'morning', mode: 'publish' });
  assert.equal(result.outcome, 'skipped');
});

test('a failure sends an error email with the trace and does not consume the topic', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    if (url.endsWith('/wp-json/wp/v2/posts')) return json({ code: 'rest_cannot_create', message: 'Sorry, you are not allowed to create posts.' }, 401);
    return realFetch(input, init);
  };
  const before = fs.readFileSync(config.paths.topics, 'utf8');
  calls.length = 0;
  await assert.rejects(runSlot({ slot: 'midday', mode: 'publish' }), /not allowed to create posts/);
  globalThis.fetch = realFetch;

  const mail = JSON.parse(calls.find((c) => c.url.includes('sendgrid')).body);
  assert.match(mail.subject, /Publishing FAILED: midday/);
  assert.match(mail.content[0].value, /not allowed to create posts/);
  assert.equal(fs.readFileSync(config.paths.topics, 'utf8'), before);
});

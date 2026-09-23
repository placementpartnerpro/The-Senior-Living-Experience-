import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.WP_SITE_URL = 'https://www.avibrantliving.com';
process.env.FACILITY_NAME = 'Test Facility';
process.env.FACILITY_PHONE = '(619) 555-0100';

const { validatePost } = await import('../src/validate.js');
const { normalizeDraft, renderPost } = await import('../src/render.js');
const { sanitizeFragment, slugify, countWords } = await import('../src/html.js');
const { resolveSlot } = await import('../src/pipeline.js');
const { DISCLAIMER } = await import('../src/guardrails.js');

const filler = (n) => Array.from({ length: n }, (_, i) => `Families often take this one step at a time, and that is okay, sentence ${i}.`).join(' ');

function goodDraft(overrides = {}) {
  return {
    title: 'Signs It Is Time for Assisted Living for Your Mom',
    primary_keyword: 'signs it is time for assisted living',
    meta_description: 'Gentle guidance on the signs it is time for assisted living, how to talk with your mom, and where to find support.',
    tags: ['assisted living', 'caregiver support', '#family'],
    intro_html: '<p>Noticing the signs it is time for assisted living can feel heavy. You are not alone in this.</p>',
    sections: [
      { heading: 'What the signs it is time for assisted living look like', body_html: `<p>${filler(18)}</p>` },
      { heading: 'Starting the conversation', body_html: `<p>${filler(18)} See <a href="https://www.avibrantliving.com/services/">our services</a>.</p>` },
      { heading: 'Caring for yourself', body_html: `<ul><li>${filler(9)}</li><li>${filler(9)}</li></ul>` },
      { heading: 'What families often find', body_html: `<p>${filler(18)}</p>` },
    ],
    closing: { heading: 'A gentle next step', body_html: `<p>${filler(10)} You can always <a href="https://www.avibrantliving.com/contact/">reach out to our team</a>.</p>` },
    image_queries: ['daughter and mother', 'holding hands', 'sunlit room'],
    ...overrides,
  };
}

test('a compliant draft passes validation', () => {
  const post = normalizeDraft(goodDraft());
  const result = validatePost(post);
  assert.deepEqual(result.errors, []);
  assert.ok(result.wordCount >= 900 && result.wordCount <= 1400, `word count ${result.wordCount}`);
  assert.deepEqual(post.tags, ['assisted living', 'caregiver support', 'family']);
});

test('banned phrases, em dashes, and emojis are rejected', () => {
  const post = normalizeDraft(goodDraft({
    intro_html: '<p>Noticing the signs it is time for assisted living for a loved one is hard — we delve into it here \u{1F60A}.</p>',
  }));
  const errors = validatePost(post).errors.join('\n');
  assert.match(errors, /loved one/);
  assert.match(errors, /em dash/);
  assert.match(errors, /delve/);
  assert.match(errors, /emoji/);
});

test('SEO placement is enforced', () => {
  const post = normalizeDraft(goodDraft({
    title: 'When Mom Needs More Help',
    meta_description: 'x'.repeat(160),
    intro_html: '<p>This is hard.</p>',
  }));
  const errors = validatePost(post).errors.join('\n');
  assert.match(errors, /Title must contain/);
  assert.match(errors, /First paragraph/);
  assert.match(errors, /Meta description is 160/);
});

test('unsourced statistics and off-list links are rejected; sourced ones pass', () => {
  const bad = normalizeDraft(goodDraft({
    sections: [...goodDraft().sections.slice(0, 3), { heading: 'Numbers', body_html: `<p>About 60% of caregivers feel this way. ${filler(17)}</p><p>Read <a href="https://example.com/blog">this</a>.</p>` }],
  }));
  const errors = validatePost(bad).errors.join('\n');
  assert.match(errors, /Unsourced figure/);
  assert.match(errors, /example\.com.*not an allowed source/);

  const good = normalizeDraft(goodDraft({
    sections: [...goodDraft().sections.slice(0, 3), { heading: 'Numbers', body_html: `<p>According to the <a href="https://www.alz.org/alzheimers-dementia/facts-figures">Alzheimer's Association</a>, 11 million people provide unpaid care. ${filler(17)}</p>` }],
  }));
  assert.deepEqual(validatePost(good).errors, []);
});

test('missing internal links are flagged', () => {
  const post = normalizeDraft(goodDraft({
    sections: goodDraft().sections.map((s) => ({ ...s, body_html: s.body_html.replace(/<a [^>]+>|<\/a>/g, '') })),
    closing: { heading: 'Next', body_html: `<p>${filler(10)}</p>` },
  }));
  const errors = validatePost(post).errors.join('\n');
  assert.match(errors, /services page/);
  assert.match(errors, /contact page/);
});

test('renderer places images after the 2nd and 4th H2 and ends with CTA and disclaimer', () => {
  const post = normalizeDraft(goodDraft());
  const img = (n) => ({ url: `https://cdn.test/${n}.jpg`, alt: `${post.primary_keyword}: photo ${n}`, mediaId: n, credit: { name: 'A', profileUrl: 'https://u.test/a', source: 'Unsplash', sourceUrl: 'https://unsplash.com' } });
  const html = renderPost(post, { inline: [img(2), img(3)] }, { includeH1: true });
  const order = [...html.matchAll(/<h1>|<h2>|<figure/g)].map((m) => m[0]);
  assert.deepEqual(order, ['<h1>', '<h2>', '<h2>', '<figure', '<h2>', '<h2>', '<figure', '<h2>']);
  assert.ok(html.indexOf('avl-cta') < html.indexOf(DISCLAIMER));
  assert.ok(html.trim().endsWith('</em></p>'));
  assert.match(html, /tel:6195550100/);
  assert.match(html, /alt="signs it is time for assisted living: photo 2"/);
});

test('sanitizer strips unsafe markup and demotes headings', () => {
  const out = sanitizeFragment('<h2 class="x">Hi</h2><script>alert(1)</script><p style="c" onclick="y">Text <a href="javascript:bad()">link</a> <a href="https://alz.org" target="_blank">ok</a></p><div>d</div>');
  assert.equal(out, '<h3>Hi</h3><p>Text link <a href="https://alz.org">ok</a></p>d');
});

test('slugify and word count', () => {
  assert.equal(slugify('Assisted Living vs. Memory Care & You!'), 'assisted-living-vs-memory-care-and-you');
  assert.equal(countWords('<p>One two <strong>three</strong></p><ul><li>four</li></ul>'), 4);
});

test('auto slot resolves from Los Angeles local time, across DST', () => {
  assert.equal(resolveSlot('auto', new Date('2026-07-01T15:05:00Z')), 'morning'); // 8:05 PDT
  assert.equal(resolveSlot('auto', new Date('2026-12-01T16:05:00Z')), 'morning'); // 8:05 PST
  assert.equal(resolveSlot('auto', new Date('2026-12-01T15:05:00Z')), null); // 7:05 PST
  assert.equal(resolveSlot('auto', new Date('2026-07-01T16:05:00Z')), 'morning'); // 9:05 PDT catch-up
  assert.equal(resolveSlot('auto', new Date('2026-07-01T17:05:00Z')), null); // 10:05 PDT
  assert.equal(resolveSlot('auto', new Date('2026-07-02T00:10:00Z')), 'evening'); // 17:10 PDT
  assert.equal(resolveSlot('midday'), 'midday');
});

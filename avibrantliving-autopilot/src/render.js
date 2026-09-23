import { config } from './config.js';
import { DISCLAIMER } from './guardrails.js';
import { escapeHtml, sanitizeFragment, ensureBlocks } from './html.js';

// Model output -> clean fragments. Kept separate from render so the validator
// sees exactly what will be published.
export function normalizeDraft(draft) {
  return {
    ...draft,
    title: draft.title.trim(),
    primary_keyword: draft.primary_keyword.trim().toLowerCase(),
    meta_description: draft.meta_description.trim(),
    tags: [...new Set(draft.tags.map((t) => t.replace(/#/g, '').trim()).filter(Boolean))],
    intro_html: ensureBlocks(sanitizeFragment(draft.intro_html)),
    sections: draft.sections.map((s) => ({ heading: s.heading.trim(), body_html: ensureBlocks(sanitizeFragment(s.body_html)) })),
    closing: { heading: draft.closing.heading.trim(), body_html: ensureBlocks(sanitizeFragment(draft.closing.body_html)) },
  };
}

function figure(image) {
  if (!image) return '';
  const idClass = image.mediaId ? ` class="wp-image-${image.mediaId}"` : '';
  const credit = image.credit
    ? `<figcaption>Photo by <a href="${escapeHtml(image.credit.profileUrl)}" rel="noopener">${escapeHtml(image.credit.name)}</a> on <a href="${escapeHtml(image.credit.sourceUrl)}" rel="noopener">${escapeHtml(image.credit.source)}</a></figcaption>`
    : '';
  return `<figure class="wp-block-image size-large"><img src="${escapeHtml(image.url)}" alt="${escapeHtml(image.alt)}" width="1200" height="675"${idClass} loading="lazy" />${credit}</figure>`;
}

export function ctaBlock() {
  const f = config.facility;
  const phoneHref = f.phone.replace(/[^\d+]/g, '');
  const guide = f.familyGuideUrl
    ? ` You can also <a href="${escapeHtml(f.familyGuideUrl)}">download our free family guide</a> to read at your own pace.`
    : '';
  return `<div class="avl-cta">
<p><strong>We are here when you are ready.</strong> If you would like to see ${escapeHtml(f.name)} in person, meet our team, and ask your questions without any pressure, <a href="${escapeHtml(f.ctaUrl)}">${escapeHtml(f.ctaLabel.toLowerCase())}</a> or call us at <a href="tel:${escapeHtml(phoneHref)}">${escapeHtml(f.phone)}</a>.${guide} To learn more about assisted living, memory care, respite care, and long-term care with us, <a href="${escapeHtml(f.servicesUrl)}">explore our services</a>.</p>
</div>`;
}

export function disclaimerBlock() {
  return `<hr class="avl-divider" />
<p class="avl-disclaimer"><em>${escapeHtml(DISCLAIMER)}</em></p>`;
}

// Images: { inline: [imageAfterH2no2, imageAfterH2no4] }. The featured image is set via
// the WordPress featured_media field, not in the body.
export function renderPost(post, images = {}, { includeH1 = config.wp.includeH1InBody } = {}) {
  const parts = [];
  if (includeH1) parts.push(`<h1>${escapeHtml(post.title)}</h1>`);
  parts.push(post.intro_html);

  const h2s = [...post.sections, post.closing];
  h2s.forEach((section, index) => {
    parts.push(`<h2>${escapeHtml(section.heading)}</h2>`);
    if (index === 1) parts.push(figure(images.inline?.[0]));
    if (index === 3) parts.push(figure(images.inline?.[1]));
    parts.push(section.body_html);
  });

  parts.push(ctaBlock());
  parts.push(disclaimerBlock());
  return parts.filter(Boolean).join('\n\n');
}

// The part of the post that counts toward the 900-1400 word target: the article
// itself, without captions, the standard CTA box, or the disclaimer.
export function articleHtml(post) {
  return [post.intro_html, ...[...post.sections, post.closing].flatMap((s) => [`<h2>${escapeHtml(s.heading)}</h2>`, s.body_html])].join('\n');
}

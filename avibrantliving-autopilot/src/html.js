const ALLOWED_TAGS = new Set(['p', 'ul', 'ol', 'li', 'strong', 'em', 'a', 'h3', 'br']);

export const escapeHtml = (text) =>
  String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function decodeEntities(text) {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

export function stripTags(html) {
  return decodeEntities(html.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

export function countWords(html) {
  const text = stripTags(html);
  return text ? text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length : 0;
}

export function slugify(text) {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/, '');
}

// Keep only simple formatting tags from model output. Anchors keep only href;
// everything else loses its attributes. Headings above h3 are demoted because
// the renderer owns the H1/H2 structure.
export function sanitizeFragment(html) {
  return html
    .replace(/<(script|style|iframe|object|embed)[\s\S]*?<\/\1>/gi, '')
    .replace(/<\/?h[12456]\b[^>]*>/gi, (tag) => tag.replace(/h[12456]/i, 'h3'))
    .replace(/<(\/?)([a-z0-9]+)\b([^>]*)>/gi, (match, slash, rawTag, attrs) => {
      const tag = rawTag.toLowerCase();
      if (!ALLOWED_TAGS.has(tag)) return '';
      if (slash) return `</${tag}>`;
      if (tag === 'a') {
        const href = attrs.match(/href\s*=\s*["']([^"']+)["']/i)?.[1];
        return href && /^https?:\/\//i.test(href) ? `<a href="${escapeHtml(href)}">` : '<a>';
      }
      return `<${tag}>`;
    })
    .replace(/<a>([\s\S]*?)<\/a>/g, '$1')
    .trim();
}

// Wrap bare text in a paragraph so every block is a <p>, list, or <h3>.
export function ensureBlocks(html) {
  const trimmed = html.trim();
  return /^<(p|ul|ol|h3)>/i.test(trimmed) ? trimmed : `<p>${trimmed}</p>`;
}

// Returns [{ tag, html, text }] for each <p> and <li> in the fragment.
export function textBlocks(html) {
  const blocks = [];
  for (const match of html.matchAll(/<(p|li|h[1-3])>([\s\S]*?)<\/\1>/gi)) {
    blocks.push({ tag: match[1].toLowerCase(), html: match[2], text: stripTags(match[2]) });
  }
  return blocks;
}

export function extractLinks(html) {
  return [...html.matchAll(/<a\s+href="([^"]+)"/gi)].map((m) => decodeEntities(m[1]));
}

export function unwrapLink(html, url) {
  const escaped = escapeHtml(url).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return html.replace(new RegExp(`<a href="${escaped}">([\\s\\S]*?)</a>`, 'g'), '$1');
}

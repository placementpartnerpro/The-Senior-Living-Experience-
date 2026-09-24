import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { config, FOCI } from './config.js';
import { guardrailPromptText } from './guardrails.js';
import { generateStructured } from './anthropic.js';
import { normalizeDraft } from './render.js';
import { validatePost, findBrokenLinks, WORD_MIN, WORD_MAX, META_MAX } from './validate.js';

const MAX_ATTEMPTS = 3;

const Section = z.object({
  heading: z.string(),
  body_html: z.string(),
});

const PostDraft = z.object({
  title: z.string(),
  primary_keyword: z.string(),
  meta_description: z.string(),
  tags: z.array(z.string()),
  intro_html: z.string(),
  sections: z.array(Section),
  closing: Section,
  image_queries: z.array(z.string()),
});

export function loadTemplate(focus) {
  return fs.readFileSync(path.join(config.paths.templates, `${focus}.md`), 'utf8');
}

function systemPrompt(focus) {
  const b = config.brand;
  const f = config.facility;
  return `You write blog posts for ${b.name}, a senior living advisory service that helps families in ${f.city} understand their options and find the right care for a parent or spouse. Write as the ${b.name} team ("we" means our advisors, never a care facility). We are on the family's side: we explain options honestly, including in-home care and other communities, and we never pressure anyone toward a particular choice.

${b.name} partners with ${f.name}, a community in ${f.city} offering assisted living, memory care, respite care, and long-term care. You may mention ${f.name} once in the body where it is genuinely relevant (for example as one example of a community offering the care being discussed), always as a partner community, never as "us" or "our community", and never as the only good option. Do not make claims about ${f.name}'s staffing, prices, ratings, or outcomes.

Readers: adult children researching care for an aging parent, spouses of someone living with dementia or a chronic illness, hospital discharge planners, social workers, and referring physicians. Many are tired, grieving, worried about money, and short on time.

Voice: warm, trustworthy, calm, and informed. Write like a compassionate professional who has walked hundreds of families through this decision. Plain language, short paragraphs, concrete examples. No sales pressure, no fear tactics, no clinical coldness. Acknowledge the reader's grief, fatigue, and financial worry without dwelling on it.

${guardrailPromptText()}

Template and guidance for this post's focus area (${FOCI[focus].category}):
<template>
${loadTemplate(focus)}
</template>`;
}

function userPrompt(topic) {
  const b = config.brand;
  const f = config.facility;
  return `Write one blog post on this topic: "${topic.topic}"
${topic.keyword ? `Primary keyword (use exactly this phrase): "${topic.keyword}"` : 'Choose one realistic long-tail primary keyword (3 to 7 words, lowercase) for this topic.'}
${topic.notes ? `Notes from our team: ${topic.notes}\n` : ''}
Return JSON with these fields:
- title: the post title (it is also the H1). Contains the primary keyword exactly. Aim for 50 to 65 characters.
- primary_keyword: the exact keyword phrase, lowercase.
- meta_description: under ${META_MAX} characters (aim for 130 to 150), contains the primary keyword, reads as a calm invitation, no quotation marks.
- tags: 4 to 6 short tags, plain words, no # symbols.
- intro_html: an empathetic opening hook of 2 or 3 <p> paragraphs. The FIRST paragraph must contain the primary keyword exactly.
- sections: 4 or 5 body sections, each with a "heading" (plain text, no HTML) and "body_html". At least one heading contains the primary keyword exactly. Use <p>, <ul>/<ol> with <li>, <strong>, <em>, <h3>, and <a href="..."> only. Use bulleted lists where they genuinely help a tired reader scan.
- closing: one final section with a heading and body_html that gently summarizes and points toward a next step (a free conversation with one of our advisors, a tour, or a talk with family). Do not start it with "In conclusion". Do not add phone numbers; a contact box is appended automatically after it.
- image_queries: exactly 3 short stock-photo search phrases (2 to 5 words) for warm, natural, dignified imagery related to this post: older adults with family, hands held, sunlit rooms, gardens, caregivers in real everyday moments. Avoid hospitals and medical equipment.

Across intro_html, sections, and closing the post must total ${WORD_MIN + 100} to ${WORD_MAX - 100} words.

Somewhere in the body, link naturally (in running text, not as a list of links) to:
- our advisor contact page: <a href="${b.ctaUrl}">...</a> (for example "talk with one of our advisors")
- ${f.name}'s care services page: <a href="${f.servicesUrl}">...</a> (for example where assisted living or memory care is described)`;
}

// Generates a post, validating and asking for revisions until it passes or attempts run out.
export async function generatePost(topic, { logger, checkLinks = true } = {}) {
  let prompt = userPrompt(topic);
  let last;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    logger?.info(`Generating post (attempt ${attempt}/${MAX_ATTEMPTS}) for topic: ${topic.topic}`);
    const { data, usage } = await generateStructured({ system: systemPrompt(topic.focus), prompt, schema: PostDraft });
    logger?.info('Model usage', { input: usage.input_tokens, output: usage.output_tokens });

    const post = normalizeDraft(data);
    const result = validatePost(post);
    if (checkLinks && result.errors.length === 0) {
      for (const { url, reason } of await findBrokenLinks(post)) {
        result.errors.push(`Source link ${url} is broken (${reason}). Replace it with a page you are confident exists or rewrite without it.`);
      }
    }
    result.warnings.forEach((w) => logger?.warn(w));
    last = { post, ...result, attempts: attempt };
    if (result.errors.length === 0) return last;

    logger?.warn(`Draft failed ${result.errors.length} check(s)`, result.errors);
    prompt = `${userPrompt(topic)}

Your previous draft is below as JSON. Revise it to fix every problem listed, keeping what already works.

Problems:
${result.errors.map((e) => `- ${e}`).join('\n')}

Previous draft:
${JSON.stringify(data)}`;
  }
  const err = new Error(`Post failed validation after ${MAX_ATTEMPTS} attempts:\n- ${last.errors.join('\n- ')}`);
  err.draft = last;
  throw err;
}

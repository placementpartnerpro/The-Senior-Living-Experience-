import crypto from 'node:crypto';
import { z } from 'zod';
import { config, FOCI } from './config.js';
import { readJson, writeJson } from './state.js';
import { generateStructured } from './anthropic.js';

const normalize = (text) => text.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();

export function loadQueue() {
  const queue = readJson(config.paths.topics, []);
  if (!Array.isArray(queue)) throw new Error('topics.json must be a JSON array of topic objects.');
  return queue.map((item, index) => {
    if (!item.topic || !FOCI[item.focus]) {
      throw new Error(`topics.json entry #${index + 1} needs "topic" and a "focus" of ${Object.keys(FOCI).join(', ')}.`);
    }
    return { id: item.id || crypto.createHash('sha1').update(item.topic).digest('hex').slice(0, 10), ...item };
  });
}

export function queueStatus(queue = loadQueue()) {
  const byFocus = Object.fromEntries(Object.keys(FOCI).map((focus) => [focus, queue.filter((t) => t.focus === focus).length]));
  return { total: queue.length, byFocus };
}

// Order: topics tagged to the live podcast episode, then manually added topics
// (no "source" field), then generated ones. Topics tagged to a different
// episode wait for that episode.
export function pickTopic(focus, queue = loadQueue(), episodeNumber = config.episode?.number) {
  const candidates = queue.filter((t) => t.focus === focus && (t.episode === undefined || t.episode === episodeNumber));
  return candidates.find((t) => episodeNumber !== undefined && t.episode === episodeNumber)
    ?? candidates.find((t) => t.source !== 'generated')
    ?? candidates[0]
    ?? null;
}

export function markTopicUsed(topic, post) {
  const queue = loadQueue().filter((t) => t.id !== topic.id);
  writeJson(config.paths.topics, queue);
  const used = readJson(config.paths.topicsUsed, []);
  used.push({ ...topic, usedAt: new Date().toISOString(), title: post.title, url: post.url, keyword: post.keyword });
  writeJson(config.paths.topicsUsed, used);
}

const TopicBatch = z.object({
  topics: z.array(z.object({
    focus: z.enum(Object.keys(FOCI)),
    topic: z.string(),
    keyword: z.string(),
  })),
});

// Generates new topics using the "questions families type into Google before choosing a care facility" framework.
export async function refillTopics({ count = config.topics.refillCount, logger } = {}) {
  const queue = loadQueue();
  const used = readJson(config.paths.topicsUsed, []);
  const existing = [...queue.map((t) => t.topic), ...used.map((t) => t.topic)];
  const perFocus = Math.ceil(count / 3);

  const system = `You plan blog topics for ${config.brand.name}, a senior living advisory service helping families in ${config.facility.city} choose between in-home care, assisted living, memory care, respite care, and long-term care.
Readers are adult children researching care for aging parents, spouses of people living with dementia or chronic illness, discharge planners, social workers, and referring physicians.`;

  const prompt = `Generate exactly ${perFocus} new topics for EACH of these three focus areas (${perFocus * 3} total):
${Object.entries(FOCI).map(([key, f]) => `- ${key}: ${f.label}`).join('\n')}

Framework: think about the real questions families type into Google in the weeks before choosing a care facility. Each topic should answer one specific question in plain language, for example "How do I know if my dad needs memory care or just more help at home?"

Rules:
- "topic" is a working headline or question, 6 to 16 words.
- "keyword" is one realistic long-tail search phrase (3 to 7 words, lowercase) the post will target. Include "${config.facility.city.toLowerCase()}" in roughly one keyword out of four, where it reads naturally.
- No fear-based angles, no medical claims, no promises of outcomes.
- Do not repeat or closely paraphrase any existing topic below.

Existing topics to avoid:
${existing.map((t) => `- ${t}`).join('\n') || '(none)'}`;

  const { data } = await generateStructured({ system, prompt, schema: TopicBatch, maxTokens: 16000 });
  const seen = new Set(existing.map(normalize));
  const fresh = [];
  for (const item of data.topics) {
    const key = normalize(item.topic);
    if (seen.has(key)) continue;
    seen.add(key);
    fresh.push({
      id: crypto.createHash('sha1').update(item.topic).digest('hex').slice(0, 10),
      focus: item.focus,
      topic: item.topic.trim(),
      keyword: item.keyword.trim().toLowerCase(),
      source: 'generated',
      added: new Date().toISOString().slice(0, 10),
    });
  }
  writeJson(config.paths.topics, [...loadQueue(), ...fresh]);
  logger?.info(`Topic queue refilled with ${fresh.length} topics.`);
  return fresh;
}

// Refill when the whole queue is low, or when any single focus has run dry.
export async function ensureQueue({ logger } = {}) {
  const status = queueStatus();
  const focusEmpty = Object.values(status.byFocus).some((n) => n === 0);
  if (status.total < config.topics.lowWaterMark || focusEmpty) {
    logger?.info(`Topic queue low (${status.total} total, ${JSON.stringify(status.byFocus)}); generating more.`);
    await refillTopics({ logger });
  }
}

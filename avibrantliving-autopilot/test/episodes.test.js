import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

Object.assign(process.env, {
  WP_SITE_URL: 'https://blog.theseniorlivingexperience.com',
  FACILITY_NAME: 'Default Partner',
  FACILITY_SITE_URL: 'https://www.default-partner.test',
  ADVISOR_PHONE: '(858) 555-0199',
});

const { config } = await import('../src/config.js');
const { applyActiveEpisode, activeEpisode } = await import('../src/episodes.js');
const { pickTopic } = await import('../src/topics.js');
const { ctaBlock } = await import('../src/render.js');
const { isInternal } = await import('../src/validate.js');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'avl-ep-'));
config.paths.episodes = path.join(tmp, 'episodes.json');
const partner = (name, website, extra = {}) => ({ name, website, ...extra });
fs.writeFileSync(config.paths.episodes, JSON.stringify([
  { number: 1, title: 'First', date: '2026-10-01', url: 'https://podcast.test/1', partner: partner('A Vibrant Living', 'https://www.avibrantliving.com/', { phone: '(619) 555-0100' }) },
  { number: 2, title: 'Second', date: '2026-10-08', partner: partner('Sunrise Garden', 'https://sunrise.test', { servicesUrl: 'https://sunrise.test/care' }) },
]));

test('the live episode is the latest one that has started', () => {
  assert.equal(activeEpisode(undefined, '2026-09-30'), null);
  assert.equal(activeEpisode(undefined, '2026-10-01').number, 1);
  assert.equal(activeEpisode(undefined, '2026-10-07').number, 1);
  assert.equal(activeEpisode(undefined, '2026-10-20').number, 2);
});

test('the featured partner follows the episode and falls back to .env', () => {
  applyActiveEpisode('2026-10-02');
  assert.equal(config.facility.name, 'A Vibrant Living');
  assert.equal(config.facility.servicesUrl, 'https://www.avibrantliving.com/services/');
  assert.ok(isInternal('https://www.avibrantliving.com/services/'));
  const cta = ctaBlock();
  assert.match(cta, /Episode 1: First/);
  assert.match(cta, /A Vibrant Living is a partner community of The Senior Living Experience/);
  assert.match(cta, /tel:6195550100/);

  applyActiveEpisode('2026-10-09');
  assert.equal(config.facility.name, 'Sunrise Garden');
  assert.equal(config.facility.servicesUrl, 'https://sunrise.test/care');
  assert.equal(config.facility.phone, '');
  assert.ok(!isInternal('https://www.avibrantliving.com/services/'), 'previous partner no longer linked');
  assert.doesNotMatch(ctaBlock(), /Listen to the podcast/, 'no listen box without an episode url');

  applyActiveEpisode('2026-09-01');
  assert.equal(config.facility.name, 'Default Partner');
  assert.equal(config.episode, null);
});

test('topics tagged to the live episode go first; other episodes wait', () => {
  const queue = [
    { id: 'a', focus: 'care-services', topic: 'general', source: 'generated' },
    { id: 'b', focus: 'care-services', topic: 'for episode 2', episode: 2 },
    { id: 'c', focus: 'care-services', topic: 'manual' },
  ];
  assert.equal(pickTopic('care-services', queue, 2).id, 'b');
  assert.equal(pickTopic('care-services', queue, 1).id, 'c');
  assert.equal(pickTopic('care-services', queue.slice(0, 2), 1).id, 'a');
});

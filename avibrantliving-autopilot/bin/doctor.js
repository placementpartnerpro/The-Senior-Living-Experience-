#!/usr/bin/env node
// Checks every credential and endpoint the pipeline depends on, without publishing anything.
import Anthropic from '@anthropic-ai/sdk';
import nodemailer from 'nodemailer';
import { config, missingEnv } from '../src/config.js';
import { checkAuth } from '../src/wordpress.js';
import { emailProvider } from '../src/notify.js';
import { queueStatus } from '../src/topics.js';

let failures = 0;
const ok = (msg) => console.log(`  OK    ${msg}`);
const bad = (msg) => { failures++; console.log(`  FAIL  ${msg}`); };
const warn = (msg) => console.log(`  WARN  ${msg}`);

async function check(label, fn) {
  try {
    const detail = await fn();
    ok(detail ? `${label}: ${detail}` : label);
  } catch (err) {
    bad(`${label}: ${err.message}`);
  }
}

async function urlStatus(url) {
  const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(20000) });
  res.body?.cancel();
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return `HTTP ${res.status}`;
}

console.log('\nConfiguration');
for (const need of ['generate', 'images', 'wordpress', 'email']) {
  const missing = missingEnv([need]);
  missing.length ? bad(`${need}: missing ${missing.join(', ')}`) : ok(need);
}
if (!config.facility.familyGuideUrl) warn('FAMILY_GUIDE_URL not set; the CTA will offer a tour and phone call only.');

console.log('\nServices');
if (process.env.ANTHROPIC_API_KEY) {
  await check(`Anthropic model ${config.anthropic.model}`, async () => (await new Anthropic().models.retrieve(config.anthropic.model)).display_name);
}
if (config.wp.user && config.wp.appPassword) {
  await check('WordPress login', async () => {
    const me = await checkAuth();
    for (const cap of ['publish_posts', 'upload_files', 'manage_categories']) {
      if (!me.capabilities?.[cap]) throw new Error(`user "${me.slug}" lacks the ${cap} capability`);
    }
    return `${me.name} (${me.roles?.join(', ')})`;
  });
}
await check(`Services page ${config.facility.servicesUrl}`, () => urlStatus(config.facility.servicesUrl));
await check(`Contact page ${config.facility.contactUrl}`, () => urlStatus(config.facility.contactUrl));
if (config.facility.ctaUrl !== config.facility.contactUrl) await check(`CTA link ${config.facility.ctaUrl}`, () => urlStatus(config.facility.ctaUrl));
if (config.images.unsplashKey) {
  await check('Unsplash API', async () => {
    const res = await fetch('https://api.unsplash.com/search/photos?query=garden&per_page=1', { headers: { Authorization: `Client-ID ${config.images.unsplashKey}` } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return `rate limit remaining ${res.headers.get('x-ratelimit-remaining')}`;
  });
}
if (config.images.pexelsKey) {
  await check('Pexels API', async () => {
    const res = await fetch('https://api.pexels.com/v1/search?query=garden&per_page=1', { headers: { Authorization: config.images.pexelsKey } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return 'reachable';
  });
}
if (emailProvider() === 'gmail') {
  await check('Gmail SMTP login', async () => {
    await nodemailer.createTransport({ service: 'gmail', auth: { user: config.email.gmailUser, pass: config.email.gmailAppPassword } }).verify();
    return config.email.gmailUser;
  });
} else if (emailProvider() === 'sendgrid') {
  await check('SendGrid key', async () => {
    const res = await fetch('https://api.sendgrid.com/v3/scopes', { headers: { Authorization: `Bearer ${config.email.sendgridKey}` } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { scopes } = await res.json();
    if (!scopes.includes('mail.send')) throw new Error('key lacks mail.send scope');
    return 'mail.send allowed';
  });
}

console.log('\nTopics');
await check('topics.json', async () => JSON.stringify(queueStatus()));

console.log(failures ? `\n${failures} check(s) failed.\n` : '\nAll checks passed.\n');
process.exitCode = failures ? 1 : 0;

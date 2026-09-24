import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(ROOT, '.env'), quiet: true });

const env = (key, fallback = '') => (process.env[key] ?? fallback).trim();
const stripSlash = (url) => url.replace(/\/+$/, '');

// The blog (WordPress) and the facility's own website can live on different domains.
const siteUrl = stripSlash(env('WP_SITE_URL', 'https://blog.theseniorlivingexperience.com'));
const facilityUrl = stripSlash(env('FACILITY_SITE_URL', 'https://www.avibrantliving.com'));
const brandUrl = stripSlash(env('BRAND_SITE_URL', 'https://www.theseniorlivingexperience.com'));

export const config = {
  // The advisory brand that writes the blog and owns the relationship with readers.
  brand: {
    name: env('BRAND_NAME', 'The Senior Living Experience'),
    siteUrl: brandUrl,
    phone: env('ADVISOR_PHONE'),
    ctaUrl: env('ADVISOR_CTA_URL') || `${brandUrl}/contact/`,
    ctaLabel: env('ADVISOR_CTA_LABEL', 'Talk with a senior living advisor'),
  },
  // The partner community featured in every post.
  facility: {
    name: env('FACILITY_NAME'),
    city: env('FACILITY_CITY', 'San Diego'),
    phone: env('FACILITY_PHONE'),
    siteUrl: facilityUrl,
    ctaUrl: env('CTA_URL') || `${facilityUrl}/contact/`,
    ctaLabel: env('CTA_LABEL', 'Schedule a tour'),
    familyGuideUrl: env('FAMILY_GUIDE_URL'),
    servicesUrl: env('SERVICES_URL') || `${facilityUrl}/services/`,
    contactUrl: env('CONTACT_URL') || `${facilityUrl}/contact/`,
  },
  timezone: env('TIMEZONE', 'America/Los_Angeles'),
  anthropic: {
    model: env('ANTHROPIC_MODEL', 'claude-opus-5'),
    effort: env('ANTHROPIC_EFFORT', 'high'),
  },
  wp: {
    siteUrl,
    user: env('WP_USER'),
    appPassword: env('WP_APP_PASSWORD').replace(/\s+/g, ''),
    postStatus: env('WP_POST_STATUS', 'publish'),
    includeH1InBody: env('INCLUDE_H1_IN_BODY', 'false') === 'true',
  },
  images: {
    unsplashKey: env('UNSPLASH_ACCESS_KEY'),
    pexelsKey: env('PEXELS_API_KEY'),
  },
  email: {
    to: env('NOTIFY_EMAIL'),
    from: env('EMAIL_FROM') || env('SMTP_USER') || env('GMAIL_USER'),
    sendgridKey: env('SENDGRID_API_KEY'),
    smtpHost: env('SMTP_HOST'),
    smtpPort: Number(env('SMTP_PORT', '587')),
    smtpUser: env('SMTP_USER'),
    smtpPass: env('SMTP_PASS'),
    gmailUser: env('GMAIL_USER'),
    gmailAppPassword: env('GMAIL_APP_PASSWORD').replace(/\s+/g, ''),
  },
  topics: {
    lowWaterMark: Number(env('TOPICS_LOW_WATER_MARK', '30')),
    refillCount: Number(env('TOPICS_REFILL_COUNT', '30')),
  },
  paths: {
    topics: path.join(ROOT, 'topics.json'),
    episodes: path.join(ROOT, 'episodes.json'),
    topicsUsed: path.join(ROOT, 'state', 'topics-used.json'),
    history: path.join(ROOT, 'state', 'history.json'),
    imagesUsed: path.join(ROOT, 'state', 'images-used.json'),
    templates: path.join(ROOT, 'post-templates'),
    logs: path.join(ROOT, 'logs'),
    drafts: path.join(ROOT, 'drafts'),
  },
};

export const FOCI = {
  'family-support': {
    slot: 'morning',
    category: 'Family Support',
    label: 'Family caregiver support (signs it is time, having the conversation, guilt, burnout)',
  },
  'care-services': {
    slot: 'midday',
    category: 'Care Services',
    label: 'Care services and levels (assisted living vs memory care, what is included, how care plans work)',
  },
  'planning-resources': {
    slot: 'evening',
    category: 'Planning & Resources',
    label: 'Practical guidance (touring a facility, paying for care, insurance, Medicare/Medicaid, legal prep)',
  },
};

export const SLOTS = {
  morning: { hour: 8, focus: 'family-support' },
  midday: { hour: 12, focus: 'care-services' },
  evening: { hour: 17, focus: 'planning-resources' },
};

// Returns the list of missing env vars needed for the given capability set.
export function missingEnv(needs) {
  const checks = {
    generate: [['ANTHROPIC_API_KEY', process.env.ANTHROPIC_API_KEY], ['ADVISOR_PHONE', config.brand.phone], ['a live episode in episodes.json or FACILITY_NAME', config.facility.name]],
    images: [['UNSPLASH_ACCESS_KEY or PEXELS_API_KEY', config.images.unsplashKey || config.images.pexelsKey]],
    wordpress: [['WP_SITE_URL', config.wp.siteUrl], ['WP_USER', config.wp.user], ['WP_APP_PASSWORD', config.wp.appPassword]],
    email: [
      ['NOTIFY_EMAIL', config.email.to],
      ['SENDGRID_API_KEY, SMTP_HOST + SMTP_USER + SMTP_PASS, or GMAIL_USER + GMAIL_APP_PASSWORD',
        config.email.sendgridKey || (config.email.smtpHost && config.email.smtpUser && config.email.smtpPass) || (config.email.gmailUser && config.email.gmailAppPassword)],
      ['EMAIL_FROM (required with SendGrid)', !config.email.sendgridKey || config.email.from],
    ],
  };
  return needs.flatMap((need) => checks[need].filter(([, value]) => !value).map(([name]) => name));
}

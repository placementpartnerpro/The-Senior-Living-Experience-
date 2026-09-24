import { config } from './config.js';
import { readJson } from './state.js';
import { localDate } from './logger.js';

// The partner configured in .env; used when no episode is live yet.
const defaultFacility = { description: '', ...config.facility };

const stripSlash = (url) => url.replace(/\/+$/, '');

export function loadEpisodes(file = config.paths.episodes) {
  const episodes = readJson(file, []);
  if (!Array.isArray(episodes)) throw new Error('episodes.json must be a JSON array of episodes.');
  episodes.forEach((e, i) => {
    const where = `episodes.json entry #${i + 1}`;
    if (!e.number || !e.title) throw new Error(`${where} needs "number" and "title".`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date ?? '')) throw new Error(`${where} needs a "date" in YYYY-MM-DD format (the day its posts start).`);
    if (!e.partner?.name || !e.partner?.website) throw new Error(`${where} needs "partner" with at least "name" and "website".`);
  });
  return episodes;
}

// The live episode is the latest one whose date has arrived; it stays live until the next one starts.
export function activeEpisode(episodes = loadEpisodes(), today = localDate()) {
  return episodes.filter((e) => e.date <= today).sort((a, b) => b.date.localeCompare(a.date) || b.number - a.number)[0] ?? null;
}

export function partnerFacility(partner) {
  const site = stripSlash(partner.website);
  const contactUrl = partner.contactUrl || `${site}/contact/`;
  return {
    name: partner.name,
    city: partner.city || defaultFacility.city,
    phone: partner.phone || '',
    siteUrl: site,
    servicesUrl: partner.servicesUrl || `${site}/services/`,
    contactUrl,
    ctaUrl: partner.tourUrl || contactUrl,
    ctaLabel: partner.ctaLabel || 'Schedule a tour',
    familyGuideUrl: partner.familyGuideUrl || '',
    description: partner.description || '',
  };
}

// Points config.facility at the live episode's partner (or back to the .env
// default) and records the episode on config.episode for the rest of the run.
export function applyActiveEpisode(today = localDate()) {
  const episode = activeEpisode(loadEpisodes(), today);
  Object.assign(config.facility, episode ? partnerFacility(episode.partner) : defaultFacility);
  config.episode = episode;
  return episode;
}

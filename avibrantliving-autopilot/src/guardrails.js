// Content rules enforced on every generated post. The same lists feed both the
// prompt (so the model avoids them) and the validator (so nothing slips through).

export const DISCLAIMER =
  'This article is for informational purposes and is not a substitute for medical, legal, or financial advice. Please consult a qualified professional for your specific situation.';

export const BANNED_PATTERNS = [
  { label: '"in a world where"', re: /in a world where/i },
  { label: '"ain\'t"', re: /\bain[’']?t\b/i },
  { label: '"in conclusion"', re: /\bin conclusion\b/i },
  { label: '"delve"', re: /\bdelv(e|es|ed|ing)\b/i },
  { label: '"tapestry"', re: /\btapestr(y|ies)\b/i },
  { label: '"landscape"', re: /\blandscapes?\b/i },
  { label: '"realm"', re: /\brealms?\b/i },
  { label: '"utilize"', re: /\butili[sz](e|es|ed|ing|ation)\b/i },
  { label: '"leverage"', re: /\bleverag(e|es|ed|ing)\b/i },
  { label: '"loved one" (use mother, father, parent, spouse, family member)', re: /\bloved[\s-]+ones?\b/i },
  { label: 'em dash', re: /[—―]|\s--\s/ },
  { label: 'en dash used as a sentence break', re: /\s–\s/ },
  { label: 'emoji', re: /\p{Extended_Pictographic}/u },
  { label: 'fear-based phrasing ("die alone")', re: /\b(die|dies|dying) alone\b/i },
  { label: 'fear-based phrasing ("before it\'s too late")', re: /before it[’']?s too late/i },
  { label: 'outcome promise ("guarantee")', re: /\bguarantee(s|d)?\b/i },
  { label: 'medical claim ("cure")', re: /\bcur(e|es|ed|ing)\b/i },
];

// External links are only allowed to these reputable sources (subdomains included).
export const SOURCE_DOMAINS = [
  'aarp.org',
  'cdc.gov',
  'alz.org',
  'nia.nih.gov',
  'nih.gov',
  'medicare.gov',
  'medicaid.gov',
  'cms.gov',
  'acl.gov',
  'ssa.gov',
  'va.gov',
  'hhs.gov',
  'ncoa.org',
  'caregiver.org',
  'aging.ca.gov',
  'dhcs.ca.gov',
  'cdss.ca.gov',
  'genworth.com',
];

// Blocks that look like statistics must carry a link to an allowed source.
export const STAT_PATTERN = /\d+(\.\d+)?\s?%|\bpercent\b|\b\d+\s+(in|out of)\s+\d+\b|\b(million|billion)\b|\$\s?\d/i;

export function guardrailPromptText() {
  return `Hard rules (a post that breaks any of these is rejected):
- Never use these words or phrases: "in a world where", "ain't", "in conclusion", "delve", "tapestry", "landscape", "realm", "utilize", "leverage", "loved one". Instead of "loved one", vary with mother, father, parent, mom, dad, spouse, husband, wife, partner, family member.
- Never use em dashes or double hyphens as stylistic breaks. Use commas, periods, colons, or parentheses.
- No emojis. No exclamation-heavy hype.
- No medical claims, no diagnosis, no treatment advice, no promised outcomes (never "guarantee", never "cure"). Educational, general guidance only. Where a medical, legal, or financial decision is involved, suggest talking with a physician, elder law attorney, or financial professional.
- No fear-based hooks or scare tactics. Lead with empathy and clarity.
- No invented statistics. Only include a number, percentage, or dollar figure if you link it to a real page on one of these sites: ${SOURCE_DOMAINS.join(', ')}. Use only URLs you are confident exist (organization home pages or long-standing topic pages). If you are not sure, rewrite the point without the number.
- Do not link to any external site outside that list.`;
}

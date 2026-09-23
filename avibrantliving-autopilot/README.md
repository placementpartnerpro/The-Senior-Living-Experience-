# avibrantliving-autopilot

Automated blog publishing for **www.avibrantliving.com**. It publishes three SEO-optimized posts a day and emails a confirmation after each one.

| Slot | Time (Pacific) | Focus | WordPress category |
|---|---|---|---|
| Morning | 8:00 AM | Family caregiver support | Family Support |
| Midday | 12:00 PM | Care services and levels | Care Services |
| Evening | 5:00 PM | Practical guidance | Planning & Resources |

Each run does the following:

1. Takes the next topic for the slot from `topics.json`. When fewer than 30 topics remain, it writes 30 more first.
2. Writes a 900 to 1,400 word post with Claude, using the matching voice template in `post-templates/`.
3. Checks the draft against every rule in the brief (list below). If a check fails, it sends the problems back to Claude for a revision, up to 3 attempts. A draft that still fails is **never published**.
4. Finds 3 photos (Unsplash first, Pexels as the fallback), cropped to 1200x675. It skips clinical and cliché images and never reuses a photo.
5. Uploads the photos to the WordPress media library with alt text and photographer credit, then publishes the post with its category, tags, featured image, and meta description.
6. Emails a confirmation with the title, live URL, keyword, word count, time, and a thumbnail. If anything fails, it emails the error trace and log instead, and does not retry on its own.
7. Logs every run to `logs/publish-YYYY-MM-DD.log`.

---

## What Julie needs to provide

| Item | Where it goes | How to get it |
|---|---|---|
| Facility name (exactly as it should appear) | `FACILITY_NAME` | |
| Phone number for the call to action | `FACILITY_PHONE` | |
| Tour or booking page URL (optional, defaults to /contact/) | `CTA_URL` | |
| Family guide download URL (optional) | `FAMILY_GUIDE_URL` | |
| Confirm the /services/ and /contact/ page URLs | `SERVICES_URL`, `CONTACT_URL` | `npm run doctor` checks both |
| WordPress username + application password | `WP_USER`, `WP_APP_PASSWORD` | WP Admin > Users > Profile > Application Passwords > "Add New". The user needs the Editor or Administrator role. |
| Anthropic API key | `ANTHROPIC_API_KEY` | console.anthropic.com > API Keys |
| Unsplash access key | `UNSPLASH_ACCESS_KEY` | unsplash.com/developers > New Application. Apply for production access (demo apps get 50 requests an hour, which is enough for testing). |
| Pexels API key | `PEXELS_API_KEY` | pexels.com/api |
| Email: SendGrid key **or** Gmail app password | see `.env.example` | Gmail: Google Account > Security > 2-Step Verification > App passwords |
| Notification address | `NOTIFY_EMAIL` | Pre-filled with vibrantlivingoffice@gmail.com |

---

## Setup (about 10 minutes)

Requires Node.js 20 or newer.

```bash
cd avibrantliving-autopilot
npm install
cp .env.example .env      # then fill in the values above
npm run doctor            # checks every credential and URL; publishes nothing
npm run test-email        # sends a sample confirmation to NOTIFY_EMAIL
```

**Optional but recommended (SEO plugin meta):** copy `wordpress/avl-autopilot-seo-meta.php` into `wp-content/mu-plugins/` on the site. It lets the pipeline fill the Yoast or Rank Math meta description and focus keyword fields. Without it, the meta description goes into the post excerpt, which most themes and SEO plugins fall back to.

### Go-live sequence

1. **Preview a post locally.** This needs only the Anthropic key, plus an image key if you want photos.
   ```bash
   npm run publish -- --slot morning --preview
   ```
   Open the file in `drafts/`. The panel at the top shows the keyword, slug, meta description, tags, and word count.
2. **Create a WordPress draft for Julie to review.** This does not publish anything live.
   ```bash
   npm run draft -- --slot morning
   ```
   Julie gets a "Draft ready" email with a preview link. Draft runs do not use up the topic.
3. **After Julie approves, publish the first post live:**
   ```bash
   npm run publish -- --slot morning --force
   ```
4. **Turn on the schedule.** Choose one of the options below.

---

## Scheduling (choose one)

### Option A: GitHub Actions (recommended, no server needed)

`.github/workflows/avibrantliving-autopilot.yml` runs on GitHub's servers at each slot time. It also saves `topics.json` and `state/` back to the repo, so the queue carries over between runs.

1. Merge this code into the repository's default branch. Scheduled workflows only run from the default branch.
2. In **Settings > Secrets and variables > Actions**, add the following.
   - **Secrets:** `WP_USER`, `WP_APP_PASSWORD`, `ANTHROPIC_API_KEY`, `UNSPLASH_ACCESS_KEY`, `PEXELS_API_KEY`, and either `SENDGRID_API_KEY` or `GMAIL_APP_PASSWORD`
   - **Variables:** `FACILITY_NAME`, `FACILITY_PHONE`, `WP_SITE_URL`, `NOTIFY_EMAIL`, plus `EMAIL_FROM` (SendGrid) or `GMAIL_USER` (Gmail), and optionally `CTA_URL`, `FAMILY_GUIDE_URL`, `SERVICES_URL`, `CONTACT_URL`
3. **Actions > Blog autopilot > Run workflow** lets you run any slot by hand, as a draft, a live post, or a preview. This works from a phone too.

GitHub cron uses UTC and ignores daylight saving time, so the workflow fires at both possible UTC hours for each slot. The script publishes only when it is the right hour in Los Angeles. GitHub sometimes starts scheduled jobs late, so a run in the following hour publishes the slot if it was missed. A slot never publishes twice in one day.

### Option B: Always-on server with node-cron

```bash
npm install -g pm2
pm2 start bin/scheduler.js --name blog-autopilot
pm2 save && pm2 startup     # restart automatically after a reboot
```

### Option C: System crontab

```cron
CRON_TZ=America/Los_Angeles
0 8,12,17 * * *  cd /path/to/avibrantliving-autopilot && /usr/bin/node bin/run.js --slot auto
```

---

## Adding topics manually

Open `topics.json` and add an entry anywhere in the list:

```json
{
  "focus": "family-support",
  "topic": "How to celebrate holidays with a parent in memory care",
  "keyword": "holidays with parent in memory care",
  "notes": "Mention our family holiday open house in December."
}
```

- `focus` must be one of: `family-support` (morning), `care-services` (midday), or `planning-resources` (evening).
- `keyword` is optional. Without it, Claude picks one.
- `notes` is optional. It is passed to Claude as guidance from the facility.
- Topics you add are used **before** auto-generated ones in the same focus.

Check the queue with `npm run topics:status`. To add 30 generated topics now, run `npm run topics:refill`. Used topics move to `state/topics-used.json` with their live URL.

---

## Content rules enforced on every post

The validator in `src/validate.js` and `src/guardrails.js` rejects a draft unless all of the following are true:

- The article body is 900 to 1,400 words, with an intro and 4 to 6 H2 sections (the closing section counts as one).
- The primary keyword appears in the title (H1), the first paragraph, at least one H2, and the meta description.
- The meta description is under 155 characters.
- The slug is generated from the keyword.
- The post links to the /services/ and /contact/ pages.
- None of these appear: "in a world where", "ain't", "in conclusion", "delve", "tapestry", "landscape", "realm", "utilize", "leverage", "loved one", em dashes, emojis, fear hooks ("die alone", "before it's too late"), "guarantee", or "cure".
- Every percentage, dollar figure, or "1 in X" statistic links to an approved source in the same paragraph. Approved sources include AARP, CDC, the Alzheimer's Association, NIA/NIH, Medicare, Medicaid/CMS, ACL/Eldercare Locator, the VA, SSA, NCOA, Family Caregiver Alliance, California DHCS, CDSS, CDA, and Genworth. Links to any other external site are rejected, and source links that return 404 are rejected.
- Every post ends with the call to action (tour link, phone number, services link, and the family guide when `FAMILY_GUIDE_URL` is set), followed by the informational disclaimer.

**About the H1:** WordPress themes already print the post title as the page's H1. The body therefore does not repeat it by default, since two H1s hurt SEO. Set `INCLUDE_H1_IN_BODY=true` if the theme does not show titles.

**To pause live publishing** without stopping the schedule, set `WP_POST_STATUS=draft`. Posts will then wait in WordPress for review.

---

## Files

```
bin/run.js              run one slot: --slot morning|midday|evening|auto [--draft|--preview] [--force]
bin/scheduler.js        node-cron daemon (8 AM, 12 PM, 5 PM Pacific)
bin/doctor.js           checks credentials and URLs
bin/test-email.js       sends a sample confirmation email
bin/refill-topics.js    topic queue status and refill
src/                    pipeline modules (generate, validate, images, wordpress, notify, topics)
post-templates/         one voice and structure template per focus; edit these to tune the voice
topics.json             the topic queue (90 seeded, 30 per focus)
state/                  history, used topics, and used image IDs (kept in git for Option A)
logs/                   publish-YYYY-MM-DD.log
drafts/                 local HTML previews of every post, including rejected drafts
wordpress/              optional mu-plugin for Yoast / Rank Math meta fields
```

`npm test` runs the validator unit tests and an end-to-end pipeline test with every external service mocked.

## Troubleshooting

- **401 from WordPress:** Check the application password and user. Some security plugins (Wordfence, iThemes) or hosts block REST API basic auth. Allow `/wp-json/wp/v2/` for authenticated users.
- **"Post failed validation after 3 attempts":** The rejected draft is saved in `drafts/` and the email lists the failed checks. That slot is skipped, and the next slot runs normally. To retry, run `npm run publish -- --slot <slot>`.
- **No images found:** Check the Unsplash and Pexels keys with `npm run doctor`. Unsplash demo keys are limited to 50 requests an hour.
- **Confirmation emails landing in spam:** For SendGrid, verify the sender domain. For Gmail, add the sending address to Julie's contacts.

import nodemailer from 'nodemailer';
import { config } from './config.js';
import { escapeHtml } from './html.js';
import { localTimestamp } from './logger.js';

async function sendViaSendgrid({ subject, html, text }) {
  const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.email.sendgridKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      personalizations: [{ to: config.email.to.split(',').map((email) => ({ email: email.trim() })) }],
      from: { email: config.email.from, name: `${config.facility.name} Autopilot` },
      subject,
      content: [{ type: 'text/plain', value: text }, { type: 'text/html', value: html }],
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`SendGrid responded ${res.status}: ${await res.text()}`);
}

async function sendViaGmail({ subject, html, text }) {
  const transport = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: config.email.gmailUser, pass: config.email.gmailAppPassword },
  });
  await transport.sendMail({
    from: `"${config.facility.name} Autopilot" <${config.email.gmailUser}>`,
    to: config.email.to,
    subject,
    text,
    html,
  });
}

export function emailProvider() {
  if (config.email.sendgridKey) return 'sendgrid';
  if (config.email.gmailUser && config.email.gmailAppPassword) return 'gmail';
  return null;
}

export async function sendEmail(message) {
  const provider = emailProvider();
  if (!provider) throw new Error('No email credentials configured (SENDGRID_API_KEY or GMAIL_USER + GMAIL_APP_PASSWORD).');
  if (!config.email.to) throw new Error('NOTIFY_EMAIL is not set.');
  return provider === 'sendgrid' ? sendViaSendgrid(message) : sendViaGmail(message);
}

const shell = (inner) => `<div style="font-family:Georgia,serif;max-width:640px;margin:0 auto;color:#2d2a26;line-height:1.5">${inner}</div>`;
const row = (label, value) => `<tr><td style="padding:6px 12px 6px 0;color:#6b645c;vertical-align:top">${label}</td><td style="padding:6px 0">${value}</td></tr>`;

export function successEmail({ title, url, keyword, wordCount, publishedAt, thumbnailUrl, category, status }) {
  const draft = status !== 'publish';
  const subject = `${config.facility.name} ${draft ? 'Draft ready' : 'Published'}: ${title}`;
  const time = localTimestamp(publishedAt);
  const html = shell(`
<h2 style="font-weight:normal;margin:0 0 16px">${draft ? 'A new draft is ready for review' : 'A new post is live'}</h2>
${thumbnailUrl ? `<a href="${escapeHtml(url)}"><img src="${escapeHtml(thumbnailUrl)}" alt="" width="600" style="width:100%;max-width:600px;height:auto;border-radius:6px" /></a>` : ''}
<table style="margin-top:16px;font-size:15px">
${row('Title', `<strong>${escapeHtml(title)}</strong>`)}
${row(draft ? 'Preview' : 'Live URL', `<a href="${escapeHtml(url)}">${escapeHtml(url)}</a>`)}
${row('Primary keyword', escapeHtml(keyword))}
${row('Category', escapeHtml(category))}
${row('Word count', String(wordCount))}
${row(draft ? 'Created' : 'Published', escapeHtml(time))}
</table>`);
  const text = `${draft ? 'Draft ready' : 'Published'}: ${title}\n${url}\nPrimary keyword: ${keyword}\nCategory: ${category}\nWord count: ${wordCount}\n${time}`;
  return { subject, html, text };
}

export function failureEmail({ slot, topic, error, logLines = [] }) {
  const subject = `${config.facility.name} Publishing FAILED: ${slot} post`;
  const trace = error?.stack || String(error);
  const html = shell(`
<h2 style="font-weight:normal;margin:0 0 12px;color:#9b2c2c">The ${escapeHtml(slot)} post did not publish</h2>
<p>Nothing was published for this slot. The pipeline did not retry on its own, so the next attempt will be the next scheduled slot unless someone reruns it.</p>
${topic ? `<p><strong>Topic:</strong> ${escapeHtml(topic.topic)}</p>` : ''}
<p><strong>Error:</strong></p>
<pre style="white-space:pre-wrap;background:#f6f3ef;padding:12px;border-radius:6px;font-size:12px">${escapeHtml(trace)}</pre>
<p><strong>Run log:</strong></p>
<pre style="white-space:pre-wrap;background:#f6f3ef;padding:12px;border-radius:6px;font-size:12px">${escapeHtml(logLines.slice(-40).join('\n'))}</pre>
<p style="color:#6b645c;font-size:13px">To rerun this slot manually: <code>npm run publish -- --slot ${escapeHtml(slot)}</code></p>`);
  const text = `The ${slot} post did not publish.\n${topic ? `Topic: ${topic.topic}\n` : ''}\n${trace}\n\n${logLines.slice(-40).join('\n')}`;
  return { subject, html, text };
}

#!/usr/bin/env node
// Sends a sample confirmation email so the delivery path can be verified before go-live.
import { config } from '../src/config.js';
import { sendEmail, successEmail, emailProvider } from '../src/notify.js';

const message = successEmail({
  title: 'Test email: your blog autopilot is connected',
  url: config.wp.siteUrl,
  keyword: 'assisted living san diego',
  wordCount: 1180,
  publishedAt: new Date(),
  thumbnailUrl: '',
  category: 'Family Support',
  status: 'publish',
});
message.subject = `${config.facility.name} Autopilot test email`;

try {
  await sendEmail(message);
  console.log(`Test email sent to ${config.email.to} via ${emailProvider()}.`);
} catch (err) {
  console.error(`Test email failed: ${err.message}`);
  process.exitCode = 1;
}

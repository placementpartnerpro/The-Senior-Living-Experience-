#!/usr/bin/env node
// Long-running scheduler: 8:00 AM, 12:00 PM, and 5:00 PM in the facility timezone.
// Keep it alive with pm2 or systemd (see README).
import cron from 'node-cron';
import { config, SLOTS } from '../src/config.js';
import { runSlot } from '../src/pipeline.js';

let running = Promise.resolve();

for (const [slot, { hour }] of Object.entries(SLOTS)) {
  cron.schedule(`0 ${hour} * * *`, () => {
    // Chain runs so two slots never publish at the same moment.
    running = running.then(() => runSlot({ slot, mode: 'publish' })).catch(() => {});
  }, { timezone: config.timezone, name: `publish-${slot}` });
  console.log(`Scheduled ${slot} post at ${hour}:00 ${config.timezone}`);
}
console.log('Scheduler running. Press Ctrl+C to stop.');

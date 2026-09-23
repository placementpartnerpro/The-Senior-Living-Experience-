#!/usr/bin/env node
// Usage: node bin/refill-topics.js [--status] [--count 30]
import { parseArgs } from 'node:util';
import { queueStatus, refillTopics } from '../src/topics.js';
import { createLogger } from '../src/logger.js';

const { values } = parseArgs({ options: { status: { type: 'boolean', default: false }, count: { type: 'string', default: '30' } } });

console.log('Topic queue:', queueStatus());
if (!values.status) {
  const added = await refillTopics({ count: Number(values.count), logger: createLogger('topics-refill') });
  console.log(`Added ${added.length} topics.`, queueStatus());
}

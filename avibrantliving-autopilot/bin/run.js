#!/usr/bin/env node
// Usage:
//   node bin/run.js --slot morning|midday|evening|auto [--draft | --preview] [--force]
import { parseArgs } from 'node:util';
import { runSlot } from '../src/pipeline.js';

const { values } = parseArgs({
  options: {
    slot: { type: 'string', default: 'auto' },
    draft: { type: 'boolean', default: false },
    preview: { type: 'boolean', default: false },
    force: { type: 'boolean', default: false },
  },
});

const mode = values.preview ? 'preview' : values.draft ? 'draft' : 'publish';

try {
  const result = await runSlot({ slot: values.slot, mode, force: values.force });
  if (result.url) console.log(`\nDone: ${result.url}`);
  if (result.file) console.log(`\nPreview: ${result.file}`);
} catch {
  process.exitCode = 1;
}

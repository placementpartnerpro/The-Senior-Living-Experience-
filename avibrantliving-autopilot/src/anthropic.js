import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { config } from './config.js';

let client;
function getClient() {
  client ??= new Anthropic();
  return client;
}

// One structured-output call. `fallbacks: "default"` lets the API re-run a
// safety-classifier decline on Anthropic's recommended fallback model.
export async function generateStructured({ system, prompt, schema, maxTokens = 16000 }) {
  const response = await getClient().beta.messages.parse({
    model: config.anthropic.model,
    max_tokens: maxTokens,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    thinking: { type: 'adaptive' },
    output_config: { effort: config.anthropic.effort, format: betaZodOutputFormat(schema) },
    system,
    messages: [{ role: 'user', content: prompt }],
  });

  if (response.stop_reason === 'refusal') {
    throw new Error(`Model declined the request (${response.stop_details?.category ?? 'no category'}).`);
  }
  if (response.stop_reason === 'max_tokens') {
    throw new Error('Model output hit max_tokens before finishing.');
  }
  if (!response.parsed_output) {
    throw new Error('Model response did not match the expected JSON schema.');
  }
  return { data: response.parsed_output, usage: response.usage, model: response.model };
}

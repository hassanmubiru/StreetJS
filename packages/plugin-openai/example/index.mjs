// Runnable example for @streetjs/plugin-openai.
// Prereq: OPENAI_API_KEY. Then: node example/index.mjs

import { OpenAiClient } from '../dist/index.js';

const ai = new OpenAiClient({ apiKey: process.env.OPENAI_API_KEY ?? 'sk-demo' });

const res = await ai.chat({
  model: 'gpt-4o-mini',
  messages: [{ role: 'user', content: 'Say hello from StreetJS in five words.' }],
});
console.log(JSON.stringify(res, null, 2));

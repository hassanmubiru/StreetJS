// Runnable example for @streetjs/plugin-supabase.
// Prereq: SUPABASE_URL + SUPABASE_KEY and a 'profiles' table. Then: node example/index.mjs

import { SupabaseClient } from '../dist/index.js';

const sb = new SupabaseClient({
  url: process.env.SUPABASE_URL ?? 'https://demo.supabase.co',
  apiKey: process.env.SUPABASE_KEY ?? 'demo',
});

const rows = await sb.select('profiles', { columns: 'id,username', limit: 5 });
console.log('profiles:', JSON.stringify(rows, null, 2));

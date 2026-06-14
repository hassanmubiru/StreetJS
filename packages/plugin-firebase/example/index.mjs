// Runnable example for @streetjs/plugin-firebase.
// Prereq: FIREBASE_API_KEY (email/password sign-in enabled). Then: node example/index.mjs

import { FirebaseAuthClient } from '../dist/index.js';

const fb = new FirebaseAuthClient({ apiKey: process.env.FIREBASE_API_KEY ?? 'demo' });

const session = await fb.signIn(process.env.FIREBASE_EMAIL ?? 'user@example.com', process.env.FIREBASE_PASSWORD ?? 'secret123');
console.log('signed in:', JSON.stringify(session, null, 2));

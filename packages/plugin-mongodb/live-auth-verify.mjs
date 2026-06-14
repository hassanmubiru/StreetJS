// Live SCRAM-SHA-256 auth verification against an authenticated mongod.
// Run: node packages/plugin-mongodb/live-auth-verify.mjs
import assert from 'node:assert/strict';
import { MongoClient } from './dist/index.js';

// Auth against the root user (authSource 'admin'); write to a normal db.
const mongo = new MongoClient({
  host: '127.0.0.1', port: 27018,
  database: 'street_auth_verify',
  user: 'admin', password: 'secret123', authSource: 'admin',
});

await mongo.connect(); // performs the SCRAM-SHA-256 handshake
console.log('1. connected + SCRAM-SHA-256 authentication OK');

const marker = `auth-${Date.now()}`;
const ins = await mongo.insertOne('secure', { marker, v: 7 });
assert.equal(ins.ok === 1 || ins.ok === true, true, 'authed insert ok');
console.log('2. authenticated insertOne OK');

const found = await mongo.find('secure', { marker });
assert.equal(found.length, 1);
assert.equal(found[0].v, 7);
console.log('3. authenticated find OK — round-trip verified');

await mongo.close();
console.log('\nLIVE SCRAM-SHA-256 AUTH VERIFICATION: PASS');

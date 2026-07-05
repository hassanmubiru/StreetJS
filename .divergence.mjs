// For each already-published (conflict) package, download the published tarball
// and diff its dist/*.js + dist/*.d.ts against the local built dist to detect
// code that changed since publish (→ would need a version bump to release).
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';

const conflicts = {
  '@streetjs/admin':'admin','@streetjs/admin-ui':'admin-ui','@streetjs/ai-ui':'ai-ui',
  '@streetjs/auth-ui':'auth-ui','@streetjs/cli':'cli','@streetjs/client':'client',
  'streetjs':'core','@streetjs/core':'core-compat','@streetjs/edge':'edge',
  '@streetjs/gateway':'gateway','@streetjs/next':'next','@streetjs/nuxt':'nuxt','@streetjs/orm':'orm',
  '@streetjs/plugin-africastalking':'plugin-africastalking','@streetjs/plugin-auth0':'plugin-auth0',
  '@streetjs/plugin-clerk':'plugin-clerk','@streetjs/plugin-firebase':'plugin-firebase',
  '@streetjs/plugin-htmx':'plugin-htmx','@streetjs/plugin-kafka':'plugin-kafka',
  '@streetjs/plugin-marzpay':'plugin-marzpay','@streetjs/plugin-mongodb':'plugin-mongodb',
  '@streetjs/plugin-mysql':'plugin-mysql','@streetjs/plugin-nats':'plugin-nats',
  '@streetjs/plugin-openai':'plugin-openai','@streetjs/plugin-paypal':'plugin-paypal',
  '@streetjs/plugin-postgres':'plugin-postgres','@streetjs/plugin-r2':'plugin-r2',
  '@streetjs/plugin-rabbitmq':'plugin-rabbitmq','@streetjs/plugin-redis':'plugin-redis',
  '@streetjs/plugin-s3':'plugin-s3','@streetjs/plugin-sendgrid':'plugin-sendgrid',
  '@streetjs/plugin-stripe':'plugin-stripe','@streetjs/plugin-supabase':'plugin-supabase',
  '@streetjs/plugin-twilio':'plugin-twilio','@streetjs/react':'react','@streetjs/vue':'vue',
};

const hashDir = (dir) => {
  const out = {};
  if (!fs.existsSync(dir)) return out;
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const fp = path.join(d, e.name);
      if (e.isDirectory()) walk(fp);
      else if (/\.(js|d\.ts)$/.test(e.name)) {
        const rel = path.relative(dir, fp);
        out[rel] = crypto.createHash('sha1').update(fs.readFileSync(fp)).digest('hex');
      }
    }
  };
  walk(dir);
  return out;
};

const diverged = [], same = [], errored = [];
for (const [name, dir] of Object.entries(conflicts)) {
  const localDist = `packages/${dir}/dist`;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pub-'));
  try {
    execSync(`npm pack ${name} 2>/dev/null`, { cwd: tmp, stdio: 'ignore' });
    const tgz = fs.readdirSync(tmp).find(f => f.endsWith('.tgz'));
    execSync(`tar xzf ${tgz}`, { cwd: tmp, stdio: 'ignore' });
    const pubDist = path.join(tmp, 'package', 'dist');
    const a = hashDir(pubDist), b = hashDir(localDist);
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    const changed = [...keys].filter(k => a[k] !== b[k]);
    if (changed.length === 0) same.push(name);
    else diverged.push({ name, changed: changed.length, sample: changed.slice(0, 3) });
  } catch (e) {
    errored.push(name);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
console.log(`\n== DIVERGED — local dist differs from published (needs version bump) (${diverged.length}) ==`);
for (const d of diverged) console.log('  ', d.name.padEnd(30), `${d.changed} file(s)`, d.sample.join(', '));
console.log(`\n== SAME — local dist matches published (${same.length}) ==`);
console.log('  ', same.join(', '));
if (errored.length) console.log(`\n== could not compare (${errored.length}): ${errored.join(', ')}`);

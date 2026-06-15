// Minimal-footprint probe: boot a bare StreetJS HTTP server and report idle RSS,
// then RSS after a SQLite (in-process) DB is opened. Evidence for the budget guide.
import { streetApp, SqlitePool } from 'streetjs';

const mb = (b) => Math.round(b / 1048576);
const base = process.memoryUsage().rss;

const app = streetApp({ port: 34090 });
app.use(async (ctx, next) => { if (ctx.path === '/ping') { ctx.json({ ok: true }); return; } await next(); });
await app.listen(34090, '127.0.0.1');
global.gc?.();
const afterHttp = process.memoryUsage().rss;

const db = new SqlitePool({ filePath: ':memory:' });
await db.query('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)');
await db.query("INSERT INTO t (v) VALUES ('x')");
global.gc?.();
const afterDb = process.memoryUsage().rss;

console.log(`RSS baseline(node+streetjs import)=${mb(base)}MB  http-listening=${mb(afterHttp)}MB  +sqlite=${mb(afterDb)}MB`);
await db.close();
await app.close();
process.exit(0);

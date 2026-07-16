import { createContext, serializeCookie } from './dist/core/context.js';
const req = { method: 'post', headers: { 'x-a': 'b' } };
let body, status;
const res = { writeHead(s){ status = s; return this; }, end(b){ body = b; }, setHeader(){}, getHeader(){} };
const ctx = createContext(req, res, '/p', { q: '1' });
ctx.json({ ok: true }, 201);
console.log('OK', ctx.method, status, body, ctx.headers['x-a'], serializeCookie('s', 'v'));

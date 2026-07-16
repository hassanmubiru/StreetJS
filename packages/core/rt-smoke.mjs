import { Router, notFoundHandler, errorHandler } from './dist/router/router.js';
console.log('Router', typeof Router, 'nf', typeof notFoundHandler, 'eh', typeof errorHandler);
const router = new Router();
let out;
router.add('GET', '/u/:id', [], (ctx) => { out = ctx.params.id; });
const ctx = { method: 'GET', path: '/u/9', params: {}, query: {}, state: {}, user: null, req: { socket: {} }, setHeader() {}, json() {} };
const ok = await router.dispatch(ctx);
console.log('OK matched=', ok, 'param=', out);

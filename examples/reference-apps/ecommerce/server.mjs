// Ecommerce — StreetJS reference application.
// A storefront backend over @streetjs/commerce: catalog, inventory (no
// oversell), carts, coupons, checkout (FakeGateway by default), orders.
// Exported as createStore(); run directly for a standalone HTTP instance.

import { createServer as createHttp } from 'node:http';
import { CommerceService, FakeGateway } from '@streetjs/commerce';

export function createStore(opts = {}) {
  const gateway = opts.gateway ?? new FakeGateway();
  const shop = new CommerceService({ gateway });

  const http = createHttp(async (req, res) => {
    try {
      if (req.url === '/health/live' || req.url === '/health/ready') return json(res, 200, { status: 'ok' });
      if (req.method === 'GET' && req.url === '/products') return json(res, 200, { products: await shop.listProducts({ activeOnly: true }) });
      if (req.method === 'POST' && req.url === '/checkout') {
        const body = await readJson(req);
        const order = await shop.checkout(body.cartId, { couponCode: body.couponCode });
        return json(res, 200, order);
      }
      json(res, 404, { error: 'not found' });
    } catch (err) {
      json(res, 400, { error: String(err?.name ?? 'Error') + ': ' + String(err?.message ?? err) });
    }
  });

  return { shop, gateway, http, listen(p = 0) { return new Promise((r) => http.listen(p, () => r(http.address().port))); }, close() { return new Promise((r) => http.close(r)); } };
}

function json(res, code, body) { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); }
function readJson(req) { return new Promise((resolve, reject) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch (e) { reject(e); } }); }); }

if (import.meta.url === `file://${process.argv[1]}`) {
  const app = createStore();
  const port = await app.listen(Number(process.env.PORT) || 3000);
  console.log(`[ecommerce] listening on http://0.0.0.0:${port}`);
}

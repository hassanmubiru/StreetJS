// @streetjs/devtools — browser bundle renderer (Req 7.1/7.2/7.3/7.4/7.5/7.6/7.7).
//
// Produces a single, self-contained HTML page (inline CSS + JS, no external
// network deps) that delivers the four tools as a browser experience (Req 7.6):
//   • Playground            — OpenAPI viewer + route/middleware/plugin testing (Req 7.1)
//   • Route Explorer        — visual route tree, method + path per route (Req 7.2)
//   • Dependency Graph      — nodes + edges drawn as an SVG (Req 7.3)
//   • API Inspector         — status/headers/body; on failure error + retained input (Req 7.4/7.5)
//
// SECURITY (Req 7.7): the client enforces the same token-gated, read-only model
// as the server-side `DevtoolsAuthGate`. No request leaves the page unless an
// access token has been entered, and only SAFE (read-only) methods are ever
// issued — mutating operations are visibly disabled. The token is held in memory
// only (never persisted) and sent as `Authorization: Bearer <token>`.
import { openApiToHtml } from 'streetjs';
import { SAFE_METHODS } from './auth.js';
/** Re-export core's standalone playground generator (Req 7.1 building block). */
export { openApiToHtml };
/** Escape a string for safe interpolation into HTML text/attribute context. */
function esc(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
/** Embed a JSON value inside a <script> block without allowing a tag breakout. */
function jsonScript(value) {
    return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
}
function renderRouteTree(nodes) {
    if (!nodes.length)
        return '<p class="empty">No registered routes.</p>';
    const renderNodes = (list) => {
        const items = list
            .map((n) => {
            const isLeaf = n.method !== '';
            const label = isLeaf
                ? `<span class="m m-${esc(n.method)}">${esc(n.method)}</span><code>${esc(n.path)}</code>`
                : `<span class="group">${esc(n.path || '/')}</span>`;
            const kids = n.children && n.children.length ? renderNodes(n.children) : '';
            return `<li>${label}${kids}</li>`;
        })
            .join('');
        return `<ul class="routes">${items}</ul>`;
    };
    return renderNodes(nodes);
}
// ── Client script: token gate + read-only enforcement + all four tools ────────
function clientScript() {
    // SAFE_METHODS is injected so the client mirrors the server-side policy.
    const safe = JSON.stringify(SAFE_METHODS);
    return `
(function () {
  var SAFE = ${safe};
  var DATA = JSON.parse(document.getElementById('street-devtools-data').textContent);
  var state = { token: '', baseUrl: DATA.baseUrl || '' };

  function isSafe(m) { return SAFE.indexOf(String(m).trim().toUpperCase()) !== -1; }
  function byId(id) { return document.getElementById(id); }

  // ── Token gate (Req 7.7) ──────────────────────────────────────────────────
  function tokenGate() {
    var t = (byId('street-token').value || '').trim();
    state.token = t;
    var status = byId('token-status');
    if (t) { status.textContent = 'Token set (held in memory only).'; status.className = 'ok'; }
    else { status.textContent = 'No token set — requests are blocked until a token is entered.'; status.className = 'warn'; }
    document.querySelectorAll('[data-needs-token]').forEach(function (el) { el.disabled = !t; });
  }

  // The single funnel for every outgoing request: enforces token + read-only.
  function gatedSend(method, path, body, render) {
    method = String(method).trim().toUpperCase();
    if (!state.token) { render({ error: 'Access denied: a devtools token is required (401).' }); return; }
    if (!isSafe(method)) { render({ error: 'Access denied: the devtools are read-only; ' + method + ' is not permitted (403).' }); return; }
    state.baseUrl = (byId('street-base') && byId('street-base').value) || state.baseUrl;
    var url = state.baseUrl + path;
    var opts = { method: method, headers: { 'authorization': 'Bearer ' + state.token } };
    if (body && body.trim() && method !== 'GET' && method !== 'HEAD') {
      opts.headers['content-type'] = 'application/json';
      opts.body = body;
    }
    render({ pending: 'Sending ' + method + ' ' + url + ' ...' });
    fetch(url, opts).then(function (res) {
      var headers = {};
      res.headers.forEach(function (v, k) { headers[k] = v; });
      return res.text().then(function (t) { render({ status: res.status, statusText: res.statusText, headers: headers, body: t }); });
    }).catch(function (e) { render({ error: 'Error: ' + (e && e.message ? e.message : e) }); });
  }

  // ── Tabs ──────────────────────────────────────────────────────────────────
  function showTab(name) {
    document.querySelectorAll('.tab').forEach(function (el) { el.classList.toggle('active', el.getAttribute('data-tab') === name); });
    document.querySelectorAll('.panel').forEach(function (el) { el.classList.toggle('active', el.getAttribute('data-panel') === name); });
  }
  document.querySelectorAll('.tab').forEach(function (el) {
    el.addEventListener('click', function () { showTab(el.getAttribute('data-tab')); });
  });

  // ── Playground operations (Req 7.1) ────────────────────────────────────────
  function renderPlayground() {
    var paths = (DATA.openApi && DATA.openApi.paths) || {};
    var host = byId('playground-ops');
    var html = '';
    Object.keys(paths).sort().forEach(function (p) {
      Object.keys(paths[p]).forEach(function (mRaw) {
        var m = mRaw.toUpperCase();
        if (['GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS'].indexOf(m) === -1) return;
        var op = paths[p][mRaw] || {};
        var safe = isSafe(m);
        var id = 'op-' + Math.random().toString(36).slice(2);
        html += '<div class="op">'
          + '<div class="op-head"><span class="m m-' + m + '">' + m + '</span><code>' + escapeHtml(p) + '</code>'
          + (safe ? '' : '<span class="ro">read-only — blocked</span>') + '</div>'
          + (op.summary ? '<p class="summary">' + escapeHtml(op.summary) + '</p>' : '')
          + '<button data-needs-token ' + (safe ? '' : 'disabled') + ' data-op="' + id + '">Try it</button>'
          + '<pre class="output" id="' + id + '-out"></pre>'
          + '</div>';
      });
    });
    host.innerHTML = html || '<p class="empty">No operations in the spec.</p>';
    host.querySelectorAll('button[data-op]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var opEl = btn.closest('.op');
        var method = opEl.querySelector('.m').textContent;
        var path = opEl.querySelector('code').textContent;
        var out = byId(btn.getAttribute('data-op') + '-out');
        gatedSend(method, path, '', function (r) { out.textContent = formatResult(r); });
      });
    });
    byId('openapi-viewer').textContent = JSON.stringify(DATA.openApi, null, 2);
  }

  // ── Dependency Graph (Req 7.3) ──────────────────────────────────────────────
  function renderGraph() {
    var g = DATA.depGraph || { nodes: [], edges: [] };
    var svg = byId('dep-graph');
    if (!g.nodes.length) { svg.innerHTML = '<text x="20" y="30" fill="#8b949e">No dependencies.</text>'; return; }
    var W = 760, H = Math.max(240, g.nodes.length * 60), cx = W / 2, cy = H / 2;
    var R = Math.min(cx, cy) - 70;
    var pos = {};
    g.nodes.forEach(function (n, i) {
      var a = (2 * Math.PI * i) / g.nodes.length - Math.PI / 2;
      pos[n] = { x: cx + R * Math.cos(a), y: cy + R * Math.sin(a) };
    });
    var parts = ['<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#58a6ff"/></marker></defs>'];
    g.edges.forEach(function (e) {
      var a = pos[e[0]], b = pos[e[1]];
      if (!a || !b) return;
      parts.push('<line x1="' + a.x + '" y1="' + a.y + '" x2="' + b.x + '" y2="' + b.y + '" stroke="#30495f" stroke-width="1.5" marker-end="url(#arrow)"/>');
    });
    g.nodes.forEach(function (n) {
      var p = pos[n];
      parts.push('<circle cx="' + p.x + '" cy="' + p.y + '" r="6" fill="#1f6feb"/>'
        + '<text x="' + (p.x + 9) + '" y="' + (p.y + 4) + '" fill="#c9d1d9" font-size="11">' + escapeHtml(shortName(n)) + '</text>');
    });
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.innerHTML = parts.join('');
    byId('dep-count').textContent = g.nodes.length + ' modules, ' + g.edges.length + ' edges';
  }
  function shortName(p) { var s = String(p).split('/'); return s.slice(-2).join('/'); }

  // ── API Inspector (Req 7.4 / 7.5) ───────────────────────────────────────────
  function inspectorMethods() {
    // Only safe methods are selectable — the read-only policy is enforced in UI.
    return SAFE.map(function (m) { return '<option value="' + m + '">' + m + '</option>'; }).join('');
  }
  function wireInspector() {
    byId('insp-method').innerHTML = inspectorMethods();
    byId('insp-run').addEventListener('click', function () {
      var method = byId('insp-method').value;
      var path = byId('insp-path').value || '';
      var body = byId('insp-body').value || '';
      var out = byId('insp-out');
      // Input is retained on the form regardless of outcome (Req 7.5).
      gatedSend(method, path, body, function (r) { out.textContent = formatResult(r); });
    });
  }

  // ── Shared render helpers ───────────────────────────────────────────────────
  function formatResult(r) {
    if (r.pending) return r.pending;
    if (r.error) return r.error; // failure: error indication; form input retained (Req 7.5)
    var hs = Object.keys(r.headers || {}).map(function (k) { return k + ': ' + r.headers[k]; }).join('\\n');
    return r.status + ' ' + (r.statusText || '') + '\\n\\n' + hs + '\\n\\n' + (r.body || '');
  }
  function escapeHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }

  // ── Init ────────────────────────────────────────────────────────────────────
  byId('street-token').addEventListener('input', tokenGate);
  if (byId('street-base')) byId('street-base').value = state.baseUrl;
  tokenGate();
  renderPlayground();
  renderGraph();
  wireInspector();
  showTab('playground');
})();
`;
}
/**
 * Render the complete, self-contained devtools browser experience for a dataset.
 * The returned string is a full HTML document with inline CSS/JS and no external
 * dependencies, suitable for embedding directly into the GitHub Pages docs site.
 */
export function renderDevtoolsBundle(data, opts = {}) {
    const title = esc(opts.title ?? data.title ?? 'Street DevTools');
    const tree = renderRouteTree(data.routeTree);
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title}</title>
<style>
  :root { color-scheme: dark; }
  body { font: 14px/1.5 system-ui, sans-serif; margin: 0; background: #0d1117; color: #c9d1d9; }
  header { padding: 1rem 1.5rem; background: #161b22; border-bottom: 1px solid #30363d; }
  h1 { margin: 0 0 .25rem; font-size: 1.25rem; }
  .sub { color: #8b949e; font-size: .85rem; }
  .authbar { display: flex; flex-wrap: wrap; gap: .75rem; align-items: center; padding: .75rem 1.5rem; background: #11161d; border-bottom: 1px solid #30363d; }
  .authbar label { font-size: .8rem; color: #8b949e; }
  .authbar input { background: #0d1117; color: #c9d1d9; border: 1px solid #30363d; border-radius: 4px; padding: .35rem .5rem; min-width: 14rem; }
  #token-status { font-size: .8rem; } #token-status.ok { color: #3fb950; } #token-status.warn { color: #d29922; }
  nav.tabs { display: flex; gap: .25rem; padding: 0 1.5rem; background: #161b22; border-bottom: 1px solid #30363d; }
  .tab { padding: .6rem .9rem; cursor: pointer; border: 0; background: transparent; color: #8b949e; border-bottom: 2px solid transparent; }
  .tab.active { color: #c9d1d9; border-bottom-color: #1f6feb; }
  main { padding: 1.5rem; max-width: 960px; margin: 0 auto; }
  .panel { display: none; } .panel.active { display: block; }
  .op { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 1rem; margin-bottom: 1rem; }
  .op-head { display: flex; align-items: center; gap: .5rem; }
  .m { font-weight: 700; padding: .1rem .4rem; border-radius: 4px; color: #fff; font-size: .8rem; }
  .m-GET { background: #1f6feb; } .m-POST { background: #238636; } .m-PUT { background: #9e6a03; }
  .m-DELETE { background: #da3633; } .m-PATCH { background: #8957e5; } .m-HEAD,.m-OPTIONS { background: #6e7681; }
  .ro { margin-left: auto; color: #d29922; font-size: .75rem; }
  code { color: #d2a8ff; } .summary { color: #8b949e; margin: .25rem 0; } .empty { color: #8b949e; }
  button { background: #238636; color: #fff; border: 0; border-radius: 4px; padding: .4rem .9rem; cursor: pointer; margin-top: .5rem; }
  button:disabled { background: #21262d; color: #6e7681; cursor: not-allowed; }
  input, textarea, select { background: #0d1117; color: #c9d1d9; border: 1px solid #30363d; border-radius: 4px; padding: .4rem; }
  textarea { width: 100%; box-sizing: border-box; min-height: 5rem; font-family: monospace; }
  .output, #openapi-viewer { background: #0d1117; border: 1px solid #30363d; border-radius: 4px; padding: .5rem; white-space: pre-wrap; margin-top: .5rem; max-height: 360px; overflow: auto; }
  ul.routes { list-style: none; margin: 0; padding-left: 1rem; border-left: 1px solid #21262d; }
  ul.routes li { margin: .25rem 0; display: block; }
  .group { color: #8b949e; font-weight: 600; }
  .field { display: block; margin: .5rem 0; } .field label { display: block; color: #8b949e; font-size: .8rem; margin-bottom: .2rem; }
  .row { display: flex; gap: .5rem; } .row .field { flex: 1; }
  svg { width: 100%; height: auto; background: #0d1117; border: 1px solid #30363d; border-radius: 8px; }
</style>
</head>
<body>
<header>
  <h1>${title}</h1>
  <div class="sub">Read-only, token-gated developer tools. Requests are blocked until a token is set and only safe (GET/HEAD/OPTIONS) methods are issued.</div>
</header>

<div class="authbar">
  <label for="street-token">Access token</label>
  <input id="street-token" type="password" placeholder="devtools access token" autocomplete="off" />
  <label for="street-base">Base URL</label>
  <input id="street-base" type="text" placeholder="https://app.example.com" />
  <span id="token-status" class="warn"></span>
</div>

<nav class="tabs">
  <button class="tab" data-tab="playground">Playground</button>
  <button class="tab" data-tab="routes">Route Explorer</button>
  <button class="tab" data-tab="graph">Dependency Graph</button>
  <button class="tab" data-tab="inspector">API Inspector</button>
</nav>

<main>
  <section class="panel" data-panel="playground">
    <h2>Playground</h2>
    <p class="sub">Route, middleware, and plugin testing via the live OpenAPI surface. Mutating operations are shown but disabled by the read-only policy.</p>
    <div id="playground-ops"></div>
    <h3>OpenAPI viewer</h3>
    <pre id="openapi-viewer"></pre>
  </section>

  <section class="panel" data-panel="routes">
    <h2>Route Explorer</h2>
    <p class="sub">Every registered route with its HTTP method and path.</p>
    ${tree}
  </section>

  <section class="panel" data-panel="graph">
    <h2>Dependency Graph Visualizer</h2>
    <p class="sub" id="dep-count"></p>
    <svg id="dep-graph" role="img" aria-label="Module dependency graph"></svg>
  </section>

  <section class="panel" data-panel="inspector">
    <h2>API Inspector</h2>
    <p class="sub">Issue a read-only request and inspect the response. On failure the error is shown and your input is retained.</p>
    <div class="row">
      <div class="field" style="flex:0 0 8rem;"><label for="insp-method">Method</label><select id="insp-method"></select></div>
      <div class="field"><label for="insp-path">Path</label><input id="insp-path" type="text" placeholder="/users/123" style="width:100%;box-sizing:border-box;" /></div>
    </div>
    <div class="field"><label for="insp-body">Body (ignored for read-only methods)</label><textarea id="insp-body" placeholder="(not sent for GET/HEAD)"></textarea></div>
    <button id="insp-run" data-needs-token disabled>Send request</button>
    <pre class="output" id="insp-out"></pre>
  </section>
</main>

<script type="application/json" id="street-devtools-data">${jsonScript(data)}</script>
<script>${clientScript()}</script>
</body>
</html>
`;
}
//# sourceMappingURL=bundle.js.map
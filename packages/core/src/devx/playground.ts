// src/devx/playground.ts
// Generate a self-contained, dependency-free interactive API playground / explorer
// (a single static HTML page) from an OpenAPI document. Each operation gets a
// "Try it" form that issues a fetch to the endpoint and renders the response.
// All values are HTML-escaped (the spec is treated as untrusted input).

import { openApiOperations } from '../security/dast.js';

export interface PlaygroundOptions {
  /** Page title. Default 'Street API Playground'. */
  title?: string;
  /** Base URL requests are sent to. Default '' (same origin). */
  baseUrl?: string;
}

/** Escape a string for safe interpolation into HTML text/attribute context. */
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

interface OperationMeta { method: string; path: string; summary: string }

function operationsWithSummaries(doc: unknown): OperationMeta[] {
  const paths = (doc as { paths?: Record<string, Record<string, { summary?: string }>> })?.paths ?? {};
  return openApiOperations(doc).map((op) => {
    const summary = paths[op.path]?.[op.method.toLowerCase()]?.summary ?? '';
    return { method: op.method, path: op.path, summary };
  });
}

const RUNNER_SCRIPT = `
  function streetTry(form) {
    var method = form.getAttribute('data-method');
    var tmpl = form.getAttribute('data-path');
    var base = form.getAttribute('data-base') || '';
    var path = tmpl.replace(/\\{([^}]+)\\}/g, function (_, name) {
      var el = form.querySelector('[data-param="' + name + '"]');
      return encodeURIComponent(el ? el.value : '');
    });
    var bodyEl = form.querySelector('[data-body]');
    var opts = { method: method, headers: {} };
    if (bodyEl && bodyEl.value.trim() && method !== 'GET' && method !== 'HEAD') {
      opts.headers['content-type'] = 'application/json';
      opts.body = bodyEl.value;
    }
    var out = form.querySelector('[data-output]');
    out.textContent = 'Sending ' + method + ' ' + base + path + ' ...';
    fetch(base + path, opts).then(function (res) {
      return res.text().then(function (t) {
        out.textContent = res.status + ' ' + res.statusText + '\\n\\n' + t;
      });
    }).catch(function (e) { out.textContent = 'Error: ' + e.message; });
    return false;
  }
`;

/**
 * Render an interactive HTML playground for an OpenAPI document. Returns a
 * complete, self-contained HTML page (inline CSS + JS, no external deps).
 */
export function openApiToHtml(doc: unknown, opts: PlaygroundOptions = {}): string {
  const title = esc(opts.title ?? 'Street API Playground');
  const base = esc(opts.baseUrl ?? '');
  const ops = operationsWithSummaries(doc);

  const cards = ops.map((op) => {
    const params = [...op.path.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]!);
    const paramInputs = params.map((p) =>
      `<label>${esc(p)} <input data-param="${esc(p)}" placeholder="${esc(p)}" /></label>`,
    ).join('');
    const bodyField = (op.method !== 'GET' && op.method !== 'HEAD')
      ? '<textarea data-body placeholder="JSON request body"></textarea>'
      : '';
    return `<form class="op" data-method="${esc(op.method)}" data-path="${esc(op.path)}" data-base="${base}" onsubmit="return streetTry(this)">
      <div class="op-head"><span class="m m-${esc(op.method)}">${esc(op.method)}</span><code>${esc(op.path)}</code></div>
      ${op.summary ? `<p class="summary">${esc(op.summary)}</p>` : ''}
      ${paramInputs}
      ${bodyField}
      <button type="submit">Try it</button>
      <pre data-output class="output"></pre>
    </form>`;
  }).join('\n');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title}</title>
<style>
  body { font: 14px/1.5 system-ui, sans-serif; margin: 0; background: #0d1117; color: #c9d1d9; }
  header { padding: 1rem 1.5rem; background: #161b22; border-bottom: 1px solid #30363d; }
  h1 { margin: 0; font-size: 1.25rem; }
  main { padding: 1.5rem; display: grid; gap: 1rem; max-width: 900px; margin: 0 auto; }
  .op { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 1rem; }
  .op-head { display: flex; align-items: center; gap: .5rem; }
  .m { font-weight: 700; padding: .1rem .4rem; border-radius: 4px; color: #fff; font-size: .8rem; }
  .m-GET { background: #1f6feb; } .m-POST { background: #238636; } .m-PUT { background: #9e6a03; }
  .m-DELETE { background: #da3633; } .m-PATCH { background: #8957e5; }
  code { color: #d2a8ff; } .summary { color: #8b949e; margin: .25rem 0; }
  label { display: block; margin: .35rem 0; } input, textarea { width: 100%; box-sizing: border-box;
    background: #0d1117; color: #c9d1d9; border: 1px solid #30363d; border-radius: 4px; padding: .4rem; }
  textarea { min-height: 5rem; font-family: monospace; }
  button { margin-top: .5rem; background: #238636; color: #fff; border: 0; border-radius: 4px; padding: .4rem .9rem; cursor: pointer; }
  .output { background: #0d1117; border: 1px solid #30363d; border-radius: 4px; padding: .5rem; white-space: pre-wrap; margin-top: .5rem; max-height: 320px; overflow: auto; }
</style>
</head>
<body>
<header><h1>${title}</h1></header>
<main>
${cards || '<p>No operations in the spec.</p>'}
</main>
<script>${RUNNER_SCRIPT}</script>
</body>
</html>
`;
}

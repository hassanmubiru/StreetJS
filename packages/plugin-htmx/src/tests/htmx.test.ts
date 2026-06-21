// Unit tests for @streetjs/plugin-htmx — pure engine + helpers.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  renderTemplate, escapeHtml, lookup, ViewEngine,
  isHtmxRequest, hxHeaders, csrfField, htmxPluginManifest, attachHtmx,
} from '../index.js';

describe('view-engine: renderTemplate', () => {
  it('escapes {{ }} and leaves {{{ }}} raw', () => {
    const out = renderTemplate('<p>{{ a }}</p><div>{{{ b }}}</div>', { a: '<x>&"', b: '<b>ok</b>' });
    assert.equal(out, '<p>&lt;x&gt;&amp;&quot;</p><div><b>ok</b></div>');
  });
  it('resolves dotted paths and missing values render empty', () => {
    assert.equal(renderTemplate('{{ user.name }}|{{ user.missing }}', { user: { name: 'Ada' } }), 'Ada|');
  });
  it('includes partials via the resolver', () => {
    const partials: Record<string, string> = { row: '<li>{{ name }}</li>' };
    const out = renderTemplate('<ul>{{> row }}</ul>', { name: 'A' }, (n) => partials[n]);
    assert.equal(out, '<ul><li>A</li></ul>');
  });
  it('throws on unknown partial and on cycles', () => {
    assert.throws(() => renderTemplate('{{> nope }}', {}, () => undefined), /unknown partial/);
    assert.throws(() => renderTemplate('{{> a }}', {}, () => '{{> a }}'), /depth exceeded/);
  });
});

describe('view-engine: escapeHtml / lookup', () => {
  it('escapes all five entities; null -> empty', () => {
    assert.equal(escapeHtml(`&<>"'`), '&amp;&lt;&gt;&quot;&#39;');
    assert.equal(escapeHtml(null), '');
  });
  it('lookup supports "." for the root', () => {
    const d = { x: 1 };
    assert.equal(lookup(d, '.'), d);
  });
});

describe('ViewEngine over a temp dir', () => {
  function withViews(fn: (dir: string) => void) {
    const dir = mkdtempSync(join(tmpdir(), 'htmx-views-'));
    try {
      mkdirSync(join(dir, 'layouts')); mkdirSync(join(dir, 'partials')); mkdirSync(join(dir, 'pages'));
      writeFileSync(join(dir, 'layouts', 'main.html'), '<html><body>{{{ body }}}</body></html>');
      writeFileSync(join(dir, 'partials', 'row.html'), '<li>{{ name }}</li>');
      writeFileSync(join(dir, 'pages', 'home.html'), '<h1>{{ title }}</h1>{{> row }}');
      fn(dir);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }

  it('wraps a page in the layout by default', () => {
    withViews((dir) => {
      const eng = new ViewEngine({ viewsDir: dir, layout: 'main' });
      const html = eng.view('home', { title: 'Hi', name: 'Ada' });
      assert.equal(html, '<html><body><h1>Hi</h1><li>Ada</li></body></html>');
    });
  });
  it('returns just the fragment when wrap=false (HTMX request)', () => {
    withViews((dir) => {
      const eng = new ViewEngine({ viewsDir: dir, layout: 'main' });
      assert.equal(eng.view('home', { title: 'Hi', name: 'Ada' }, { wrap: false }), '<h1>Hi</h1><li>Ada</li>');
    });
  });
  it('renders a partial directly', () => {
    withViews((dir) => {
      const eng = new ViewEngine({ viewsDir: dir });
      assert.equal(eng.partial('row', { name: 'Bob' }), '<li>Bob</li>');
    });
  });
  it('throws a clear error for a missing template', () => {
    withViews((dir) => {
      const eng = new ViewEngine({ viewsDir: dir });
      assert.throws(() => eng.view('nope'), /template not found/);
    });
  });
});

describe('htmx helpers', () => {
  it('detects HX-Request case-insensitively', () => {
    assert.equal(isHtmxRequest({ 'HX-Request': 'true' }), true);
    assert.equal(isHtmxRequest({ 'hx-request': 'true' }), true);
    assert.equal(isHtmxRequest({}), false);
    assert.equal(isHtmxRequest({ 'hx-request': 'false' }), false);
  });
  it('builds HX-* response headers', () => {
    const h = hxHeaders({ redirect: '/login', trigger: 'saved', retarget: '#list', reswap: 'beforeend' });
    assert.equal(h['HX-Redirect'], '/login');
    assert.equal(h['HX-Trigger'], 'saved');
    assert.equal(h['HX-Retarget'], '#list');
    assert.equal(h['HX-Reswap'], 'beforeend');
  });
  it('serializes object/array triggers and pushUrl=false', () => {
    assert.equal(hxHeaders({ trigger: { userCreated: { id: 1 } } })['HX-Trigger'], '{"userCreated":{"id":1}}');
    assert.equal(hxHeaders({ trigger: ['a', 'b'] })['HX-Trigger'], 'a, b');
    assert.equal(hxHeaders({ pushUrl: false })['HX-Push-Url'], 'false');
  });
  it('csrfField escapes the token', () => {
    assert.equal(csrfField('a"b'), '<input type="hidden" name="_csrf" value="a&quot;b">');
  });
});

describe('plugin glue', () => {
  it('manifest is well-formed', () => {
    const m = htmxPluginManifest();
    assert.equal(m.name, 'street-plugin-htmx');
    assert.deepEqual(m.permissions, ['middleware']);
  });
  it('attachHtmx writes a fragment for HTMX requests and sets HX headers', () => {
    const dir = mkdtempSync(join(tmpdir(), 'htmx-glue-'));
    try {
      mkdirSync(join(dir, 'layouts')); mkdirSync(join(dir, 'pages'));
      writeFileSync(join(dir, 'layouts', 'main.html'), '<html>{{{ body }}}</html>');
      writeFileSync(join(dir, 'pages', 'p.html'), '<h1>{{ t }}</h1>');
      const eng = new ViewEngine({ viewsDir: dir, layout: 'main' });
      let body = '', code = 0; const headers: Record<string, string> = {};
      const ctx = {
        headers: { 'hx-request': 'true' } as Record<string, string>,
        html: (d: string, s = 200) => { body = d; code = s; },
        setHeader: (k: string, v: string) => { headers[k] = v; },
      };
      const h = attachHtmx(ctx, eng);
      assert.equal(h.isHtmx, true);
      h.hx({ trigger: 'x' }).view('p', { t: 'Hi' });
      assert.equal(body, '<h1>Hi</h1>');   // fragment only (no layout) for HX request
      assert.equal(code, 200);
      assert.equal(headers['HX-Trigger'], 'x');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

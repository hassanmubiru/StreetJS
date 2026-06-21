// @streetjs/plugin-htmx — minimal example (no app server required).
// Demonstrates the dependency-free view engine + HTMX helpers in isolation.
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ViewEngine, isHtmxRequest, hxHeaders, csrfField } from '@streetjs/plugin-htmx';

const dir = mkdtempSync(join(tmpdir(), 'htmx-example-'));
mkdirSync(join(dir, 'layouts')); mkdirSync(join(dir, 'partials')); mkdirSync(join(dir, 'pages'));
writeFileSync(join(dir, 'layouts', 'main.html'), '<!doctype html><title>{{ title }}</title><main>{{{ body }}}</main>');
writeFileSync(join(dir, 'partials', 'todo.html'), '<li>{{ text }}</li>');
writeFileSync(join(dir, 'pages', 'home.html'), '<h1>{{ title }}</h1><ul>{{> todo }}</ul>');

const engine = new ViewEngine({ viewsDir: dir, layout: 'main' });

console.log('--- full page (browser navigation) ---');
console.log(engine.view('home', { title: 'Todos', text: 'Ship HTMX plugin' }));

console.log('\n--- fragment (HTMX request) ---');
console.log(engine.view('home', { title: 'Todos', text: 'Ship HTMX plugin' }, { wrap: false }));

console.log('\n--- helpers ---');
console.log('isHtmx:', isHtmxRequest({ 'HX-Request': 'true' }));
console.log('HX headers:', hxHeaders({ trigger: 'todoAdded', retarget: '#list' }));
console.log('csrf:', csrfField('tok-123'));

rmSync(dir, { recursive: true, force: true });

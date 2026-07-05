#!/usr/bin/env node
// @streetjs/devtools — CLI that renders the browser bundle to a static HTML file
// for embedding into the GitHub Pages docs site (Req 7.6 / 7.8).
//
// Usage:
//   streetjs-devtools --out <path>     write the demo bundle to <path>
//   streetjs-devtools                  print the demo bundle to stdout
//
// With no application attached, the CLI emits the self-contained demo experience
// so the published docs site can render every tool. A live application can wire
// `buildDevtoolsData(app)` + `renderDevtoolsBundle(...)` programmatically.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { renderDevtoolsBundle } from './bundle.js';
import { demoDevtoolsData } from './data.js';
function parseArgs(argv) {
    const args = {};
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if ((a === '--out' || a === '-o') && argv[i + 1]) {
            args.out = argv[++i];
        }
    }
    return args;
}
function main() {
    const { out } = parseArgs(process.argv.slice(2));
    const html = renderDevtoolsBundle(demoDevtoolsData());
    if (out) {
        const target = resolve(process.cwd(), out);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, html, 'utf8');
        process.stdout.write(`Wrote devtools bundle to ${target}\n`);
    }
    else {
        process.stdout.write(html);
    }
}
main();
//# sourceMappingURL=cli.js.map
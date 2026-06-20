const css = require('fs').readFileSync('/tmp/site.css', 'utf8');
// crude rule splitter: capture "selector { body }" at top level (ignores @media nesting wrappers)
const ruleRe = /([^{}]+)\{([^{}]*)\}/g;
const lightVals = [
  '#fff', '#ffffff', '#f5f6fa', '#eeebee', '#f7f7f7', '#fafafa', '#f9f9f9',
  'rgb(234.8', '#f3f3f3', '#e6e6e6', '#ececec', 'white'
];
const props = ['background', 'background-color', 'border', 'border-bottom', 'border-top', 'border-left', 'border-right', 'border-color', 'box-shadow', 'fill'];
let m, hits = [];
while ((m = ruleRe.exec(css))) {
  const sel = m[1].trim().replace(/\s+/g, ' ');
  const body = m[2].toLowerCase();
  if (sel.startsWith('@') || sel.includes('var(') ) {} // keep
  for (const lv of lightVals) {
    // find prop declarations containing the light value
    const decls = body.split(';');
    for (const d of decls) {
      const dd = d.trim();
      if (!dd) continue;
      const p = dd.split(':')[0].trim();
      if (!props.includes(p)) continue;
      if (dd.includes(lv.toLowerCase())) {
        hits.push({ sel, decl: dd });
      }
    }
  }
}
// dedupe
const seen = new Set();
const out = hits.filter(h => { const k = h.sel + '||' + h.decl; if (seen.has(k)) return false; seen.add(k); return true; });
// filter out ones that are clearly intentional white-on-accent (color not bg) — we only kept bg/border/shadow props
for (const h of out) console.log(h.sel.slice(0, 90) + '  ==>  ' + h.decl.slice(0, 70));
console.log('\nTOTAL light-bg/border rules:', out.length);

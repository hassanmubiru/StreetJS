const css = require('fs').readFileSync('/tmp/site.css', 'utf8');
function rule(sel) {
  const i = css.indexOf(sel);
  if (i < 0) return console.log('MISSING: ' + sel);
  const open = css.indexOf('{', i), close = css.indexOf('}', open);
  console.log(sel + '  =>  ' + css.slice(open + 1, close).trim().slice(0, 160));
}
rule('.rouge-table td.rouge-code pre');
rule('.rouge-table pre.lineno');
// the big td neutralizer (find selector list containing rouge-table td and border:none)
const m = css.match(/\.rouge-table td[^{]*\{[^}]*border:\s*none[^}]*\}/);
console.log('td neutralizer:', m ? m[0].slice(0, 200) : 'MISSING');
// decorator + string in dark
const d = css.match(/--syn-decorator:\s*#22C55E/i);
console.log('dark decorator token:', d ? d[0] : 'MISSING');

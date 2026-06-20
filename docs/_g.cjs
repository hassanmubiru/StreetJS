const css = require('fs').readFileSync('/tmp/site.css', 'utf8');
// find dark-mode rules that target a bare pre inside .home .codewin and set background #111827
const idx = css.indexOf('data-theme=dark] .home .codewin');
console.log('first dark codewin rule at index:', idx);
// pull the selector list around the first #111827 background within a codewin context
const re = /([^{}]*\.home \.codewin[^{}]*pre[^{}]*)\{([^}]*)\}/g;
let m, found = 0;
while ((m = re.exec(css)) && found < 6) {
  console.log('SEL:', m[1].trim().slice(0, 160));
  console.log('  DECL:', m[2].trim().slice(0, 120));
  found++;
}
console.log('matches:', found);

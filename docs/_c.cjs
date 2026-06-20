function rgb(h){h=h.replace('#','');return[0,2,4].map(i=>parseInt(h.substr(i,2),16));}
function lin(c){c/=255;return c<=0.03928?c/12.92:Math.pow((c+0.055)/1.055,2.4);}
function lum(a){return 0.2126*lin(a[0])+0.7152*lin(a[1])+0.0722*lin(a[2]);}
function ratio(a,b){const L1=lum(a),L2=lum(b),hi=Math.max(L1,L2),lo=Math.min(L1,L2);return (hi+0.05)/(lo+0.05);}
const panel='#111827';
const t=[
 ['code-text #D1D5DB',  '#D1D5DB'],
 ['comment #94A3B8',    '#94A3B8'],
 ['keyword #60A5FA',    '#60A5FA'],
 ['decorator #22C55E',  '#22C55E'],
 ['string #FBBF24',     '#FBBF24'],
];
let fail=0;
for(const [n,c] of t){const r=ratio(rgb(c),rgb(panel));const ok=r>=4.5;if(!ok)fail++;console.log(`${ok?'PASS':'FAIL'}  ${r.toFixed(2)}:1  ${n} on ${panel}`);}
console.log(`outer frame #0B1220 lum ${lum(rgb('#0B1220')).toFixed(4)} (dark ✓), panel #111827 lum ${lum(rgb('#111827')).toFixed(4)}`);
console.log(`\n${t.length-fail}/${t.length} pass AA`);

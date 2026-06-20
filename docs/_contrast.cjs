// WCAG contrast verification for the refined dark theme.
function hexToRgb(h) {
  h = h.replace('#', '');
  return [0, 2, 4].map(i => parseInt(h.substr(i, 2), 16));
}
function lin(c) { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
function lum([r, g, b]) { return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b); }
// composite a translucent fg (rgba over solid bg)
function over(fgHex, alpha, bgHex) {
  const f = hexToRgb(fgHex), b = hexToRgb(bgHex);
  return f.map((c, i) => Math.round(c * alpha + b[i] * (1 - alpha)));
}
function ratio(a, b) { const L1 = lum(a), L2 = lum(b); const hi = Math.max(L1, L2), lo = Math.min(L1, L2); return (hi + 0.05) / (lo + 0.05); }
function rgb(h) { return hexToRgb(h); }

const bg = '#0B0F19', surface = '#111827', surface2 = '#1F2937', codebg = '#111827';
const tests = [
  ['heading #F9FAFB on bg', rgb('#F9FAFB'), rgb(bg), 4.5],
  ['text-primary #E5E7EB on bg', rgb('#E5E7EB'), rgb(bg), 4.5],
  ['text-secondary #9CA3AF on bg (body)', rgb('#9CA3AF'), rgb(bg), 4.5],
  ['text-secondary on surface', rgb('#9CA3AF'), rgb(surface), 4.5],
  ['text-muted #8A93A3 on bg', rgb('#8A93A3'), rgb(bg), 4.5],
  ['text-muted on surface', rgb('#8A93A3'), rgb(surface), 4.5],
  ['text-muted on surface-2', rgb('#8A93A3'), rgb(surface2), 4.5],
  ['accent link #60A5FA on bg', rgb('#60A5FA'), rgb(bg), 4.5],
  ['accent link on surface', rgb('#60A5FA'), rgb(surface), 4.5],
  ['code-text #D1D5DB on code-bg', rgb('#D1D5DB'), rgb(codebg), 4.5],
  ['white on btn solid #2563EB', rgb('#FFFFFF'), rgb('#2563EB'), 4.5],
  ['syn-comment #8B98AC on codebg', rgb('#8B98AC'), rgb(codebg), 4.5],
  ['syn-string #6EE7B7 on codebg', rgb('#6EE7B7'), rgb(codebg), 4.5],
  ['syn-keyword #93C5FD on codebg', rgb('#93C5FD'), rgb(codebg), 4.5],
  // translucent card text: text-secondary over (elevated card = white .03 over bg)
  ['body on card (rgba white .03 / bg)', rgb('#9CA3AF'), over('#FFFFFF', 0.03, bg), 4.5],
  ['heading on card', rgb('#F9FAFB'), over('#FFFFFF', 0.03, bg), 4.5],
];
let fails = 0;
for (const [name, fg, bgc, min] of tests) {
  const r = ratio(fg, bgc);
  const ok = r >= min;
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${r.toFixed(2)}:1  (min ${min})  ${name}`);
}
console.log(`\n${tests.length - fails}/${tests.length} pass`);

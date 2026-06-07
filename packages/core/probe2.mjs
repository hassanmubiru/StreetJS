import { parseProto } from './dist/microservices/grpc/proto-parser.js';
function timeMs(fn){const t0=process.hrtime.bigint();try{fn();}catch{}const t1=process.hrtime.bigint();return Number(t1-t0)/1e6;}
function curve(label, make){
  console.log(`\n== ${label} ==`);
  let prev=0;
  for (const N of [2000,4000,8000,16000,32000]) {
    const input=make(N);
    const s=[timeMs(()=>parseProto(input)),timeMs(()=>parseProto(input)),timeMs(()=>parseProto(input))].sort((a,b)=>a-b);
    const t=s[1]; const r=prev?(t/prev).toFixed(2):'-';
    console.log(`N=${N}\t${t.toFixed(2)} ms\tx${r}`);
    prev=t;
  }
}
// unterminated block-comment openers (no '*/' substring)
curve("'/*a'.repeat(N) — openers, no closer", (N)=>'/*a'.repeat(N));
curve("'/* '.repeat(N) — openers, no closer", (N)=>'/* '.repeat(N));
// single opener then long run with no closer
curve("'/*' + 'a'.repeat(N)", (N)=>'/*'+'a'.repeat(N));

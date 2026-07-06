#!/usr/bin/env bash
set -uo pipefail
START=$(date +%s)
pass=0
fail=0
failed=""
mapfile -t pkgs < <(node -e 'const fs=require("fs");for(const d of fs.readdirSync("packages").sort()){const pj="packages/"+d+"/package.json";if(!fs.existsSync(pj))continue;const p=JSON.parse(fs.readFileSync(pj,"utf8"));if(p.private===true)continue;const s=p.scripts||{};if(s.build)console.log(d);}')
for d in "${pkgs[@]}"; do
  if (cd "packages/$d" && npm run build >/tmp/bw_out.log 2>&1); then
    pass=$((pass+1))
  else
    fail=$((fail+1))
    failed="$failed $d"
  fi
done
END=$(date +%s)
echo "TOTAL_PACKAGES=${#pkgs[@]}"
echo "PASS=$pass"
echo "FAIL=$fail"
echo "FAILED_LIST=$failed"
echo "ELAPSED_SECONDS=$((END-START))"

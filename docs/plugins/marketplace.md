---
layout:      default
title:       "Plugin Marketplace"
permalink:   /plugins/marketplace/
nav_exclude: true
description:  "Browse official StreetJS plugins — databases, cache, messaging, storage, payments, auth, communications and AI. Signed, dependency-free, and installable from npm."
---

<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">

{%- assign data = site.data.plugins -%}

<!-- SEO: ItemList of all official plugins -->
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "ItemList",
  "name": "StreetJS Official Plugins",
  "description": "Official, signed, dependency-free plugins for the StreetJS TypeScript backend framework.",
  "numberOfItems": {{ data.count }},
  "itemListElement": [
    {%- for p in data.plugins -%}
    {"@type":"ListItem","position":{{ forloop.index }},"name":{{ p.name | jsonify }},"url":{{ p.npm | jsonify }}}{%- unless forloop.last -%},{%- endunless -%}
    {%- endfor -%}
  ]
}
</script>

<style>
.mkt{--fh:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-family:var(--fh)}
.mkt .mkt-head{margin:0 0 1.75rem}
.mkt .mkt-head h1{font-size:clamp(1.8rem,3.4vw,2.4rem)!important;font-weight:800!important;letter-spacing:-.03em!important;color:var(--heading)!important;margin:0 0 .5rem!important;border:none!important;padding:0!important}
.mkt .mkt-head h1::before{display:none!important}
.mkt .mkt-sub{color:var(--text-muted);font-size:1.02rem;line-height:1.6;margin:0 0 .35rem;max-width:680px}
.mkt .mkt-meta{font-size:.8rem;color:var(--text-muted)}
.mkt .mkt-controls{display:flex;flex-wrap:wrap;gap:.7rem;align-items:center;margin:1.5rem 0}
.mkt .mkt-search{flex:1 1 240px;min-width:200px;font-family:var(--fh);font-size:.92rem;
  background:var(--bg);border:1px solid var(--border);color:var(--text-primary);border-radius:9px;padding:.6rem .85rem}
.mkt .mkt-search:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-soft)}
.mkt .chips{display:flex;flex-wrap:wrap;gap:.4rem}
.mkt .chip{font-size:.78rem;font-weight:600;color:var(--text-muted);background:var(--elevated);
  border:1px solid var(--border);border-radius:100px;padding:.34rem .8rem;cursor:pointer;transition:all .14s ease}
.mkt .chip:hover{border-color:var(--accent-line);color:var(--accent)}
.mkt .chip.on{background:var(--accent-soft);border-color:var(--accent-line);color:var(--accent)}
.mkt .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:1rem;margin-top:.5rem}
.mkt .card{display:flex;flex-direction:column;background:var(--elevated);border:1px solid var(--border);
  border-radius:14px;padding:1.25rem;transition:all .16s ease}
.mkt .card:hover{border-color:var(--accent-line);transform:translateY(-3px);box-shadow:var(--shadow-md)}
.mkt .card-top{display:flex;align-items:center;justify-content:space-between;gap:.5rem;margin-bottom:.6rem}
.mkt .cat{font-size:.66rem;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--accent);
  background:var(--accent-soft);border:1px solid var(--accent-line);border-radius:100px;padding:.2rem .6rem}
.mkt .tier{font-size:.66rem;font-weight:700;color:var(--success);background:var(--success-soft);
  border:1px solid var(--success-line);border-radius:100px;padding:.2rem .6rem}
.mkt .card h3{font-size:1.02rem!important;font-weight:700!important;color:var(--text-primary)!important;margin:.1rem 0 .35rem!important}
.mkt .card .pkg{font-family:'JetBrains Mono',monospace;font-size:.76rem;color:var(--text-muted);margin:0 0 .55rem;word-break:break-all}
.mkt .card .desc{font-size:.88rem;color:var(--text-muted);line-height:1.55;margin:0 0 1rem;flex:1}
.mkt .card .row{display:flex;align-items:center;justify-content:space-between;gap:.5rem}
.mkt .card .ver{font-family:'JetBrains Mono',monospace;font-size:.74rem;color:var(--text-muted)}
.mkt .card .npm{font-size:.82rem;font-weight:600;color:var(--accent)!important;text-decoration:none!important}
.mkt .card .npm:hover{text-decoration:underline!important}
.mkt .empty{display:none;color:var(--text-muted);padding:2rem 0;text-align:center}
.mkt .cmd{font-family:'JetBrains Mono',monospace;font-size:.82rem;background:var(--code-bg);color:var(--code-text);
  border:1px solid var(--code-border);border-radius:8px;padding:.5rem .8rem;margin:.4rem 0 0;display:inline-block}
</style>

<div class="mkt" markdown="0">

<div class="mkt-head">
  <h1>Plugin Marketplace</h1>
  <p class="mkt-sub">Official, signed, dependency-free plugins for StreetJS — install any of them from npm and register with the plugin host. No third-party runtime dependencies.</p>
  <p class="mkt-meta">{{ data.count }} official plugins · {{ data.categories | size }} categories · updated {{ data.generated }}</p>
  <span class="cmd">npm install {{ data.plugins[0].name }}</span>
</div>

<div class="mkt-controls">
  <input type="search" class="mkt-search" id="mkt-search" placeholder="Search plugins (e.g. stripe, redis, auth)…" aria-label="Search plugins">
  <div class="chips" id="mkt-chips">
    <span class="chip on" data-cat="all">All</span>
    {%- for c in data.categories -%}
    <span class="chip" data-cat="{{ c.name }}">{{ c.name }}</span>
    {%- endfor -%}
  </div>
</div>

<div class="grid" id="mkt-grid">
  {%- for p in data.plugins -%}
  <div class="card" data-cat="{{ p.category }}" data-text="{{ p.name }} {{ p.title }} {{ p.description }} {{ p.keywords | join: ' ' }}">
    <div class="card-top">
      <a class="cat" href="{{ site.baseurl }}/plugins/category/{{ p.catSlug }}/">{{ p.category }}</a>
      <span class="tier">{{ p.tier }}</span>
    </div>
    <h3><a href="{{ site.baseurl }}/plugins/{{ p.slug }}/" style="color:inherit;text-decoration:none">{{ p.title }}</a></h3>
    <p class="pkg">{{ p.name }}</p>
    <p class="desc">{{ p.description }}</p>
    <div class="row">
      <a class="ver" href="{{ site.baseurl }}/plugins/{{ p.slug }}/" style="text-decoration:none">Details →</a>
      <a class="npm" href="{{ p.npm }}" target="_blank" rel="noopener">npm →</a>
    </div>
  </div>
  {%- endfor -%}
</div>
<p class="empty" id="mkt-empty">No plugins match your search.</p>

</div>

<script>
(function () {
  var search = document.getElementById('mkt-search');
  var chips = document.getElementById('mkt-chips');
  var cards = Array.prototype.slice.call(document.querySelectorAll('#mkt-grid .card'));
  var empty = document.getElementById('mkt-empty');
  var cat = 'all', q = '';
  function apply() {
    var shown = 0;
    cards.forEach(function (c) {
      var okCat = cat === 'all' || c.getAttribute('data-cat') === cat;
      var okQ = !q || c.getAttribute('data-text').toLowerCase().indexOf(q) !== -1;
      var vis = okCat && okQ;
      c.style.display = vis ? '' : 'none';
      if (vis) shown++;
    });
    empty.style.display = shown ? 'none' : 'block';
  }
  search.addEventListener('input', function () { q = this.value.trim().toLowerCase(); apply(); });
  chips.addEventListener('click', function (e) {
    var chip = e.target.closest('.chip'); if (!chip) return;
    cat = chip.getAttribute('data-cat');
    Array.prototype.forEach.call(chips.querySelectorAll('.chip'), function (x) { x.classList.toggle('on', x === chip); });
    apply();
  });
})();
</script>

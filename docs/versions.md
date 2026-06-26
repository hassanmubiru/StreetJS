---
layout:    default
title:     "Versions"
nav_order: 95
permalink: /versions/
description: "How StreetJS documentation is versioned, which release these docs track, and where to find docs and changelogs for earlier versions."
---

{% include doc-styles.html %}

<div class="doc-header">
<span class="dh-label">Reference</span>
<h1>Documentation versions</h1>
<p>These docs always track the latest published release. This page explains the
versioning policy and where to find documentation and changelogs for earlier
versions.</p>
</div>

## Current version

This site documents **StreetJS v{{ site.version }}** — the version is injected at
build time from the published [`@streetjs/cli`](https://www.npmjs.com/package/@streetjs/cli)
package, so it can never drift from the released package.

> The full version-support window, LTS status, and backport policy live in the
> [Support Matrix]({{ '/enterprise/support-matrix/' | relative_url }}).

---

## Versioning policy

- **Docs track latest.** The published site always reflects the newest release on
  the `main` branch. Breaking changes are called out in the
  [Changelog]({{ '/changelog/' | relative_url }}) and the relevant guide pages.
- **Semantic Versioning.** `@streetjs/core` follows
  [SemVer 2.0.0](https://semver.org/spec/v2.0.0.html). A major bump signals a
  breaking change; the changelog records the migration path.
- **Per-release evidence is immutable.** Every release tag carries its own
  reproducible CycloneDX SBOM and npm provenance attestation (see the
  [Trust Center](https://github.com/hassanmubiru/StreetJS/blob/main/security/TRUST-CENTER.md)).

---

## Finding docs for an earlier version

Because the docs site tracks latest, earlier-version documentation is retrieved
from the corresponding git tag rather than hosted as a separate site:

| Need | Where |
|---|---|
| Changelog for any version | [Changelog]({{ '/changelog/' | relative_url }}) / [`CHANGELOG.md`](https://github.com/hassanmubiru/StreetJS/blob/main/CHANGELOG.md) |
| Docs as they were at version `vX.Y.Z` | Browse the repo at that tag: `https://github.com/hassanmubiru/StreetJS/tree/vX.Y.Z/docs` |
| Migrating between majors | [Migration guide]({{ '/migration/' | relative_url }}) |
| Support window / LTS / backports | [Support Matrix]({{ '/enterprise/support-matrix/' | relative_url }}) |
| API surface at a release | The published package on npm for that version |

To read the docs exactly as they shipped with, say, `v1.0.25`:

```bash
git clone https://github.com/hassanmubiru/StreetJS
cd StreetJS
git checkout v1.0.25
# docs/ now reflects that release
```

---

## Roadmap: browsable multi-version docs

A version selector that serves multiple doc trees side by side (in the style of
Docusaurus/Nuxt) is tracked as a roadmap item. The current policy — latest docs +
tagged historical source + an immutable changelog — covers the common need
(finding what changed and reading older docs) without the maintenance cost of
duplicating the full site per release. See
[plans/OUTSTANDING-ACTIONS.md](https://github.com/hassanmubiru/StreetJS/blob/main/plans/OUTSTANDING-ACTIONS.md).

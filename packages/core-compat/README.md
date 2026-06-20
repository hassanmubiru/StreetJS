<p align="center">
  <img src="https://raw.githubusercontent.com/hassanmubiru/StreetJS/main/docs/assets/images/logo-512.png" alt="StreetJS logo" width="100" height="100">
</p>

# @streetjs/core (deprecated)

> **Deprecated.** This package has been renamed to **`streetjs`**.
> It now re-exports `streetjs` unchanged and is kept only for backward
> compatibility. Please migrate:

```diff
- npm install @streetjs/core
+ npm install streetjs
```

```diff
- import { streetApp } from '@streetjs/core';
+ import { streetApp } from 'streetjs';
```

The export surface is identical — every named export and subpath
(`@streetjs/core/http`, `/router`, `/database`, …) maps 1:1 to the same
export in `streetjs`. See the migration guide: docs/migration.md.

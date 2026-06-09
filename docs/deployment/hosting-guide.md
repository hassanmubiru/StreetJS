---
layout:    default
title:     "GitHub Pages & npm Publishing"
parent:    "Deployment"
nav_order: 2
permalink: /deployment/hosting-guide/
---

# Hosting Guide: GitHub Pages + npm

Complete step-by-step instructions for publishing the street framework as an npm package and hosting its documentation on GitHub Pages.

---

## Part 1 — Publish to npm

### Prerequisites

- An npm account at [npmjs.com](https://www.npmjs.com)
- npm CLI ≥ 9 (`npm --version`)
- A GitHub repository for the project

---

### Step 1: Choose your package name

The `package.json` uses `streetjs` (a scoped package). Scoped packages require either:
- A free npm organisation (`@streetjs`) — create at npmjs.com/org/create
- Or use an unscoped name like `street-framework`

Check availability:

```bash
npm view streetjs          # If this 404s, the name is free
npm view street-framework        # Check unscoped alternative
```

To change the name, edit `package.json`:

```json
{ "name": "@hassanmubiru/street" }
```

---

### Step 2: Create an npm access token

1. Log in at [npmjs.com](https://www.npmjs.com)
2. Click your avatar → **Access Tokens**
3. Click **Generate New Token** → **Granular Access Token**
4. Set:
   - **Token name**: `github-actions-street`
   - **Expiration**: 365 days (or no expiry)
   - **Packages and scopes**: Read and write
   - **Selected packages**: `streetjs` (or your chosen name)
5. Copy the token — you will not see it again

---

### Step 3: Add the token to GitHub Secrets

In your GitHub repository:

1. Go to **Settings** → **Secrets and variables** → **Actions**
2. Click **New repository secret**
3. Name: `NPM_TOKEN`
4. Value: paste the npm token
5. Click **Add secret**

Also add the CI session key secret:

```bash
# Generate a SESSION_KEY for CI
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

- Name: `CI_SESSION_KEY`
- Value: the 64-character hex string

---

### Step 4: First manual publish (one-time setup)

Before the automated workflow runs, publish once manually to create the package on npm and set access to public:

```bash
# Log in to npm
npm login
# Enter your username, password, and OTP (if 2FA enabled)

# Build the library
npm run build

# Publish (first time, sets access=public)
npm publish --access public
```

If you used a scoped name and it fails with "402 Payment Required", add `--access public` — scoped packages are private by default.

---

### Step 5: Verify the publish

```bash
npm view streetjs
# Should show version, description, exports etc.

# Test install in a temporary directory
mkdir /tmp/test-street && cd /tmp/test-street
npm init -y
npm install streetjs
node -e "import('streetjs').then(m => console.log(Object.keys(m)))"
```

---

### Step 6: Automated releases via git tags

Every push of a `v*.*.*` tag triggers the `test-and-publish` job in the consolidated `ci-cd.yml` workflow:

```bash
# Bump version (e.g., patch: 1.0.0 → 1.0.1)
npm run version:patch

# Commit and tag
git add package.json CHANGELOG.md
git commit -m "chore: release v1.0.1"
git tag v1.0.1

# Push — this triggers the test-and-publish job
git push origin main --tags
```

The job will:
1. Wait for the core `build-and-test` job to pass
2. Verify the package version matches the git tag
3. Build the library with `tsconfig.lib.json`
4. Run lint, security, memory-safety, and infrastructure tests
5. Run `npm publish --provenance` (npm provenance links the package to the exact commit)

---

### Step 7: Verify automated publish

1. Go to the **Actions** tab in GitHub → select the `CI/CD` workflow run
2. Find the `test-and-publish` job (only runs on tag pushes)
3. Watch each step complete
4. Check https://www.npmjs.com/package/streetjs for the new version

---

### What gets published

The `files` field in `package.json` controls what is included:

```
dist/src/**/*.js        ← Compiled JavaScript
dist/src/**/*.d.ts      ← TypeScript declarations
dist/src/**/*.js.map    ← Source maps
migrations/             ← SQL migration files
README.md
LICENSE
CHANGELOG.md
```

What is **excluded** (via `.npmignore`):
- `src/` — TypeScript source (consumers use compiled `dist/`)
- `tests/` — test files
- `dist/tests/` — compiled tests
- `dist/src/main.*` — app entry point (not a library export)
- `dist/src/controllers/`, `dist/src/services/`, `dist/src/domain/` — example app code
- `Dockerfile`, `.github/`, `docs/` — dev tooling

---

## Part 2 — Host docs on GitHub Pages

### Step 1: Enable GitHub Pages in repository settings

1. Go to your repository → **Settings** → **Pages**
2. Under **Source**, select **GitHub Actions**
3. Leave everything else as default
4. Click **Save**

---

### Step 2: Configure your site URL

Edit `docs/_config.yml` and replace the placeholder URLs:

```yaml
url:     "https://YOUR-USERNAME.github.io"
baseurl: "/street"    # Must match your repository name exactly
```

Also update the GitHub edit link:

```yaml
gh_edit_repository: "https://github.com/YOUR-USERNAME/street"
```

And the aux links:

```yaml
aux_links:
  "GitHub":
    - "https://github.com/YOUR-USERNAME/street"
  "npm":
    - "https://www.npmjs.com/package/@YOUR-SCOPE/street"
```

---

### Step 3: Install Ruby dependencies locally (for preview)

```bash
cd docs
gem install bundler
bundle install
```

Preview the site locally:

```bash
bundle exec jekyll serve --livereload
# Open http://localhost:4000/street in your browser
```

The sidebar should show the full navigation tree:
- Home
- Getting Started
  - Installation
  - Project Structure
  - First Server
  - Configuration
- Core
  - Dependency Injection
  - Routing
  - Controllers
  - Middleware & Validation
- Database
- Security
- Realtime
- Storage
- Performance
- CLI
- Deployment
- Testing
- Examples

---

### Step 4: Push to deploy

```bash
git add docs/
git commit -m "docs: add Jekyll site with just-the-docs theme"
git push origin main
```

GitHub Pages deployment is handled automatically by GitHub when pushing to the default branch with changes in the `docs/` directory. To deploy:

1. Go to **Actions** → **CI/CD**
2. Wait for the workflow to complete
3. Your site will be live at: `https://YOUR-USERNAME.github.io/street`

---

### Step 5: Add a custom domain (optional)

To use `docs.streetframework.dev` instead of `github.io`:

1. Add a `CNAME` file to the `docs/` directory:

```bash
echo "docs.streetframework.dev" > docs/CNAME
```

2. Update `_config.yml`:

```yaml
url:     "https://docs.streetframework.dev"
baseurl: ""
```

3. In your DNS provider, add a CNAME record:
   - Host: `docs`
   - Points to: `YOUR-USERNAME.github.io`

4. In GitHub → Settings → Pages → Custom domain: enter `docs.streetframework.dev` and enable **Enforce HTTPS**

---

### Step 6: Adding new documentation pages

1. Create a Markdown file in the appropriate `docs/` subdirectory
2. Add Jekyll front matter at the top:

```markdown
---
layout:    default
title:     "My New Page"
parent:    "Getting Started"
nav_order: 5
---

# My New Page

Content goes here.
```

3. Commit and push — the site redeploys automatically

---

## Part 3 — Keep both in sync

### Updating docs with every release

Since the CI/CD workflow is consolidated into a single `ci-cd.yml` file, a simple `git push` automatically triggers the full pipeline including the `test-and-publish` job on tag pushes. Documentation updates pushed to `main` will deploy automatically.

### Badges in README

After publishing, add live badges to `README.md`:

```markdown
[![npm version](https://img.shields.io/npm/v/streetjs.svg)](https://www.npmjs.com/package/streetjs)
[![npm downloads](https://img.shields.io/npm/dm/streetjs.svg)](https://www.npmjs.com/package/streetjs)
[![Docs](https://img.shields.io/badge/docs-GitHub%20Pages-blue)](https://hassanmubiru.github.io/street)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
```

---

## Checklist

### Before first npm publish

- [ ] `npm view streetjs` returns 404 (name is available)
- [ ] `NPM_TOKEN` secret added to GitHub repository
- [ ] `CI_SESSION_KEY` secret added to GitHub repository
- [ ] `package.json` `name`, `homepage`, `repository.url` updated to real values
- [ ] `npm run build` succeeds locally
- [ ] `npm pack --dry-run` shows only intended files

### Before enabling GitHub Pages

- [ ] `docs/_config.yml` `url` and `baseurl` set to real values
- [ ] `docs/_config.yml` `gh_edit_repository` points to real repository
- [ ] GitHub Pages source set to **GitHub Actions** in repository Settings
- [ ] `bundle exec jekyll serve` previews correctly locally

### After go-live

- [ ] `https://YOUR-USERNAME.github.io/street` loads and all nav links work
- [ ] `https://www.npmjs.com/package/streetjs` shows correct metadata
- [ ] `npm install streetjs` in a test project resolves correctly
- [ ] TypeScript `import { streetApp } from 'streetjs'` resolves types correctly

---
layout:      default
title:       "Deployment"
parent:      "HTMX"
nav_order:   7
permalink:   /htmx/deployment/
description:  "Deploy a server-rendered StreetJS + HTMX app — serving views and static assets, Docker, and single-VPS hosting."
---

# Deployment

An HTMX app is just a StreetJS app that returns HTML, so deployment is the same as
any StreetJS service — with two extras: ship your `src/views/` templates and serve
`public/` static assets.

## Build & ship views

The view engine reads templates from `viewsDir` at runtime, so include them in the
build output / image. Ensure `src/views/**` is copied alongside `dist/` (templates
are data, not compiled). In your `Dockerfile`:

```dockerfile
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
# views + static assets travel with the app:
#   src/views/**, public/**
CMD ["node", "dist/main.js"]
```

Point the middleware at the shipped path:

```ts
app.use(HtmxPlugin.middleware({ viewsDir: 'src/views', layout: 'main' }));
```

## Static assets

Serve `public/` (htmx is loaded from a CDN in the starter layout; vendor it into
`public/` if you prefer no external requests). Use the core static-file middleware
or your reverse proxy.

## Caching

The view engine caches compiled template sources in memory (bounded). In
production this is ideal; in development call `engine.clearCache()` on file change
for hot-reload.

## Single VPS

Because auth, sessions, realtime and the database driver run in-process, an HTMX
StreetJS app self-hosts comfortably on one small VPS — see the
[budget deployment guide](/StreetJS/deployment/budget/) and
[self-hosting cost](/StreetJS/blog/self-hosting-cost/).

## Docker

The `--frontend htmx` scaffold includes a `Dockerfile` and CI workflow (backend
only — no separate web build). See [Deployment](/StreetJS/deployment/docker/).

// public/islands.js — hydrate @streetjs/auth-ui & @streetjs/admin-ui React islands.
// No build step: React and the UI packages resolve through the importmap declared in
// layouts/dashboard.html. Each [data-street-component] element renders its component
// with the JSON props carried in data-street-props.
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';

const PACKAGES = {
  '@streetjs/auth-ui': () => import('@streetjs/auth-ui'),
  '@streetjs/admin-ui': () => import('@streetjs/admin-ui'),
};

async function mount(el) {
  const pkgName = el.getAttribute('data-street-pkg');
  const componentName = el.getAttribute('data-street-component');
  const props = JSON.parse(el.getAttribute('data-street-props') || '{}');
  const loader = PACKAGES[pkgName];
  if (!loader) return;
  const mod = await loader();
  const Component = mod[componentName];
  if (!Component) return;
  createRoot(el).render(createElement(Component, props));
}

for (const el of document.querySelectorAll('[data-street-component]')) {
  mount(el).catch((err) => console.error('[street] island mount failed', err));
}

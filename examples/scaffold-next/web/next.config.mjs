import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/** @type {import('next').NextConfig} */
const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';

const nextConfig = {
  // Pin the workspace root to this app so Next does not infer a parent directory
  // when a sibling/parent lockfile exists (the backend ships its own lockfile).
  turbopack: { root: dirname(fileURLToPath(import.meta.url)) },
  async rewrites() {
    // Proxy API/auth/health calls to the Street backend so cookies stay
    // first-party. The dev server runs on a different port (see package.json)
    // so these never proxy back to Next itself.
    return [
      { source: '/api/:path*', destination: apiUrl + '/api/:path*' },
      { source: '/auth/:path*', destination: apiUrl + '/auth/:path*' },
      { source: '/health', destination: apiUrl + '/health' },
      { source: '/search', destination: apiUrl + '/search' },
    ];
  },
};

export default nextConfig;

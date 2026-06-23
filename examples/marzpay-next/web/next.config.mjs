import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/** @type {import('next').NextConfig} */
const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';

const nextConfig = {
  // Pin the workspace root to this app so Next does not infer a parent directory
  // when a sibling/parent lockfile exists (the backend ships its own lockfile).
  turbopack: { root: dirname(fileURLToPath(import.meta.url)) },
  async rewrites() {
    // Proxy API calls to the StreetJS backend so cookies stay first-party.
    return [{ source: '/api/marzpay/:path*', destination: apiUrl + '/api/marzpay/:path*' }];
  },
};

export default nextConfig;

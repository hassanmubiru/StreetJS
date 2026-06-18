/** @type {import('next').NextConfig} */
const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';

const nextConfig = {
  async rewrites() {
    // Proxy API/auth calls to the Street backend so cookies stay first-party.
    return [
      { source: '/api/:path*', destination: apiUrl + '/api/:path*' },
      { source: '/auth/:path*', destination: apiUrl + '/auth/:path*' },
      { source: '/search', destination: apiUrl + '/search' },
    ];
  },
};

export default nextConfig;

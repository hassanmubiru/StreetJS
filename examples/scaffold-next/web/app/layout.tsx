import type { ReactNode } from 'react';
import './globals.css';
import { Providers } from './providers';

export const metadata = {
  title: 'app-next — StreetJS + Next.js',
  description: 'Full-stack TypeScript app powered by StreetJS: auth, realtime, ORM, jobs, AI, and plugins.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

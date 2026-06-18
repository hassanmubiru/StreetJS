import type { ReactNode } from 'react';
import { Providers } from './providers.js';

export const metadata = { title: 'my-app' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, sans-serif' }}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

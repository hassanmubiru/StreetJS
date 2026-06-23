import type { ReactNode } from 'react';
import './globals.css';
import { Providers } from './providers';

export const metadata = {
  title: 'MarzPay Next.js Example — StreetJS',
  description: 'A Next.js App Router MarzPay checkout that calls a StreetJS backend.',
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

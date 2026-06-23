// Minimal ambient shims so the generated files type-check without installing
// the `next` package. These mirror the public shapes the scaffold uses.
declare module 'next/server' {
  export class NextResponse {
    static json(body: unknown, init?: { status?: number }): NextResponse;
  }
}

declare module 'next/link' {
  import type { ReactNode } from 'react';
  export interface LinkProps {
    href: string;
    children?: ReactNode;
  }
  const Link: (props: LinkProps) => JSX.Element;
  export default Link;
}

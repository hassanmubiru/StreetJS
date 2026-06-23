import Link from 'next/link';

export default function HomePage() {
  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 640, margin: '40px auto', padding: 16 }}>
      <h1>MarzPay Next.js Example</h1>
      <p>A Next.js App Router checkout that calls a StreetJS MarzPay backend.</p>
      <p>
        <Link href="/billing">Go to billing</Link>
      </p>
    </main>
  );
}

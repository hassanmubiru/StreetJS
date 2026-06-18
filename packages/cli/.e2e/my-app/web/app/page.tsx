'use client';

import { useQuery, useAuth } from '@streetjs/react';

interface Health { status: string; uptime: number }

export default function Home() {
  const { session, loading } = useAuth();
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? '';
  const health = useQuery<Health>(() => fetch(apiUrl + '/health').then((r) => r.json()));

  return (
    <main style={{ maxWidth: 640, margin: '40px auto', padding: 16 }}>
      <h1>my-app</h1>
      <p>Next.js App Router frontend on the Street backend via @streetjs/next.</p>
      <section>
        <h2>Session</h2>
        {loading ? <p>Loading…</p> : <pre>{JSON.stringify(session ?? null, null, 2)}</pre>}
      </section>
      <section>
        <h2>Backend health</h2>
        {health.loading ? <p>Checking…</p> : <pre>{JSON.stringify(health.data, null, 2)}</pre>}
      </section>
    </main>
  );
}

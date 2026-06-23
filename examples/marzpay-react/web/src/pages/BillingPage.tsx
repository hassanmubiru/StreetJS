import { useAuth } from '@streetjs/react';
import { CheckoutPage } from './CheckoutPage';
import { SubscriptionPage } from './SubscriptionPage';
import { InvoicesPage } from './InvoicesPage';

// Billing page: the MarzPay billing hub. It composes the checkout, subscription,
// and invoices views and shows the current session via the existing @streetjs/react
// useAuth hook.
export function BillingPage() {
  const { session, loading } = useAuth();

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 720, margin: '40px auto', padding: 16 }}>
      <h1>Billing</h1>
      <section>
        <h2>Account</h2>
        {loading ? <p>Loading…</p> : <pre>{JSON.stringify(session ?? null, null, 2)}</pre>}
      </section>
      <CheckoutPage />
      <SubscriptionPage />
      <InvoicesPage />
    </main>
  );
}

'use client';

// app/billing/page.tsx — the MarzPay billing hub (Requirements 9.1, 9.2).
//
// Renders three controls: a checkout control that initiates a MarzPay payment, a
// subscription management view that displays the active plan, and an invoice
// history list. All MarzPay calls go through the typed client helpers, which call
// the StreetJS backend — the browser never holds MarzPay credentials.
import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import type { PaymentInitResult } from '@streetjs/plugin-marzpay';
import {
  initializePayment,
  fetchSubscription,
  fetchInvoices,
  type SubscriptionView,
  type InvoiceView,
} from '../lib/marzpay';

export default function BillingPage() {
  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 720, margin: '40px auto', padding: 16 }}>
      <h1>Billing</h1>
      <CheckoutControl />
      <SubscriptionSection />
      <InvoiceHistory />
    </main>
  );
}

// Checkout control: initiates a MarzPay card payment. On a verified init that
// returns a redirect URL the browser is navigated to MarzPay; otherwise the
// returned status is shown. A failed request surfaces the MarzPayError message
// (which includes the HTTP status).
function CheckoutControl() {
  const [amount, setAmount] = useState<number>(10000);
  const [currency, setCurrency] = useState<string>('UGX');
  const [country, setCountry] = useState<string>('UG');
  const [reference, setReference] = useState<string>('');
  const [result, setResult] = useState<PaymentInitResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<boolean>(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setResult(null);
    setPending(true);
    try {
      const init = await initializePayment({ amount, currency, country, reference, method: 'card' });
      setResult(init);
      if (typeof init.redirectUrl === 'string' && init.redirectUrl.trim() !== '') {
        window.location.assign(init.redirectUrl);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Payment initialization failed.');
    } finally {
      setPending(false);
    }
  }

  return (
    <section>
      <h2>Checkout</h2>
      <form onSubmit={onSubmit}>
        <label>
          Amount
          <input
            type="number"
            min={1}
            step={1}
            value={amount}
            onChange={(e) => setAmount(Number(e.target.value))}
            required
          />
        </label>
        <label>
          Currency
          <input value={currency} onChange={(e) => setCurrency(e.target.value)} required />
        </label>
        <label>
          Country
          <input value={country} onChange={(e) => setCountry(e.target.value)} required />
        </label>
        <label>
          Reference
          <input
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder="unique reference (UUID)"
            required
          />
        </label>
        <button type="submit" disabled={pending}>
          {pending ? 'Processing…' : 'Pay now'}
        </button>
      </form>
      {error !== null ? <p role="alert">{error}</p> : null}
      {result !== null ? (
        <p>
          Payment <code>{result.reference}</code> initialized (status: {result.status}).
        </p>
      ) : null}
    </section>
  );
}

// Subscription management view: displays the active subscription plan loaded
// from the backend (Requirement 9.2). An empty subscription renders an
// empty-state; a failed load renders an error indicator.
function SubscriptionSection() {
  const [subscription, setSubscription] = useState<SubscriptionView | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetchSubscription()
      .then((value) => {
        if (active) {
          setSubscription(value);
        }
      })
      .catch((err: unknown) => {
        if (active) {
          setError(err instanceof Error ? err.message : 'Subscription is currently unavailable.');
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <section>
      <h2>Subscription</h2>
      {loading ? <p>Loading…</p> : null}
      {!loading && error !== null ? <p role="alert">{error}</p> : null}
      {!loading && error === null && subscription === null ? <p>No active subscription.</p> : null}
      {!loading && error === null && subscription !== null ? (
        <dl>
          <dt>Plan</dt>
          <dd>{subscription.planName}</dd>
          <dt>Status</dt>
          <dd>{subscription.status}</dd>
          {typeof subscription.renewsAt === 'string' ? (
            <>
              <dt>Renews</dt>
              <dd>{subscription.renewsAt}</dd>
            </>
          ) : null}
        </dl>
      ) : null}
    </section>
  );
}

// Invoice history: lists past invoices loaded from the backend. An empty
// collection renders an empty-state; a failed load renders an error indicator.
function InvoiceHistory() {
  const [invoices, setInvoices] = useState<InvoiceView[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetchInvoices()
      .then((rows) => {
        if (active) {
          setInvoices(rows);
        }
      })
      .catch((err: unknown) => {
        if (active) {
          setError(err instanceof Error ? err.message : 'Invoices are currently unavailable.');
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <section>
      <h2>Invoices</h2>
      {loading ? <p>Loading…</p> : null}
      {!loading && error !== null ? <p role="alert">{error}</p> : null}
      {!loading && error === null && invoices.length === 0 ? <p>No invoices yet.</p> : null}
      {!loading && error === null && invoices.length > 0 ? (
        <table>
          <thead>
            <tr>
              <th>Reference</th>
              <th>Amount</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {invoices.map((invoice) => (
              <tr key={invoice.id}>
                <td>
                  <code>{invoice.reference}</code>
                </td>
                <td>
                  {invoice.amount} {invoice.currency}
                </td>
                <td>{invoice.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </section>
  );
}

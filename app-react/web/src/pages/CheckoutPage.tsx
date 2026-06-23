import { useState } from 'react';
import type { FormEvent } from 'react';
import type { PaymentInitResult } from '@streetjs/plugin-marzpay';
import { initializePayment } from '../lib/marzpay';

// Checkout page: collects a payment request and initializes a MarzPay payment.
// On a verified card init that yields a redirect URL the browser is navigated to
// the MarzPay payment page; otherwise the returned status is displayed. A failed
// request surfaces the MarzPayError message (which includes the HTTP status).
export function CheckoutPage() {
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

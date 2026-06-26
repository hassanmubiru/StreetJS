import { useState } from 'react';
import type { FormEvent } from 'react';
import { initializePayment } from '../lib/marzpay';

// Subscription page: selecting a plan starts a MarzPay payment for that plan via
// the shared initializePayment client function. Plans are illustrative scaffold
// defaults; a real app reads plan definitions from configuration (see the SaaS
// billing modules).
interface Plan {
  id: string;
  name: string;
  amount: number;
  currency: string;
}

const PLANS: readonly Plan[] = [
  { id: 'basic', name: 'Basic', amount: 10000, currency: 'UGX' },
  { id: 'pro', name: 'Pro', amount: 30000, currency: 'UGX' },
];

export function SubscriptionPage() {
  const [planId, setPlanId] = useState<string>(PLANS[0].id);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<boolean>(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setStatus(null);
    setPending(true);
    const plan = PLANS.find((p) => p.id === planId);
    if (plan === undefined) {
      setError('Unknown plan "' + planId + '".');
      setPending(false);
      return;
    }
    try {
      const init = await initializePayment({
        amount: plan.amount,
        currency: plan.currency,
        country: 'UG',
        reference: 'sub-' + plan.id + '-' + Date.now().toString(),
        method: 'card',
      });
      if (typeof init.redirectUrl === 'string' && init.redirectUrl.trim() !== '') {
        window.location.assign(init.redirectUrl);
        return;
      }
      setStatus('Subscription payment for ' + plan.name + ' initialized (status: ' + init.status + ').');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Subscription payment failed.');
    } finally {
      setPending(false);
    }
  }

  return (
    <section>
      <h2>Subscription</h2>
      <form onSubmit={onSubmit}>
        <label>
          Plan
          <select value={planId} onChange={(e) => setPlanId(e.target.value)} required>
            {PLANS.map((plan) => (
              <option key={plan.id} value={plan.id}>
                {plan.name}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" disabled={pending}>
          {pending ? 'Processing…' : 'Subscribe / change plan'}
        </button>
      </form>
      {error !== null ? <p role="alert">{error}</p> : null}
      {status !== null ? <p>{status}</p> : null}
    </section>
  );
}

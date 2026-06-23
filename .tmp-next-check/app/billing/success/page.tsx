// app/billing/success/page.tsx — post-payment success route (Requirement 9.4).
//
// MarzPay redirects the customer back here with the payment `reference`. This
// server component confirms the OUTCOME by calling the backend verifyPayment
// endpoint (GET /transactions/{reference}) and displays the VERIFIED payment
// status — it never trusts a status from the query string alone.
import { verifyPayment } from '../../lib/marzpay';

interface BillingSuccessPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function readReference(value: string | string[] | undefined): string {
  if (typeof value === 'string') {
    return value.trim();
  }
  if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'string') {
    return value[0].trim();
  }
  return '';
}

export default async function BillingSuccessPage(props: BillingSuccessPageProps) {
  const params = await props.searchParams;
  const reference = readReference(params['reference']);

  if (reference === '') {
    return (
      <main style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 640, margin: '40px auto', padding: 16 }}>
        <h1>Payment status unavailable</h1>
        <p role="alert">No payment reference was provided in the success redirect.</p>
      </main>
    );
  }

  let status: string;
  let verified: boolean;
  try {
    const result = await verifyPayment(reference);
    status = result.status;
    verified = status === 'completed' || status === 'successful';
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Verification failed.';
    return (
      <main style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 640, margin: '40px auto', padding: 16 }}>
        <h1>Payment status unavailable</h1>
        <p role="alert">{message}</p>
        <p>Reference: <code>{reference}</code></p>
      </main>
    );
  }

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 640, margin: '40px auto', padding: 16 }}>
      <h1>{verified ? 'Payment complete' : 'Payment ' + status}</h1>
      <p>Verified status: <strong>{status}</strong></p>
      <p>Reference: <code>{reference}</code></p>
    </main>
  );
}

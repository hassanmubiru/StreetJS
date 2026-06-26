// app/billing/cancel/page.tsx — payment cancellation route (Requirement 9.4).
//
// MarzPay redirects the customer here when a payment is cancelled. This route
// displays a clear cancellation indication and a path back to checkout.
import Link from 'next/link';

export default function BillingCancelPage() {
  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 640, margin: '40px auto', padding: 16 }}>
      <h1>Payment cancelled</h1>
      <p role="status">Your payment was cancelled and you have not been charged.</p>
      <p>
        <Link href="/billing">Return to billing</Link>
      </p>
    </main>
  );
}

import { useQuery } from '@streetjs/react';

// Invoices page: lists past invoices from the application's MarzPay invoices
// endpoint using the existing useQuery hook + fetch pattern. An empty collection
// renders an empty-state; a failed request renders an error indicator.
interface Invoice {
  id: string;
  reference: string;
  amount: number;
  currency: string;
  status: string;
}

const API_URL: string = import.meta.env.VITE_API_URL ?? '';

export function InvoicesPage() {
  const invoices = useQuery<Invoice[]>(() =>
    fetch(API_URL + '/api/marzpay/invoices', { credentials: 'include' }).then((r) => r.json() as Promise<Invoice[]>),
  );

  if (invoices.loading) {
    return (
      <section>
        <h2>Invoices</h2>
        <p>Loading…</p>
      </section>
    );
  }

  if (invoices.error !== undefined) {
    return (
      <section>
        <h2>Invoices</h2>
        <p role="alert">Invoices are currently unavailable.</p>
      </section>
    );
  }

  const rows = invoices.data ?? [];
  return (
    <section>
      <h2>Invoices</h2>
      {rows.length === 0 ? (
        <p>No invoices yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Reference</th>
              <th>Amount</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((invoice) => (
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
      )}
    </section>
  );
}

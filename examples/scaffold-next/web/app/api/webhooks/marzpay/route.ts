// app/api/webhooks/marzpay/route.ts — MarzPay webhook example (Requirement 9.3).
//
// SERVER-SIDE ONLY. This route handler runs on the Node.js runtime so the
// MarzPayClient (node:https / node:crypto) and the MarzPay credentials are never
// exposed to the browser.
//
// SECURITY: handle() calls the injected MarzPayClient's `validateWebhook` on the
// UNMODIFIED raw body BEFORE any processing. A NEGATIVE result rejects the
// webhook with a 400 and processes NOTHING.
//
// Verify-don't-invent: MarzPay documents no webhook signature scheme
// (Research_Artifact §L4), so validateWebhook returns false for absent/malformed
// signature material. The documented trust path for a POSITIVE result is
// server-side re-verification: re-fetch the transaction from MarzPay and trust
// the server's status rather than the raw payload (Research_Artifact §R1).
import { NextResponse } from 'next/server';
import { MarzPayClient, validateMarzPayConfig } from '@streetjs/plugin-marzpay';

// Force the Node.js runtime: the MarzPay client depends on node:https/node:crypto.
export const runtime = 'nodejs';

// MarzPay documents no signature header (Research_Artifact §L4). We read a
// conventional header so its value flows into validateWebhook; with the scheme
// unbound, validateWebhook returns false for absent/malformed material, so the
// conservative negative path is taken until MarzPay publishes a signing scheme.
const MARZPAY_SIGNATURE_HEADER = 'x-marzpay-signature';

/** Construct a server-side MarzPayClient from the configured environment. */
function marzPayClient(): MarzPayClient {
  const environment = process.env.MARZPAY_ENVIRONMENT;
  const config = validateMarzPayConfig({
    apiKey: process.env.MARZPAY_API_KEY,
    secretKey: process.env.MARZPAY_SECRET,
    ...(environment !== undefined ? { environment } : {}),
  });
  return new MarzPayClient(config);
}

/** Parse the client `reference` from a webhook payload (empty when absent). */
function referenceOf(rawBody: string): string {
  try {
    const parsed: unknown = JSON.parse(rawBody);
    if (typeof parsed === 'object' && parsed !== null) {
      const record = parsed as Record<string, unknown>;
      const txn = record['transaction'];
      if (typeof txn === 'object' && txn !== null) {
        const ref = (txn as Record<string, unknown>)['reference'];
        if (typeof ref === 'string') {
          return ref.trim();
        }
      }
      const topLevel = record['reference'];
      if (typeof topLevel === 'string') {
        return topLevel.trim();
      }
    }
  } catch {
    return '';
  }
  return '';
}

export async function POST(request: Request): Promise<NextResponse> {
  // 1. Capture the unmodified raw body and the signature header.
  const rawBody = await request.text();
  const signature = request.headers.get(MARZPAY_SIGNATURE_HEADER) ?? undefined;

  const client = marzPayClient();

  // 2. Validate BEFORE any processing (Requirement 9.3).
  if (!client.validateWebhook(rawBody, signature)) {
    // Negative result: reject and process NOTHING.
    return NextResponse.json({ error: 'webhook validation failed' }, { status: 400 });
  }

  // 3. Positive result: re-verify server-side (the documented trust path), then
  //    process the verified transaction (record it, fulfill the order, etc.).
  const reference = referenceOf(rawBody);
  if (reference === '') {
    return NextResponse.json({ error: 'webhook payload missing transaction reference' }, { status: 400 });
  }
  const transaction = await client.getTransaction(reference);
  return NextResponse.json(
    { received: true, reference: transaction.reference, status: transaction.status },
    { status: 200 },
  );
}

// MarzPay client helpers for the Next.js frontend.
//
// MarzPay credentials and the MarzPayClient live ONLY on the StreetJS backend;
// these helpers call that backend over HTTP (the browser holds no MarzPay
// credentials). Each maps to a verified MarzPay operation surfaced by the backend
// (see ../../../src/main.ts): initializePayment (POST /collect-money, card) and
// verifyPayment (GET /transactions/{reference}).
//
// Requirement 9.5: strict TS, no `any`. Requirement 9.4: verifyPayment returns
// the verified payment status. On a non-success response these helpers raise an
// error that INCLUDES the returned HTTP status and never return a result.
import type { PaymentRequest, PaymentInitResult, PaymentStatus } from '@streetjs/plugin-marzpay';

/** The StreetJS backend base URL (empty string => same-origin). */
const API_URL: string = process.env.NEXT_PUBLIC_API_URL ?? '';

/** Active subscription view model returned by the backend. */
export interface SubscriptionView {
  planId: string;
  planName: string;
  status: string;
  renewsAt?: string;
}

/** An invoice row returned by the backend invoice-history endpoint. */
export interface InvoiceView {
  id: string;
  reference: string;
  amount: number;
  currency: string;
  status: string;
  issuedAt?: string;
}

/**
 * Error raised when a MarzPay endpoint returns a non-success HTTP status. The
 * offending status is carried both in `status` and the message so callers can
 * surface it.
 */
export class MarzPayError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'MarzPayError';
    this.status = status;
  }
}

async function readJson<T>(response: Response, path: string): Promise<T> {
  if (!response.ok) {
    // Non-success: raise an error INCLUDING the returned status; return nothing.
    throw new MarzPayError(
      response.status,
      'MarzPay request to ' + path + ' failed with status ' + response.status,
    );
  }
  return (await response.json()) as T;
}

/**
 * Initialize a MarzPay payment via the application's initialization endpoint.
 * Returns the initialization result on success; raises {@link MarzPayError}
 * (including the status) on a non-success response.
 */
export async function initializePayment(request: PaymentRequest): Promise<PaymentInitResult> {
  const path = '/api/marzpay/initialize';
  const response = await fetch(API_URL + path, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(request),
  });
  return readJson<PaymentInitResult>(response, path);
}

/**
 * Verify a MarzPay payment by reference via the application's verification
 * endpoint. Returns the verified payment status on success; raises
 * {@link MarzPayError} (including the status) on a non-success response.
 */
export async function verifyPayment(reference: string): Promise<PaymentStatus> {
  const path = '/api/marzpay/verify/' + encodeURIComponent(reference);
  const response = await fetch(API_URL + path, {
    method: 'GET',
    credentials: 'include',
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  });
  return readJson<PaymentStatus>(response, path);
}

/**
 * Fetch the active subscription for the current account via the backend. Returns
 * `null` when the account has no active subscription (HTTP 404).
 */
export async function fetchSubscription(): Promise<SubscriptionView | null> {
  const path = '/api/marzpay/subscription';
  const response = await fetch(API_URL + path, {
    method: 'GET',
    credentials: 'include',
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  });
  if (response.status === 404) {
    return null;
  }
  return readJson<SubscriptionView | null>(response, path);
}

/** Fetch the invoice history for the current account via the backend. */
export async function fetchInvoices(): Promise<InvoiceView[]> {
  const path = '/api/marzpay/invoices';
  const response = await fetch(API_URL + path, {
    method: 'GET',
    credentials: 'include',
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  });
  return readJson<InvoiceView[]>(response, path);
}

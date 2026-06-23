// MarzPay client library for the React frontend.
//
// Built on the existing @streetjs/client fetch pattern (see src/main.tsx and
// src/App.tsx, which read import.meta.env.VITE_API_URL and call fetch(API_URL +
// path)). `initializePayment`/`verifyPayment` call the application's MarzPay
// endpoints exposed by the backend MarzPay controller.
//
// Requirements 8.2/8.3/8.4: on a non-success response these functions raise an
// error that INCLUDES the returned HTTP status and never return a payment result.
import type { PaymentRequest, PaymentInitResult, PaymentStatus } from '@streetjs/plugin-marzpay';

// Base URL for the Street backend (empty string => same-origin via the Vite proxy).
const API_URL: string = import.meta.env.VITE_API_URL ?? '';

/**
 * Error raised when a MarzPay endpoint returns a non-success HTTP status. The
 * offending status is carried both in `status` and in the message so callers
 * (and the property test) can assert it is surfaced (Requirement 8.4).
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
 * (including the status) on a non-success response (Requirements 8.2, 8.4).
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
 * endpoint. Returns the payment status on success; raises {@link MarzPayError}
 * (including the status) on a non-success response (Requirements 8.3, 8.4).
 */
export async function verifyPayment(reference: string): Promise<PaymentStatus> {
  const path = '/api/marzpay/verify/' + encodeURIComponent(reference);
  const response = await fetch(API_URL + path, {
    method: 'GET',
    credentials: 'include',
    headers: { Accept: 'application/json' },
  });
  return readJson<PaymentStatus>(response, path);
}

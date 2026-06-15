// Mobile Money over Africa's Talking Payments API.
// Payments endpoints take a JSON body + apiKey header on the `payments` host.
import {
  type AfricaTalkingConfig, type AtHttpRequest,
  baseUrl, headers, execute,
} from './types.js';

export interface CheckoutRequest {
  productName: string;
  phoneNumber: string;
  currencyCode: string;
  amount: number;
  /** Optional provider hint (e.g. "Athena" sandbox, "Mpesa"). */
  providerChannel?: string;
  metadata?: Record<string, string>;
}

export interface B2CRecipient {
  phoneNumber: string;
  currencyCode: string;
  amount: number;
  /** "BusinessPayment" | "SalaryPayment" | "PromotionPayment" */
  reason?: string;
  metadata?: Record<string, string>;
}

export interface TransactionStatusQuery {
  transactionId: string;
}

export interface CheckoutResponse {
  status?: string;
  description?: string;
  transactionId?: string;
}

export interface B2CResponse {
  numQueued?: number;
  totalValue?: string;
  entries?: Array<{ phoneNumber: string; status: string; transactionId?: string }>;
  errorMessage?: string;
}

function jsonReq(config: AfricaTalkingConfig, host: 'payments', path: string, payload: object): AtHttpRequest {
  return {
    method: 'POST',
    url: `${baseUrl(host, config.sandbox ?? false)}${path}`,
    headers: headers(config.apiKey, 'application/json'),
    body: JSON.stringify(payload),
  };
}

/** Build a mobile-money checkout (C2B) request. */
export function buildCheckoutRequest(config: AfricaTalkingConfig, req: CheckoutRequest): AtHttpRequest {
  if (!req || typeof req.phoneNumber !== 'string' || req.phoneNumber === '') {
    throw new Error('mobileMoney.checkout: "phoneNumber" is required');
  }
  if (typeof req.amount !== 'number' || req.amount <= 0) {
    throw new Error('mobileMoney.checkout: "amount" must be positive');
  }
  if (typeof req.currencyCode !== 'string' || req.currencyCode.length !== 3) {
    throw new Error('mobileMoney.checkout: "currencyCode" must be a 3-letter code');
  }
  if (typeof req.productName !== 'string' || req.productName === '') {
    throw new Error('mobileMoney.checkout: "productName" is required');
  }
  return jsonReq(config, 'payments', '/mobile/checkout/request', {
    username: config.username,
    productName: req.productName,
    phoneNumber: req.phoneNumber,
    currencyCode: req.currencyCode,
    amount: req.amount,
    ...(req.providerChannel ? { providerChannel: req.providerChannel } : {}),
    ...(req.metadata ? { metadata: req.metadata } : {}),
  });
}

/** Build a B2C payout request. */
export function buildB2CRequest(config: AfricaTalkingConfig, productName: string, recipients: B2CRecipient[]): AtHttpRequest {
  if (typeof productName !== 'string' || productName === '') {
    throw new Error('mobileMoney.b2c: "productName" is required');
  }
  if (!Array.isArray(recipients) || recipients.length === 0) {
    throw new Error('mobileMoney.b2c: "recipients" must be a non-empty array');
  }
  return jsonReq(config, 'payments', '/mobile/b2c/request', {
    username: config.username,
    productName,
    recipients: recipients.map((r) => ({
      phoneNumber: r.phoneNumber,
      currencyCode: r.currencyCode,
      amount: r.amount,
      ...(r.reason ? { reason: r.reason } : {}),
      ...(r.metadata ? { metadata: r.metadata } : {}),
    })),
  });
}

/** Build a transaction-status lookup. */
export function buildTransactionStatusRequest(config: AfricaTalkingConfig, q: TransactionStatusQuery): AtHttpRequest {
  if (!q || typeof q.transactionId !== 'string' || q.transactionId === '') {
    throw new Error('mobileMoney.transactionStatus: "transactionId" is required');
  }
  return jsonReq(config, 'payments', '/query/transaction/find', {
    username: config.username,
    transactionId: q.transactionId,
  });
}

/**
 * Verify a payments callback. AT payment callbacks are unsigned; establish trust
 * via HTTPS + an optional shared secret embedded in your callback URL/path.
 */
export function verifyMobileMoneyCallback(
  body: Record<string, unknown>,
  opts?: { expectedSecret?: string; providedSecret?: string },
): Record<string, unknown> {
  if (!body || typeof body !== 'object') {
    throw new Error('mobile money callback: body must be an object');
  }
  if (opts?.expectedSecret !== undefined && opts.expectedSecret !== opts.providedSecret) {
    throw new Error('mobile money callback: secret mismatch');
  }
  return body;
}

export class MobileMoneyService {
  constructor(private readonly config: AfricaTalkingConfig) {}
  checkout(req: CheckoutRequest): Promise<CheckoutResponse> {
    return execute<CheckoutResponse>(buildCheckoutRequest(this.config, req), this.config);
  }
  b2c(productName: string, recipients: B2CRecipient[]): Promise<B2CResponse> {
    return execute<B2CResponse>(buildB2CRequest(this.config, productName, recipients), this.config);
  }
  transactionStatus(q: TransactionStatusQuery): Promise<unknown> {
    return execute(buildTransactionStatusRequest(this.config, q), this.config);
  }
  verifyCallback(body: Record<string, unknown>, opts?: { expectedSecret?: string; providedSecret?: string }): Record<string, unknown> {
    return verifyMobileMoneyCallback(body, opts);
  }
}

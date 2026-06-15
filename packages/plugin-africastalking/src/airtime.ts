// Airtime over Africa's Talking Airtime API.
// POST {api}/airtime/send  (application/x-www-form-urlencoded; recipients = JSON)
import {
  type AfricaTalkingConfig, type AtHttpRequest,
  baseUrl, headers, form, execute,
} from './types.js';

export interface AirtimeRecipient {
  phoneNumber: string;
  /** Numeric amount (e.g. 100). */
  amount: number;
  /** ISO currency code, e.g. "KES", "UGX", "NGN". */
  currencyCode: string;
}

export type AirtimeRequest =
  | AirtimeRecipient
  | { recipients: AirtimeRecipient[] };

export interface AirtimeResponse {
  numSent?: number;
  totalAmount?: string;
  totalDiscount?: string;
  responses?: Array<{ phoneNumber: string; amount: string; status: string; requestId: string }>;
  errorMessage?: string;
}

function normalize(req: AirtimeRequest): AirtimeRecipient[] {
  const list = 'recipients' in req ? req.recipients : [req];
  if (!Array.isArray(list) || list.length === 0) {
    throw new Error('airtime.send: at least one recipient is required');
  }
  for (const r of list) {
    if (!r || typeof r.phoneNumber !== 'string' || r.phoneNumber === '') {
      throw new Error('airtime.send: each recipient needs a "phoneNumber"');
    }
    if (typeof r.amount !== 'number' || r.amount <= 0) {
      throw new Error('airtime.send: each recipient needs a positive "amount"');
    }
    if (typeof r.currencyCode !== 'string' || r.currencyCode.length !== 3) {
      throw new Error('airtime.send: each recipient needs a 3-letter "currencyCode"');
    }
  }
  return list;
}

/** Build the (pure) airtime send request. */
export function buildAirtimeRequest(config: AfricaTalkingConfig, req: AirtimeRequest): AtHttpRequest {
  const recipients = normalize(req).map((r) => ({
    phoneNumber: r.phoneNumber,
    // AT expects amount as "<CURRENCY> <amount>", e.g. "KES 100".
    amount: `${r.currencyCode} ${r.amount}`,
  }));
  return {
    method: 'POST',
    url: `${baseUrl('api', config.sandbox ?? false)}/airtime/send`,
    headers: headers(config.apiKey, 'application/x-www-form-urlencoded'),
    body: form({ username: config.username, recipients: JSON.stringify(recipients) }),
  };
}

export class AirtimeService {
  constructor(private readonly config: AfricaTalkingConfig) {}
  send(req: AirtimeRequest): Promise<AirtimeResponse> {
    return execute<AirtimeResponse>(buildAirtimeRequest(this.config, req), this.config);
  }
}

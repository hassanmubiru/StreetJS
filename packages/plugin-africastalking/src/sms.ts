// SMS + Bulk SMS over Africa's Talking Messaging API.
// POST {api}/messaging  (application/x-www-form-urlencoded)
import {
  type AfricaTalkingConfig, type AtHttpRequest,
  baseUrl, headers, form, execute,
} from './types.js';

export interface SmsMessage {
  /** Recipient(s). A single string, "+254...", or an array of numbers. */
  to: string | string[];
  /** Message body. */
  message: string;
  /** Optional sender id / short code. */
  from?: string;
  /** Enqueue for high-volume sending. */
  enqueue?: boolean;
}

export interface BulkSmsMessage {
  recipients: string[];
  message: string;
  from?: string;
  /** Bulk mode (1 = send to all, default). */
  bulkMode?: boolean;
}

export interface SmsResponse {
  SMSMessageData?: {
    Message?: string;
    Recipients?: Array<{ number: string; status: string; statusCode: number; messageId: string; cost: string }>;
  };
}

const toList = (to: string | string[]): string => (Array.isArray(to) ? to.join(',') : to);

/** Build the (pure) HTTP request for a single/multi SMS send. */
export function buildSmsRequest(config: AfricaTalkingConfig, msg: SmsMessage): AtHttpRequest {
  if (!msg || typeof msg.message !== 'string' || msg.message === '') {
    throw new Error('sms.send: "message" is required');
  }
  const recipients = toList(msg.to);
  if (!recipients) throw new Error('sms.send: "to" is required');
  return {
    method: 'POST',
    url: `${baseUrl('api', config.sandbox ?? false)}/messaging`,
    headers: headers(config.apiKey, 'application/x-www-form-urlencoded'),
    body: form({
      username: config.username,
      to: recipients,
      message: msg.message,
      from: msg.from,
      enqueue: msg.enqueue ? 1 : undefined,
    }),
  };
}

/** Build a bulk SMS request. */
export function buildBulkSmsRequest(config: AfricaTalkingConfig, msg: BulkSmsMessage): AtHttpRequest {
  if (!Array.isArray(msg?.recipients) || msg.recipients.length === 0) {
    throw new Error('sms.sendBulk: "recipients" must be a non-empty array');
  }
  if (typeof msg.message !== 'string' || msg.message === '') {
    throw new Error('sms.sendBulk: "message" is required');
  }
  return {
    method: 'POST',
    url: `${baseUrl('api', config.sandbox ?? false)}/messaging`,
    headers: headers(config.apiKey, 'application/x-www-form-urlencoded'),
    body: form({
      username: config.username,
      to: msg.recipients.join(','),
      message: msg.message,
      from: msg.from,
      bulkSMSMode: (msg.bulkMode ?? true) ? 1 : 0,
    }),
  };
}

/** SMS service bound to a config; executes the pure requests. */
export class SmsService {
  constructor(private readonly config: AfricaTalkingConfig) {}
  send(msg: SmsMessage): Promise<SmsResponse> {
    return execute<SmsResponse>(buildSmsRequest(this.config, msg), this.config);
  }
  sendBulk(msg: BulkSmsMessage): Promise<SmsResponse> {
    return execute<SmsResponse>(buildBulkSmsRequest(this.config, msg), this.config);
  }
}

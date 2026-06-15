// Voice over Africa's Talking Voice API.
// POST {voice}/call  (application/x-www-form-urlencoded) — outbound calls.
// Inbound call events arrive as POST callbacks to your own endpoint.
import {
  type AfricaTalkingConfig, type AtHttpRequest,
  baseUrl, headers, form, execute,
} from './types.js';

export interface OutboundCall {
  /** Your AT voice number / caller id. */
  from: string;
  /** Recipient(s) — single number or array. */
  to: string | string[];
  /** Optional client-supplied request id echoed in callbacks. */
  clientRequestId?: string;
}

export interface VoiceResponse {
  entries?: Array<{ phoneNumber: string; status: string; sessionId: string }>;
  errorMessage?: string;
}

/** A parsed Africa's Talking voice callback event. */
export interface VoiceCallbackEvent {
  sessionId?: string;
  direction?: 'Inbound' | 'Outbound';
  callerNumber?: string;
  destinationNumber?: string;
  isActive?: string;
  [k: string]: unknown;
}

/** Build the (pure) outbound-call request. */
export function buildCallRequest(config: AfricaTalkingConfig, call: OutboundCall): AtHttpRequest {
  if (!call || typeof call.from !== 'string' || call.from === '') {
    throw new Error('voice.call: "from" is required');
  }
  const to = Array.isArray(call.to) ? call.to.join(',') : call.to;
  if (!to) throw new Error('voice.call: "to" is required');
  return {
    method: 'POST',
    url: `${baseUrl('voice', config.sandbox ?? false)}/call`,
    headers: headers(config.apiKey, 'application/x-www-form-urlencoded'),
    body: form({
      username: config.username,
      from: call.from,
      to,
      clientRequestId: call.clientRequestId,
    }),
  };
}

/**
 * Validate a voice callback. AT does not sign callbacks, so trust is established
 * by (a) serving the callback URL over HTTPS, and (b) an optional shared secret
 * you place in the URL/path. This validates the shape and the optional secret.
 */
export function validateVoiceCallback(
  body: Record<string, unknown>,
  opts?: { expectedSecret?: string; providedSecret?: string },
): VoiceCallbackEvent {
  if (!body || typeof body !== 'object') {
    throw new Error('voice callback: body must be an object');
  }
  if (opts?.expectedSecret !== undefined && opts.expectedSecret !== opts.providedSecret) {
    throw new Error('voice callback: secret mismatch');
  }
  return body as VoiceCallbackEvent;
}

export class VoiceService {
  constructor(private readonly config: AfricaTalkingConfig) {}
  call(call: OutboundCall): Promise<VoiceResponse> {
    return execute<VoiceResponse>(buildCallRequest(this.config, call), this.config);
  }
  /** Validate + parse an inbound voice callback (no network). */
  validateCallback(body: Record<string, unknown>, opts?: { expectedSecret?: string; providedSecret?: string }): VoiceCallbackEvent {
    return validateVoiceCallback(body, opts);
  }
}

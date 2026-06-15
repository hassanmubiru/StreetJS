// @streetjs/plugin-africastalking
// Official Street Framework plugin for Africa's Talking: SMS, Bulk SMS, Voice,
// USSD, Airtime, and Mobile Money — sandbox and production. Zero third-party
// runtime dependencies (Node native fetch); built on the StreetJS PluginModule
// SDK with a signed manifest. The request builders are pure and offline-testable.

import type { PluginManifest } from 'streetjs';
import {
  AfricaTalkingPlugin,
  AFRICASTALKING_PLUGIN_NAME,
  AFRICASTALKING_PLUGIN_VERSION,
} from './plugin.js';

export {
  AfricaTalkingPlugin,
  createAfricaTalkingPlugin,
  AFRICASTALKING_PLUGIN_NAME,
  AFRICASTALKING_PLUGIN_VERSION,
} from './plugin.js';

export {
  validateAfricaTalkingConfig,
  AfricaTalkingError,
  baseUrl,
} from './types.js';
export type { AfricaTalkingConfig, AtHttpRequest, FetchLike, AtHost } from './types.js';

export { SmsService, buildSmsRequest, buildBulkSmsRequest } from './sms.js';
export type { SmsMessage, BulkSmsMessage, SmsResponse } from './sms.js';

export { VoiceService, buildCallRequest, validateVoiceCallback } from './voice.js';
export type { OutboundCall, VoiceResponse, VoiceCallbackEvent } from './voice.js';

export { AirtimeService, buildAirtimeRequest } from './airtime.js';
export type { AirtimeRecipient, AirtimeRequest, AirtimeResponse } from './airtime.js';

export {
  MobileMoneyService,
  buildCheckoutRequest,
  buildB2CRequest,
  buildTransactionStatusRequest,
  verifyMobileMoneyCallback,
} from './mobile-money.js';
export type {
  CheckoutRequest, B2CRecipient, TransactionStatusQuery, CheckoutResponse, B2CResponse,
} from './mobile-money.js';

export {
  UssdRouter,
  createUssdRouter,
  parseUssdRequest,
  con,
  end,
} from './ussd.js';
export type { UssdRequest, UssdResult, UssdHandler } from './ussd.js';

/** The unsigned plugin manifest (sign with `npm run sign` at publish). */
export function africaTalkingPluginManifest(): PluginManifest {
  return {
    name: AFRICASTALKING_PLUGIN_NAME,
    version: AFRICASTALKING_PLUGIN_VERSION,
    capabilities: ['sms', 'voice', 'ussd', 'airtime', 'mobile-money', 'africastalking'],
    permissions: ['net', 'secrets', 'middleware'],
  };
}

/** The unsigned manifest value (matches manifest.json). */
export const manifest: PluginManifest = africaTalkingPluginManifest();

/** The PluginModule subclass the host registers and loads. */
export default AfricaTalkingPlugin;

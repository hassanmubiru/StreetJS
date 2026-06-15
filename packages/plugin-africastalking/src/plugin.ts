// AfricaTalkingPlugin — the PluginModule the host registers. Bundles the SMS,
// Voice, USSD, Airtime, and Mobile Money services over one validated config.
import { PluginModule } from 'streetjs';
import { type AfricaTalkingConfig, validateAfricaTalkingConfig } from './types.js';
import { SmsService } from './sms.js';
import { VoiceService } from './voice.js';
import { AirtimeService } from './airtime.js';
import { MobileMoneyService } from './mobile-money.js';
import { createUssdRouter, type UssdRouter } from './ussd.js';

export const AFRICASTALKING_PLUGIN_NAME = 'street-plugin-africastalking';
export const AFRICASTALKING_PLUGIN_VERSION = '1.0.0';

/**
 * Official Africa's Talking plugin. Construct via {@link createAfricaTalkingPlugin}
 * and use its service accessors (`.sms`, `.voice`, `.airtime`, `.mobileMoney`) and
 * `.createUssdRouter()`. It is a {@link PluginModule}, so a signature-enforcing
 * PluginHost can register/load it like any official plugin.
 */
export class AfricaTalkingPlugin extends PluginModule {
  readonly name = AFRICASTALKING_PLUGIN_NAME;
  readonly version = AFRICASTALKING_PLUGIN_VERSION;

  readonly sms: SmsService;
  readonly voice: VoiceService;
  readonly airtime: AirtimeService;
  readonly mobileMoney: MobileMoneyService;

  private readonly config: AfricaTalkingConfig;

  constructor(config: AfricaTalkingConfig) {
    super();
    this.config = validateAfricaTalkingConfig(config);
    this.sms = new SmsService(this.config);
    this.voice = new VoiceService(this.config);
    this.airtime = new AirtimeService(this.config);
    this.mobileMoney = new MobileMoneyService(this.config);
  }

  /** Whether this instance targets the sandbox environment. */
  get sandbox(): boolean {
    return this.config.sandbox ?? false;
  }

  /** Create a fresh USSD router for handling AT USSD callbacks. */
  createUssdRouter(): UssdRouter {
    return createUssdRouter();
  }
}

/** Construct the Africa's Talking plugin from config (validated). */
export function createAfricaTalkingPlugin(config: AfricaTalkingConfig): AfricaTalkingPlugin {
  return new AfricaTalkingPlugin(config);
}

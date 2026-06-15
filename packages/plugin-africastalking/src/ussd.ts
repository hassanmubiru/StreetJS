// USSD for Africa's Talking. USSD is callback-driven: AT POSTs
// { sessionId, serviceCode, phoneNumber, text } to your endpoint and you reply
// with a plain-text body starting with "CON " (expect more input) or "END "
// (terminate the session). This router is pure and fully offline-testable.

/** Parsed USSD callback request from Africa's Talking. */
export interface UssdRequest {
  sessionId: string;
  serviceCode: string;
  phoneNumber: string;
  /** Accumulated input, segments joined by "*" (empty on first hit). */
  text: string;
}

export type UssdResult = string | { type: 'CON' | 'END'; message: string };

export type UssdHandler = (req: UssdRequest, segments: string[]) => UssdResult;

/** Build a "continue" response (the session stays open for more input). */
export function con(message: string): { type: 'CON'; message: string } {
  return { type: 'CON', message };
}

/** Build an "end" response (the session terminates). */
export function end(message: string): { type: 'END'; message: string } {
  return { type: 'END', message };
}

function render(result: UssdResult): string {
  if (typeof result === 'string') {
    // Bare strings default to CON unless they already carry a prefix.
    if (result.startsWith('CON ') || result.startsWith('END ')) return result;
    return `CON ${result}`;
  }
  return `${result.type} ${result.message}`;
}

/** Parse a raw callback body into a typed UssdRequest. */
export function parseUssdRequest(body: Record<string, unknown>): UssdRequest {
  return {
    sessionId: String(body['sessionId'] ?? ''),
    serviceCode: String(body['serviceCode'] ?? ''),
    phoneNumber: String(body['phoneNumber'] ?? ''),
    text: String(body['text'] ?? ''),
  };
}

/** Fluent USSD router. */
export class UssdRouter {
  private rootMenu: UssdHandler | null = null;
  private readonly routes = new Map<string, UssdHandler>();
  private fallback: UssdHandler | null = null;

  /** The menu shown when there is no input yet (text === ""). */
  menu(message: string | UssdHandler): this {
    this.rootMenu = typeof message === 'function' ? message : (): UssdResult => con(message);
    return this;
  }

  /** Route a top-level choice (segments[0] === value). */
  input(value: string, handler: UssdHandler): this {
    this.routes.set(value, handler);
    return this;
  }

  /** Handler for any input not matched by `input()`. */
  end(handler: string | UssdHandler): this {
    this.fallback = typeof handler === 'function' ? handler : (): UssdResult => end(handler);
    return this;
  }

  /** Resolve a request into the AT response body string ("CON ..."/"END ..."). */
  handle(input: UssdRequest | Record<string, unknown>): string {
    const req = 'text' in input && 'sessionId' in input
      ? (input as UssdRequest)
      : parseUssdRequest(input as Record<string, unknown>);
    const segments = req.text === '' ? [] : req.text.split('*');

    if (segments.length === 0) {
      if (this.rootMenu) return render(this.rootMenu(req, segments));
      return render(end('END Service unavailable.'));
    }
    const route = this.routes.get(segments[0]!);
    if (route) return render(route(req, segments));
    if (this.fallback) return render(this.fallback(req, segments));
    return render(end('Invalid choice.'));
  }
}

/** Create a new USSD router. */
export function createUssdRouter(): UssdRouter {
  return new UssdRouter();
}

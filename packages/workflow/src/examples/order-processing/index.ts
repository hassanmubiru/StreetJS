/**
 * @streetjs/workflow — order-processing example application (Requirement 29).
 *
 * A fully runnable, self-contained demonstration of the workflow engine
 * coordinating all four pillars end to end. It implements the order-processing
 * workflow described in the design Overview:
 *
 *   Receive Order → Validate Inventory → Charge Card → Generate Invoice →
 *   Store Invoice → Publish Event → Notify Realtime → Queue Email → Complete
 *
 * Everything runs **in-process with no external services** (Requirement 29.3):
 * durability is backed by the zero-dependency {@link MemoryWorkflowStore}, and
 * the storage/queue/events/realtime pillars are satisfied by structural
 * in-process doubles that record what the workflow did so a readable summary can
 * be printed (and so the example smoke test in task 21.2 can drive and assert
 * the full sequence).
 *
 * This module is NOT part of the package's public surface — it lives under
 * `src/examples/` and is never re-exported from `src/index.ts`. It is compiled
 * to `dist/examples/order-processing/index.js` and executed by `npm run example`.
 *
 * _Requirements: 29.1, 29.2, 29.3_
 */

import process from "node:process";
import { fileURLToPath } from "node:url";

import { createWorkflow } from "../../engine.js";
import { MemoryWorkflowStore } from "../../store.js";
import type {
  EventsLike,
  QueueLike,
  RealtimeLike,
  StorageLike,
  WorkflowFunction,
} from "../../types.js";

// ── Domain types ────────────────────────────────────────────────────────────────

/** A single line item in the incoming cart. */
export interface OrderLineItem {
  readonly sku: string;
  readonly quantity: number;
  readonly unitPriceCents: number;
}

/** The typed workflow input: a customer's cart. */
export interface OrderInput {
  readonly customerId: string;
  readonly email: string;
  readonly items: readonly OrderLineItem[];
}

/** The received, priced order (output of "Receive Order"). */
export interface Order {
  readonly id: string;
  readonly customerId: string;
  readonly email: string;
  readonly items: readonly OrderLineItem[];
  readonly totalCents: number;
}

/** The inventory reservation (output of "Validate Inventory"). */
export interface Reservation {
  readonly reservationId: string;
  readonly reserved: boolean;
}

/** The card charge (output of "Charge Card"). */
export interface Charge {
  readonly chargeId: string;
  readonly amountCents: number;
}

/** The generated invoice (output of "Generate Invoice"). */
export interface Invoice {
  readonly id: string;
  readonly pdf: string;
}

/** The typed workflow output returned by "Complete". */
export interface OrderResult {
  readonly orderId: string;
  readonly invoiceId: string;
  readonly chargeId: string;
  readonly reservationId: string;
  readonly emailJobId: string;
}

// ── In-process pillar doubles (no external services) ─────────────────────────────

/** A recording, Map-backed {@link StorageLike} double (Pillar 4). */
export class InMemoryStorageDouble implements StorageLike {
  readonly objects = new Map<string, { readonly bytes: Uint8Array; readonly options?: Record<string, unknown> }>();

  async put(key: string, content: Uint8Array | string, options?: Record<string, unknown>): Promise<unknown> {
    const bytes = typeof content === "string" ? new TextEncoder().encode(content) : content;
    this.objects.set(key, { bytes, options });
    return { key, size: bytes.byteLength };
  }

  async get(key: string): Promise<{ found: boolean; bytes?: Uint8Array; metadata?: unknown }> {
    const entry = this.objects.get(key);
    return entry === undefined
      ? { found: false }
      : { found: true, bytes: entry.bytes, metadata: entry.options };
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }

  async move(from: string, to: string): Promise<void> {
    const entry = this.objects.get(from);
    if (entry !== undefined) {
      this.objects.set(to, entry);
      this.objects.delete(from);
    }
  }

  async copy(from: string, to: string): Promise<void> {
    const entry = this.objects.get(from);
    if (entry !== undefined) {
      this.objects.set(to, entry);
    }
  }
}

/** A recording {@link QueueLike} double (Pillar 2). */
export class InMemoryQueueDouble implements QueueLike {
  readonly dispatched: Array<{ readonly jobId: string; readonly job: string; readonly payload: unknown }> = [];
  private counter = 0;

  async dispatch(job: string, payload: unknown): Promise<string> {
    const jobId = `job_${(++this.counter).toString().padStart(4, "0")}`;
    this.dispatched.push({ jobId, job, payload });
    return jobId;
  }
}

/** A recording {@link EventsLike} double (Pillar 3). */
export class InMemoryEventsDouble implements EventsLike {
  readonly published: Array<{ readonly event: string; readonly payload: unknown }> = [];
  private readonly handlers = new Map<string, Set<(payload: unknown) => void>>();

  publish(event: string, payload: unknown): void {
    this.published.push({ event, payload });
    for (const handler of this.handlers.get(event) ?? []) {
      handler(payload);
    }
  }

  async waitFor(event: string): Promise<unknown> {
    const match = this.published.find((entry) => entry.event === event);
    return match?.payload;
  }

  subscribe(event: string, handler: (payload: unknown) => void): () => void {
    const set = this.handlers.get(event) ?? new Set();
    set.add(handler);
    this.handlers.set(event, set);
    return () => {
      set.delete(handler);
    };
  }
}

/** A recording {@link RealtimeLike} double (Pillar 1). */
export class InMemoryRealtimeDouble implements RealtimeLike {
  readonly broadcasts: Array<{ readonly channel: string; readonly event: string; readonly payload: unknown }> = [];

  broadcast(channel: string, event: string, payload: unknown): void {
    this.broadcasts.push({ channel, event, payload });
  }
}

/** The bundle of in-process pillar doubles wired into the engine. */
export interface OrderProcessingBridges {
  readonly storage: InMemoryStorageDouble;
  readonly queue: InMemoryQueueDouble;
  readonly events: InMemoryEventsDouble;
  readonly realtime: InMemoryRealtimeDouble;
}

/** Construct a fresh set of in-process bridge doubles. */
export function createOrderProcessingBridges(): OrderProcessingBridges {
  return {
    storage: new InMemoryStorageDouble(),
    queue: new InMemoryQueueDouble(),
    events: new InMemoryEventsDouble(),
    realtime: new InMemoryRealtimeDouble(),
  };
}

// ── The workflow definition name and function ────────────────────────────────────

/** The registered name of the order-processing workflow. */
export const ORDER_PROCESSING_WORKFLOW = "order-processing" as const;

let sequence = 0;
/** Deterministic-ish id helper for the example's fake activities. */
function nextId(prefix: string): string {
  return `${prefix}_${(++sequence).toString().padStart(4, "0")}`;
}

/**
 * The order-processing {@link WorkflowFunction}. Exported so the example smoke
 * test (task 21.2) can register and drive it directly.
 *
 * Demonstrates the full pillar sequence (Requirement 29.2): activities for
 * Receive/Validate/Charge/Invoice, `ctx.storage.put` (Store), `ctx.events.publish`
 * (Publish), `ctx.realtime.broadcast` (Notify), `ctx.queue.dispatch` (Queue), and
 * a typed return value (Complete).
 */
export const orderProcessingWorkflow: WorkflowFunction<OrderInput, OrderResult> = async (ctx, input) => {
  // 1. Receive Order — price the cart into a durable order.
  const order = await ctx.activity(
    () => {
      const totalCents = input.items.reduce((sum, item) => sum + item.quantity * item.unitPriceCents, 0);
      const received: Order = {
        id: nextId("order"),
        customerId: input.customerId,
        email: input.email,
        items: input.items,
        totalCents,
      };
      return received;
    },
    { metadata: { step: "receive" } },
  );

  // 2. Validate Inventory — reserve stock (retryable, timeout-guarded).
  const reservation = await ctx.activity<Reservation>(
    () => ({ reservationId: nextId("resv"), reserved: true }),
    {
      metadata: { step: "validate-inventory" },
      timeout: 5_000,
      retry: { maxAttempts: 3, backoff: { strategy: "exponential", baseMs: 200, multiplier: 2, maxDelayMs: 5_000 } },
    },
  );

  // 3. Charge Card — take payment, with a compensating refund on later failure.
  const charge = await ctx.activity<Charge>(
    () => ({ chargeId: nextId("charge"), amountCents: order.totalCents }),
    {
      metadata: { step: "charge-card" },
      retry: { maxAttempts: 3, backoff: { strategy: "jitter", maxDelayMs: 4_000 } },
      compensate: (settled) => {
        // In a real workflow this would refund `settled.chargeId`.
        void settled;
      },
    },
  );

  // 4. Generate Invoice — produce the invoice document.
  const invoice = await ctx.activity<Invoice>(
    () => {
      const id = nextId("inv");
      const pdf = `%PDF-1.4 invoice ${id} order ${order.id} total ${order.totalCents}c`;
      return { id, pdf };
    },
    { metadata: { step: "generate-invoice" } },
  );

  // 5. Store Invoice — persist the document through the storage bridge.
  await ctx.storage.put(`invoices/${invoice.id}.pdf`, invoice.pdf, { contentType: "application/pdf" });

  // 6. Publish Event — announce the invoice through the events bridge.
  await ctx.events.publish("invoice.generated", { invoiceId: invoice.id, orderId: order.id });

  // 7. Notify Realtime — push live progress to connected clients.
  await ctx.realtime.broadcast("orders", { runId: ctx.metadata.runId, orderId: order.id, status: "invoice-ready" });

  // 8. Queue Email — dispatch the confirmation email as a background job.
  const emailJobId = await ctx.queue.dispatch("send-email", { to: order.email, invoiceId: invoice.id });

  // 9. Complete — return the typed result.
  return {
    orderId: order.id,
    invoiceId: invoice.id,
    chargeId: charge.chargeId,
    reservationId: reservation.reservationId,
    emailJobId,
  };
};

// ── Running the example ──────────────────────────────────────────────────────────

/** The observable outcome of one example run, for printing and for assertions. */
export interface OrderProcessingRunResult {
  readonly result: OrderResult;
  readonly status: string | null;
  readonly bridges: OrderProcessingBridges;
}

/**
 * Build an engine over the {@link MemoryWorkflowStore} with in-process bridge
 * doubles, register and run the order-processing workflow, and return the typed
 * result together with the recording bridges (Requirement 29.3).
 */
export async function runOrderProcessingExample(sampleInput?: OrderInput): Promise<OrderProcessingRunResult> {
  const input: OrderInput = sampleInput ?? {
    customerId: "cust_42",
    email: "buyer@example.com",
    items: [
      { sku: "SKU-COFFEE", quantity: 2, unitPriceCents: 1_299 },
      { sku: "SKU-MUG", quantity: 1, unitPriceCents: 899 },
    ],
  };

  const bridges = createOrderProcessingBridges();
  const engine = createWorkflow({
    store: new MemoryWorkflowStore(),
    bridges,
  });

  engine.define<OrderInput, OrderResult>(ORDER_PROCESSING_WORKFLOW, orderProcessingWorkflow);

  const handle = await engine.run<OrderInput, OrderResult>(ORDER_PROCESSING_WORKFLOW, input);
  const result = await handle.result();
  const status = await engine.status(handle.runId);
  await engine.close();

  return { result, status, bridges };
}

/** Print a readable, ordered summary of what the workflow did. */
function printSummary(run: OrderProcessingRunResult): void {
  const { result, status, bridges } = run;
  const lines: string[] = [
    "── order-processing workflow ────────────────────────────────",
    `1. Receive Order       → order ${result.orderId}`,
    `2. Validate Inventory  → reservation ${result.reservationId}`,
    `3. Charge Card         → charge ${result.chargeId}`,
    `4. Generate Invoice    → invoice ${result.invoiceId}`,
    `5. Store Invoice       → storage keys: ${[...bridges.storage.objects.keys()].join(", ")}`,
    `6. Publish Event       → events: ${bridges.events.published.map((e) => e.event).join(", ")}`,
    `7. Notify Realtime     → broadcasts: ${bridges.realtime.broadcasts
      .map((b) => `${b.channel}/${b.event}`)
      .join(", ")}`,
    `8. Queue Email         → job ${result.emailJobId} (${bridges.queue.dispatched.length} dispatched)`,
    `9. Complete            → run status: ${status}`,
    "─────────────────────────────────────────────────────────────",
  ];
  console.log(lines.join("\n"));
}

/** Entry point invoked when the file is run directly via `npm run example`. */
export async function main(): Promise<void> {
  const run = await runOrderProcessingExample();
  printSummary(run);
}

// Run `main()` only when this module is the process entry point, so importing it
// from the smoke test does not trigger execution.
if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}

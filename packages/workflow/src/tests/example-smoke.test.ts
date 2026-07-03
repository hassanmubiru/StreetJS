// Example smoke test for the order-processing example application (Req 27.1,
// 29.3, 31.3). This drives the runnable example END TO END on the default
// zero-dependency MemoryWorkflowStore with in-process bridge doubles and asserts
// that the full nine-step sequence
//
//   Receive Order → Validate Inventory → Charge Card → Generate Invoice →
//   Store Invoice → Publish Event → Notify Realtime → Queue Email → Complete
//
// runs to completion with NO external services. It gives us the "example smoke"
// tier of Req 27.1 and evidences Req 29.3 / 31.3 (the example runs to completion
// on the Memory_Workflow_Store and in-process bridge doubles without external
// services).
//
// Uses the Node.js built-in test runner (node:test) and node:assert/strict, and
// is executed via `node --test dist/tests/*.test.js`.
//
// Requirements: 27.1, 29.3, 31.3

import test, { describe } from "node:test";
import assert from "node:assert/strict";

import {
  ORDER_PROCESSING_WORKFLOW,
  createOrderProcessingBridges,
  orderProcessingWorkflow,
  runOrderProcessingExample,
  type OrderInput,
} from "../examples/order-processing/index.js";

describe("order-processing example smoke test (Req 27.1, 29.3, 31.3)", () => {
  test("runs the full 9-step sequence to completion with no external services", async () => {
    // A fixed, self-contained input so the assertions below are deterministic;
    // everything is in-process — no network, no filesystem, no Redis.
    const input: OrderInput = {
      customerId: "cust_smoke",
      email: "smoke@example.com",
      items: [
        { sku: "SKU-A", quantity: 3, unitPriceCents: 1_000 },
        { sku: "SKU-B", quantity: 2, unitPriceCents: 250 },
      ],
    };

    const { result, status, bridges } = await runOrderProcessingExample(input);

    // ── Complete (step 9): the run reached the terminal `completed` status ──────
    assert.equal(status, "completed", "the order-processing run finished as completed");

    // ── The typed result carries every id produced across the sequence ─────────
    assert.ok(result.orderId, "Receive Order produced an orderId");
    assert.ok(result.reservationId, "Validate Inventory produced a reservationId");
    assert.ok(result.chargeId, "Charge Card produced a chargeId");
    assert.ok(result.invoiceId, "Generate Invoice produced an invoiceId");
    assert.ok(result.emailJobId, "Queue Email produced an emailJobId");

    // ── Store Invoice (step 5): the storage double recorded the invoice put ────
    const invoiceKey = `invoices/${result.invoiceId}.pdf`;
    assert.ok(
      bridges.storage.objects.has(invoiceKey),
      `the storage double recorded the invoice put at ${invoiceKey}`,
    );

    // ── Publish Event (step 6): the events double published invoice.generated ──
    const published = bridges.events.published.find((entry) => entry.event === "invoice.generated");
    assert.ok(published, "the events double published invoice.generated");
    assert.deepEqual(published!.payload, { invoiceId: result.invoiceId, orderId: result.orderId });

    // ── Notify Realtime (step 7): the realtime double broadcast on `orders` ────
    const broadcast = bridges.realtime.broadcasts.find((entry) => entry.channel === "orders");
    assert.ok(broadcast, "the realtime double broadcast on the orders channel");
    assert.deepEqual(broadcast!.payload, {
      runId: (broadcast!.payload as { runId: unknown }).runId,
      orderId: result.orderId,
      status: "invoice-ready",
    });

    // ── Queue Email (step 8): the queue double dispatched send-email → jobId ────
    const dispatched = bridges.queue.dispatched.find((entry) => entry.job === "send-email");
    assert.ok(dispatched, "the queue double dispatched a send-email job");
    assert.equal(
      dispatched!.jobId,
      result.emailJobId,
      "the dispatched jobId flowed back to the workflow result as emailJobId",
    );
    assert.deepEqual(dispatched!.payload, { to: input.email, invoiceId: result.invoiceId });
  });

  test("exposes the workflow function and name so it can be driven directly", async () => {
    // The example is authored as a reusable WorkflowFunction registered under a
    // stable name — the smoke test confirms both are exported for direct wiring.
    assert.equal(ORDER_PROCESSING_WORKFLOW, "order-processing");
    assert.equal(typeof orderProcessingWorkflow, "function");

    // Fresh, independent bridge doubles each carry no recorded state initially,
    // confirming createOrderProcessingBridges wires clean in-process doubles.
    const bridges = createOrderProcessingBridges();
    assert.equal(bridges.storage.objects.size, 0, "a fresh storage double is empty");
    assert.equal(bridges.queue.dispatched.length, 0, "a fresh queue double has dispatched nothing");
    assert.equal(bridges.events.published.length, 0, "a fresh events double has published nothing");
    assert.equal(bridges.realtime.broadcasts.length, 0, "a fresh realtime double has broadcast nothing");
  });
});

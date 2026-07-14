/**
 * Runnable example: `node dist/examples/integration.js`
 *
 * Shows a server receiving a request with an incoming `traceparent`, creating a
 * child span, doing nested work, propagating context to an outbound call, and
 * exporting finished spans. Self-contained (no other package required).
 */

import {
  createTracer,
  SimpleSpanProcessor,
  InMemorySpanExporter,
  extractContext,
  injectContext,
  type PropagationCarrier,
} from '../index.js';

async function main(): Promise<void> {
  const exporter = new InMemorySpanExporter();
  const tracer = createTracer({ processor: new SimpleSpanProcessor(exporter) });

  // An inbound request carrying W3C trace context.
  const incoming: PropagationCarrier = {
    traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
  };
  const parent = extractContext(incoming);

  await tracer.startActiveSpan(
    'GET /users',
    async (server) => {
      server.setAttributes({ 'http.method': 'GET', 'http.route': '/users' });

      // Nested work reuses the active span as its parent automatically.
      await tracer.startActiveSpan('db.query', async (db) => {
        db.setAttribute('db.statement', 'SELECT * FROM users');
      });

      // Propagate context to a downstream service.
      const outbound: PropagationCarrier = {};
      injectContext(server.spanContext(), outbound);
      process.stdout.write(`outbound traceparent: ${outbound.traceparent}\n`);

      server.setStatus({ code: 'ok' });
    },
    { kind: 'server', parent },
  );

  for (const span of exporter.getFinishedSpans()) {
    process.stdout.write(
      `span ${span.name} trace=${span.context.traceId} parent=${span.parentSpanId ?? '(root)'} status=${span.status.code}\n`,
    );
  }
}

void main();

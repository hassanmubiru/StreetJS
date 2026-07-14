/**
 * Built-in span exporters and processors.
 *
 * Depends on `types` only.
 */

import type { SpanData, SpanExporter, SpanProcessor } from './types.js';

/** Captures finished spans in memory. Ideal for tests. */
export class InMemorySpanExporter implements SpanExporter {
  private readonly spans: SpanData[] = [];

  export(spans: readonly SpanData[]): void {
    this.spans.push(...spans);
  }

  /** All finished spans, in end order. */
  getFinishedSpans(): readonly SpanData[] {
    return this.spans;
  }

  /** Discard captured spans. */
  reset(): void {
    this.spans.length = 0;
  }
}

/** Writes finished spans as JSON lines (default to stdout; injectable for tests). */
export class ConsoleSpanExporter implements SpanExporter {
  private readonly write: (chunk: string) => void;

  constructor(write: (chunk: string) => void = (c) => void process.stdout.write(c)) {
    this.write = write;
  }

  export(spans: readonly SpanData[]): void {
    for (const span of spans) {
      this.write(JSON.stringify(span) + '\n');
    }
  }
}

/**
 * Forwards each span to an exporter as soon as it ends. Simple and synchronous;
 * suitable for low-to-moderate span volume.
 */
export class SimpleSpanProcessor implements SpanProcessor {
  constructor(private readonly exporter: SpanExporter) {}

  onEnd(span: SpanData): void {
    void this.exporter.export([span]);
  }

  async forceFlush(): Promise<void> {
    /* SimpleSpanProcessor exports synchronously; nothing is buffered. */
  }

  async shutdown(): Promise<void> {
    await this.exporter.shutdown?.();
  }
}

/** A processor that discards spans. The default when none is configured. */
export const noopSpanProcessor: SpanProcessor = {
  onEnd(): void {
    /* discard */
  },
};

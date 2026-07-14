/**
 * The Span implementation.
 *
 * Depends on `types` only.
 */

import type {
  Attributes,
  AttributeValue,
  Span,
  SpanContext,
  SpanData,
  SpanKind,
  SpanStatus,
  TimedEvent,
} from './types.js';

export interface SpanImplParams {
  readonly name: string;
  readonly context: SpanContext;
  readonly parentSpanId?: string;
  readonly kind: SpanKind;
  readonly startTime: number;
  readonly attributes?: Attributes;
  /** When false, the span is a no-op that is never exported. */
  readonly recording: boolean;
  readonly clock: () => number;
  readonly onEnd: (data: SpanData) => void;
}

export class SpanImpl implements Span {
  private name: string;
  private readonly context: SpanContext;
  private readonly parentSpanId?: string;
  private readonly kind: SpanKind;
  private readonly startTime: number;
  private endTime?: number;
  private readonly attributes: Attributes;
  private readonly events: TimedEvent[] = [];
  private status: SpanStatus = { code: 'unset' };
  private ended = false;
  private readonly recording: boolean;
  private readonly clock: () => number;
  private readonly onEnd: (data: SpanData) => void;

  constructor(params: SpanImplParams) {
    this.name = params.name;
    this.context = params.context;
    this.parentSpanId = params.parentSpanId;
    this.kind = params.kind;
    this.startTime = params.startTime;
    this.attributes = { ...(params.attributes ?? {}) };
    this.recording = params.recording;
    this.clock = params.clock;
    this.onEnd = params.onEnd;
  }

  spanContext(): SpanContext {
    return this.context;
  }

  isRecording(): boolean {
    return this.recording && !this.ended;
  }

  setAttribute(key: string, value: AttributeValue): this {
    if (this.isRecording()) {
      this.attributes[key] = value;
    }
    return this;
  }

  setAttributes(attributes: Attributes): this {
    if (this.isRecording()) {
      Object.assign(this.attributes, attributes);
    }
    return this;
  }

  addEvent(name: string, attributes?: Attributes): this {
    if (this.isRecording()) {
      const event: TimedEvent = attributes
        ? { name, time: this.clock(), attributes }
        : { name, time: this.clock() };
      this.events.push(event);
    }
    return this;
  }

  setStatus(status: SpanStatus): this {
    if (this.isRecording()) {
      this.status = status;
    }
    return this;
  }

  recordException(error: unknown): this {
    if (this.isRecording()) {
      const isError = error instanceof Error;
      const attributes: Attributes = {
        'exception.type': isError ? error.name : 'Error',
        'exception.message': isError ? error.message : String(error),
      };
      if (isError && typeof error.stack === 'string') {
        attributes['exception.stacktrace'] = error.stack;
      }
      this.addEvent('exception', attributes);
    }
    return this;
  }

  updateName(name: string): this {
    if (this.isRecording()) {
      this.name = name;
    }
    return this;
  }

  end(endTime?: number): void {
    if (this.ended) {
      return;
    }
    this.ended = true;
    if (!this.recording) {
      return;
    }
    this.endTime = endTime ?? this.clock();
    this.onEnd(this.toData());
  }

  private toData(): SpanData {
    const endTime = this.endTime ?? this.startTime;
    return {
      name: this.name,
      context: this.context,
      parentSpanId: this.parentSpanId,
      kind: this.kind,
      startTime: this.startTime,
      endTime,
      durationMs: endTime - this.startTime,
      attributes: { ...this.attributes },
      events: [...this.events],
      status: this.status,
    };
  }
}

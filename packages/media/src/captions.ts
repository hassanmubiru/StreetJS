// src/captions.ts
// Pure WebVTT caption builders. No I/O — fully unit-testable.
//
// These turn timed transcript cues (e.g. the segments returned by
// `@streetjs/ai`'s `transcribe`) into a valid WebVTT (.vtt) caption file for an
// HTML5 <track>. `TranscriptCue` is intentionally structural — any source whose
// segments expose { start, end, text } maps directly onto it, so this module
// stays dependency-free and reusable across products.

import { MediaValidationError } from './errors.js';
import type { TranscriptCue, WebVttOptions } from './types.js';

/**
 * Format a time in seconds as a WebVTT timestamp `HH:MM:SS.mmm`.
 * Throws on negative or non-finite input.
 */
export function formatVttTimestamp(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    throw new MediaValidationError(`WebVTT timestamp must be finite and >= 0, got ${seconds}`);
  }
  const totalMs = Math.round(seconds * 1000);
  const ms = totalMs % 1000;
  const totalSec = (totalMs - ms) / 1000;
  const s = totalSec % 60;
  const totalMin = (totalSec - s) / 60;
  const m = totalMin % 60;
  const h = (totalMin - m) / 60;
  const pad = (n: number, width: number): string => String(n).padStart(width, '0');
  return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)}.${pad(ms, 3)}`;
}

/**
 * Build a WebVTT document from ordered transcript cues. Each cue becomes a
 * `start --> end` block with its (CR/LF-normalized) text. An optional
 * `NOTE`-style header comment can be supplied.
 *
 * Validation: every cue must have `0 <= start <= end`; cues must be in
 * non-decreasing start order (the natural order transcription emits). An empty
 * cue list yields a valid, header-only WebVTT file.
 */
export function buildWebVtt(cues: TranscriptCue[], opts: WebVttOptions = {}): string {
  if (!Array.isArray(cues)) {
    throw new MediaValidationError('buildWebVtt: cues must be an array');
  }

  const lines: string[] = ['WEBVTT'];
  if (opts.header !== undefined) {
    // A WebVTT header comment: "NOTE <text>" (newlines flattened to spaces).
    lines.push(`NOTE ${String(opts.header).replace(/[\r\n]+/g, ' ')}`);
  }

  let previousStart = 0;
  for (let i = 0; i < cues.length; i += 1) {
    const cue = cues[i]!;
    if (!Number.isFinite(cue.start) || !Number.isFinite(cue.end)) {
      throw new MediaValidationError(`Cue ${i}: start/end must be finite numbers`);
    }
    if (cue.start < 0) {
      throw new MediaValidationError(`Cue ${i}: start must be >= 0, got ${cue.start}`);
    }
    if (cue.end < cue.start) {
      throw new MediaValidationError(`Cue ${i}: end (${cue.end}) must be >= start (${cue.start})`);
    }
    if (cue.start < previousStart) {
      throw new MediaValidationError(
        `Cue ${i}: starts at ${cue.start}, before the previous cue at ${previousStart} (cues must be ordered)`,
      );
    }
    previousStart = cue.start;

    const text = String(cue.text ?? '').replace(/\r\n?/g, '\n').trimEnd();
    lines.push('');
    if (cue.id !== undefined && cue.id !== '') {
      lines.push(String(cue.id).replace(/[\r\n]+/g, ' '));
    }
    lines.push(`${formatVttTimestamp(cue.start)} --> ${formatVttTimestamp(cue.end)}`);
    lines.push(text);
  }

  // WebVTT files end with a trailing blank line.
  return `${lines.join('\n')}\n`;
}

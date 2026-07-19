// src/waveform.ts
// Waveform peak extraction: a pure PCM→peaks reducer plus the ffmpeg arg
// builder that decodes an input to raw PCM. The reducer has no I/O and is fully
// unit-testable; the arg builder is a pure string[] producer like the others.
//
// Typical use: run ffmpeg with `buildWaveformArgs(input)` to decode mono s16le
// PCM to stdout (pipe:1), then feed the raw bytes to `computeWaveformPeaks` to
// get a compact, normalized peak array for a scrubber/preview UI.

import { MediaValidationError } from './errors.js';
import type { WaveformOptions, WaveformPeaks } from './types.js';

/** Default PCM sample rate used for waveform decoding (Hz). */
const DEFAULT_SAMPLE_RATE = 8000;
/** Max amplitude of a signed 16-bit sample. */
const S16_MAX = 32768;

/**
 * Build ffmpeg args that decode `input` to single-channel signed 16-bit
 * little-endian PCM on stdout (`pipe:1`). Video is dropped (`-vn`). The caller
 * captures the raw bytes and passes them to {@link computeWaveformPeaks}.
 */
export function buildWaveformArgs(input: string, opts: WaveformOptions = {}): string[] {
  if (!input) throw new MediaValidationError('waveform: input path is required');
  const sampleRate = opts.sampleRate ?? DEFAULT_SAMPLE_RATE;
  if (!Number.isInteger(sampleRate) || sampleRate <= 0) {
    throw new MediaValidationError(`waveform sampleRate must be a positive integer, got ${sampleRate}`);
  }
  return [
    '-hide_banner',
    '-v', 'error',
    '-i', input,
    '-vn',
    '-ac', '1',
    '-ar', String(sampleRate),
    '-f', 's16le',
    'pipe:1',
  ];
}

/**
 * Reduce raw mono signed-16-bit-LE PCM into `buckets` normalized peaks in
 * `[0, 1]`, where each peak is the maximum absolute amplitude within that
 * bucket divided by the 16-bit range. Suitable for rendering a static waveform
 * / scrubber preview.
 *
 * Trailing odd bytes (an incomplete final sample) are ignored. When there are
 * fewer whole samples than requested buckets, the result is truncated to the
 * sample count (never emits empty/NaN buckets).
 */
export function computeWaveformPeaks(
  pcm: Uint8Array,
  opts: WaveformOptions & { buckets: number },
): WaveformPeaks {
  const buckets = opts.buckets;
  if (!Number.isInteger(buckets) || buckets <= 0) {
    throw new MediaValidationError(`waveform buckets must be a positive integer, got ${buckets}`);
  }

  const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  const sampleCount = Math.floor(pcm.byteLength / 2);

  if (sampleCount === 0) {
    return { version: 1, channels: 1, bucketCount: 0, peaks: [] };
  }

  const effectiveBuckets = Math.min(buckets, sampleCount);
  const peaks = new Array<number>(effectiveBuckets).fill(0);
  const samplesPerBucket = sampleCount / effectiveBuckets;

  for (let i = 0; i < sampleCount; i += 1) {
    const sample = view.getInt16(i * 2, true); // little-endian
    const amplitude = Math.abs(sample) / S16_MAX; // 0..1
    let bucket = Math.floor(i / samplesPerBucket);
    if (bucket >= effectiveBuckets) bucket = effectiveBuckets - 1; // clamp final
    if (amplitude > peaks[bucket]!) peaks[bucket] = amplitude;
  }

  const result: WaveformPeaks = {
    version: 1,
    channels: 1,
    bucketCount: effectiveBuckets,
    peaks,
  };
  if (opts.sampleRate !== undefined) result.sampleRate = opts.sampleRate;
  return result;
}

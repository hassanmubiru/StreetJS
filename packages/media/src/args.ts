// src/args.ts
// Pure argument builders and the ffprobe JSON parser. No I/O — fully unit-testable.

import { MediaProbeError, MediaValidationError } from './errors.js';
import type {
  MediaInfo,
  MediaStream,
  ThumbnailOptions,
  TranscodeOptions,
} from './types.js';

/** Safe token for codec/preset identifiers (letters, digits, _ - . +). */
const SAFE_TOKEN = /^[A-Za-z0-9_.+-]+$/;
/** Safe bitrate string, e.g. "128k", "2500k", "5M", "800000". */
const SAFE_BITRATE = /^\d+(?:\.\d+)?[kKmM]?$/;

function assertToken(kind: string, value: string): string {
  if (!SAFE_TOKEN.test(value)) {
    throw new MediaValidationError(`Unsafe ${kind}: ${JSON.stringify(value)}`);
  }
  return value;
}

function assertBitrate(kind: string, value: string): string {
  if (!SAFE_BITRATE.test(value)) {
    throw new MediaValidationError(`Invalid ${kind}: ${JSON.stringify(value)}`);
  }
  return value;
}

function assertPositiveInt(kind: string, value: number): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new MediaValidationError(`${kind} must be a positive integer, got ${value}`);
  }
  return value;
}

/** ffprobe args to emit a single JSON object describing format + streams. */
export function buildProbeArgs(input: string): string[] {
  if (!input) throw new MediaValidationError('probe: input path is required');
  return [
    '-v', 'error',
    '-hide_banner',
    '-print_format', 'json',
    '-show_format',
    '-show_streams',
    input,
  ];
}

/** Build the `scale=` filter value for optional width/height (aspect-preserving). */
export function buildScaleFilter(width?: number, height?: number): string | undefined {
  if (width === undefined && height === undefined) return undefined;
  const w = width === undefined ? -2 : assertPositiveInt('width', width);
  const h = height === undefined ? -2 : assertPositiveInt('height', height);
  return `scale=${w}:${h}`;
}

/** ffmpeg args for a transcode. Output path is always the final element. */
export function buildTranscodeArgs(input: string, output: string, opts: TranscodeOptions = {}): string[] {
  if (!input) throw new MediaValidationError('transcode: input path is required');
  if (!output) throw new MediaValidationError('transcode: output path is required');

  const args: string[] = ['-hide_banner', '-v', 'error'];
  args.push(opts.overwrite === false ? '-n' : '-y');
  args.push('-i', input);

  if (opts.videoCodec) args.push('-c:v', assertToken('videoCodec', opts.videoCodec));
  if (opts.audioCodec) args.push('-c:a', assertToken('audioCodec', opts.audioCodec));

  const scale = buildScaleFilter(opts.width, opts.height);
  if (scale) args.push('-vf', scale);

  if (opts.videoBitrate) args.push('-b:v', assertBitrate('videoBitrate', opts.videoBitrate));
  if (opts.audioBitrate) args.push('-b:a', assertBitrate('audioBitrate', opts.audioBitrate));

  if (opts.crf !== undefined) {
    if (!Number.isInteger(opts.crf) || opts.crf < 0 || opts.crf > 51) {
      throw new MediaValidationError(`crf must be an integer in [0, 51], got ${opts.crf}`);
    }
    args.push('-crf', String(opts.crf));
  }
  if (opts.preset) args.push('-preset', assertToken('preset', opts.preset));
  if (opts.fps !== undefined) args.push('-r', String(assertPositiveInt('fps', opts.fps)));

  if (opts.extraArgs) {
    for (const a of opts.extraArgs) {
      if (typeof a !== 'string' || a.includes('\0')) {
        throw new MediaValidationError(`Invalid extra arg: ${JSON.stringify(a)}`);
      }
      args.push(a);
    }
  }

  args.push(output);
  return args;
}

/** ffmpeg args to extract a single thumbnail frame. */
export function buildThumbnailArgs(input: string, output: string, opts: ThumbnailOptions = {}): string[] {
  if (!input) throw new MediaValidationError('thumbnail: input path is required');
  if (!output) throw new MediaValidationError('thumbnail: output path is required');

  const at = opts.atSeconds ?? 0;
  if (!Number.isFinite(at) || at < 0) {
    throw new MediaValidationError(`thumbnail atSeconds must be >= 0, got ${at}`);
  }

  const args: string[] = ['-hide_banner', '-v', 'error'];
  args.push(opts.overwrite === false ? '-n' : '-y');
  // Seeking before -i is fast (keyframe seek).
  args.push('-ss', String(at), '-i', input, '-frames:v', '1');

  const scale = buildScaleFilter(opts.width, opts.height);
  if (scale) args.push('-vf', scale);

  args.push(output);
  return args;
}

/**
 * ffmpeg args to segment an input into an HLS media playlist + TS segments.
 * `playlistPath` is the .m3u8 output; segments are written alongside it.
 */
export function buildHlsArgs(
  input: string,
  playlistPath: string,
  opts: { segmentSeconds?: number; segmentPattern?: string } = {},
): string[] {
  if (!input) throw new MediaValidationError('hls: input path is required');
  if (!playlistPath) throw new MediaValidationError('hls: playlist path is required');
  const seg = opts.segmentSeconds ?? 6;
  if (!Number.isFinite(seg) || seg <= 0) {
    throw new MediaValidationError(`hls segmentSeconds must be > 0, got ${seg}`);
  }
  const args = [
    '-hide_banner', '-v', 'error', '-y',
    '-i', input,
    '-c:v', 'copy',
    '-c:a', 'copy',
    '-hls_time', String(seg),
    '-hls_playlist_type', 'vod',
    '-f', 'hls',
  ];
  if (opts.segmentPattern) {
    if (!/^[A-Za-z0-9_%./-]+$/.test(opts.segmentPattern)) {
      throw new MediaValidationError(`Invalid hls segmentPattern: ${JSON.stringify(opts.segmentPattern)}`);
    }
    args.push('-hls_segment_filename', opts.segmentPattern);
  }
  args.push(playlistPath);
  return args;
}

// ─── ffprobe JSON parsing ────────────────────────────────────────────────────

/** Evaluate an ffprobe rational like "30000/1001" into a number. */
export function evalFraction(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined;
  const m = value.match(/^(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)$/);
  if (m) {
    const den = Number(m[2]);
    if (den === 0) return undefined;
    return Number(m[1]) / den;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function toNumber(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function mapStreamType(codecType: unknown): MediaStream['type'] {
  switch (codecType) {
    case 'video': return 'video';
    case 'audio': return 'audio';
    case 'subtitle': return 'subtitle';
    case 'data': return 'data';
    default: return 'unknown';
  }
}

/**
 * Parse ffprobe's `-print_format json` output into a normalized {@link MediaInfo}.
 * Throws {@link MediaProbeError} on malformed JSON or a missing format section.
 */
export function parseProbeOutput(stdout: string): MediaInfo {
  let json: unknown;
  try {
    json = JSON.parse(stdout);
  } catch {
    throw new MediaProbeError('ffprobe output was not valid JSON');
  }
  if (!json || typeof json !== 'object') {
    throw new MediaProbeError('ffprobe output was not an object');
  }
  const obj = json as { format?: Record<string, unknown>; streams?: unknown[] };
  const format = obj.format;
  if (!format || typeof format !== 'object') {
    throw new MediaProbeError('ffprobe output is missing the "format" section');
  }

  const rawStreams = Array.isArray(obj.streams) ? obj.streams : [];
  const streams: MediaStream[] = rawStreams.map((s, i) => {
    const st = (s ?? {}) as Record<string, unknown>;
    const stream: MediaStream = {
      index: toNumber(st['index']) ?? i,
      type: mapStreamType(st['codec_type']),
      codec: typeof st['codec_name'] === 'string' ? (st['codec_name'] as string) : 'unknown',
    };
    const width = toNumber(st['width']);
    const height = toNumber(st['height']);
    const fps = evalFraction(st['r_frame_rate']);
    const channels = toNumber(st['channels']);
    const sampleRate = toNumber(st['sample_rate']);
    const bitrate = toNumber(st['bit_rate']);
    if (width !== undefined) stream.width = width;
    if (height !== undefined) stream.height = height;
    if (fps !== undefined) stream.fps = fps;
    if (channels !== undefined) stream.channels = channels;
    if (sampleRate !== undefined) stream.sampleRate = sampleRate;
    if (bitrate !== undefined) stream.bitrate = bitrate;
    return stream;
  });

  const info: MediaInfo = {
    format: typeof format['format_name'] === 'string' ? (format['format_name'] as string) : 'unknown',
    duration: toNumber(format['duration']) ?? 0,
    streams,
  };
  const bitrate = toNumber(format['bit_rate']);
  const size = toNumber(format['size']);
  if (bitrate !== undefined) info.bitrate = bitrate;
  if (size !== undefined) info.sizeBytes = size;
  return info;
}

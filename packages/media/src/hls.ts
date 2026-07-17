// src/hls.ts
// Pure HLS playlist (m3u8) builders. No I/O — fully unit-testable, and usable
// independently of ffmpeg when segments already exist (e.g. produced elsewhere).

import { MediaValidationError } from './errors.js';
import type { HlsSegment, HlsVariant } from './types.js';

/**
 * Build an HLS **master** playlist referencing one or more variant renditions.
 * Emits `#EXT-X-STREAM-INF` entries in the order given.
 */
export function buildMasterPlaylist(variants: HlsVariant[]): string {
  if (!Array.isArray(variants) || variants.length === 0) {
    throw new MediaValidationError('buildMasterPlaylist: at least one variant is required');
  }
  const lines: string[] = ['#EXTM3U', '#EXT-X-VERSION:3'];
  for (const v of variants) {
    if (!Number.isFinite(v.bandwidth) || v.bandwidth <= 0) {
      throw new MediaValidationError(`variant bandwidth must be > 0, got ${v.bandwidth}`);
    }
    if (!v.uri) throw new MediaValidationError('variant uri is required');
    const attrs = [`BANDWIDTH=${Math.floor(v.bandwidth)}`];
    if (v.resolution) {
      if (!/^\d+x\d+$/.test(v.resolution)) {
        throw new MediaValidationError(`variant resolution must be WxH, got ${v.resolution}`);
      }
      attrs.push(`RESOLUTION=${v.resolution}`);
    }
    if (v.codecs) attrs.push(`CODECS="${v.codecs}"`);
    lines.push(`#EXT-X-STREAM-INF:${attrs.join(',')}`);
    lines.push(v.uri);
  }
  return lines.join('\n') + '\n';
}

/**
 * Build an HLS **media** (VOD) playlist from ordered segments. `TARGETDURATION`
 * is the ceiling of the longest segment, per the HLS spec.
 */
export function buildMediaPlaylist(
  segments: HlsSegment[],
  opts: { version?: number } = {},
): string {
  if (!Array.isArray(segments) || segments.length === 0) {
    throw new MediaValidationError('buildMediaPlaylist: at least one segment is required');
  }
  let maxDuration = 0;
  for (const s of segments) {
    if (!Number.isFinite(s.duration) || s.duration <= 0) {
      throw new MediaValidationError(`segment duration must be > 0, got ${s.duration}`);
    }
    if (!s.uri) throw new MediaValidationError('segment uri is required');
    if (s.duration > maxDuration) maxDuration = s.duration;
  }
  const lines: string[] = [
    '#EXTM3U',
    `#EXT-X-VERSION:${opts.version ?? 3}`,
    `#EXT-X-TARGETDURATION:${Math.ceil(maxDuration)}`,
    '#EXT-X-MEDIA-SEQUENCE:0',
    '#EXT-X-PLAYLIST-TYPE:VOD',
  ];
  for (const s of segments) {
    lines.push(`#EXTINF:${s.duration.toFixed(6)},`);
    lines.push(s.uri);
  }
  lines.push('#EXT-X-ENDLIST');
  return lines.join('\n') + '\n';
}

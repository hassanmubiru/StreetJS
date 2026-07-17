/**
 * @streetjs/media — the StreetJS media-processing abstraction.
 *
 * A provider-agnostic wrapper over **ffmpeg**/**ffprobe** for probing,
 * transcoding, thumbnail extraction, and HLS manifest generation. All process
 * execution goes through an injectable {@link CommandRunner}, so the whole
 * package is unit-testable without the binaries installed; the pure argument
 * builders, ffprobe JSON parser, and HLS playlist builders have no I/O at all.
 *
 * ```ts
 * import { MediaProcessor } from '@streetjs/media';
 *
 * const media = new MediaProcessor(); // uses ffmpeg/ffprobe on PATH
 * const info = await media.probe('input.mp4');
 * await media.transcode('input.mp4', 'out.mp4', { videoCodec: 'libx264', crf: 23, height: 720 });
 * await media.thumbnail('input.mp4', 'thumb.jpg', { atSeconds: 5, width: 320 });
 * await media.hls('input.mp4', 'out.m3u8', { segmentSeconds: 6 });
 * ```
 */

export { MediaProcessor } from './processor.js';
export type { MediaProcessorOptions, MediaOperationResult } from './processor.js';

export { NodeCommandRunner } from './runner.js';

export {
  buildProbeArgs,
  buildTranscodeArgs,
  buildThumbnailArgs,
  buildHlsArgs,
  buildScaleFilter,
  parseProbeOutput,
  evalFraction,
} from './args.js';

export { buildMasterPlaylist, buildMediaPlaylist } from './hls.js';

export {
  MediaError,
  MediaValidationError,
  MediaCommandError,
  MediaProbeError,
} from './errors.js';

export type {
  MediaInfo,
  MediaStream,
  TranscodeOptions,
  ThumbnailOptions,
  HlsVariant,
  HlsSegment,
  CommandResult,
  CommandRunner,
} from './types.js';

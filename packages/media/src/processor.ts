// src/processor.ts
// MediaProcessor: orchestrates ffprobe/ffmpeg through an injectable CommandRunner.

import { MediaCommandError } from './errors.js';
import { NodeCommandRunner } from './runner.js';
import {
  buildHlsArgs,
  buildProbeArgs,
  buildThumbnailArgs,
  buildTranscodeArgs,
  parseProbeOutput,
} from './args.js';
import type {
  CommandRunner,
  MediaInfo,
  ThumbnailOptions,
  TranscodeOptions,
} from './types.js';

export interface MediaProcessorOptions {
  /** Path/name of the ffmpeg binary. Default 'ffmpeg'. */
  ffmpegPath?: string;
  /** Path/name of the ffprobe binary. Default 'ffprobe'. */
  ffprobePath?: string;
  /** Injected command runner. Default {@link NodeCommandRunner}. */
  runner?: CommandRunner;
}

/** Result of a transcode/thumbnail/HLS operation. */
export interface MediaOperationResult {
  /** The output path written. */
  output: string;
  /** Full argv used, for logging/debugging. */
  args: string[];
}

/**
 * High-level media operations over ffmpeg/ffprobe. All process execution goes
 * through the injected {@link CommandRunner}, so this class is fully testable
 * with a fake runner and needs no binaries in CI.
 */
export class MediaProcessor {
  private readonly ffmpeg: string;
  private readonly ffprobe: string;
  private readonly runner: CommandRunner;

  constructor(options: MediaProcessorOptions = {}) {
    this.ffmpeg = options.ffmpegPath ?? 'ffmpeg';
    this.ffprobe = options.ffprobePath ?? 'ffprobe';
    this.runner = options.runner ?? new NodeCommandRunner();
  }

  /** Probe a media file, returning normalized format + stream info. */
  async probe(input: string): Promise<MediaInfo> {
    const args = buildProbeArgs(input);
    const res = await this.runner.run(this.ffprobe, args);
    if (res.code !== 0) {
      throw new MediaCommandError(`ffprobe exited with code ${res.code}`, res.code, res.stderr);
    }
    return parseProbeOutput(res.stdout);
  }

  /** Transcode `input` to `output` with the given options. */
  async transcode(
    input: string,
    output: string,
    opts: TranscodeOptions = {},
  ): Promise<MediaOperationResult> {
    const args = buildTranscodeArgs(input, output, opts);
    await this.exec(args);
    return { output, args };
  }

  /** Extract a single thumbnail frame from `input` to `output`. */
  async thumbnail(
    input: string,
    output: string,
    opts: ThumbnailOptions = {},
  ): Promise<MediaOperationResult> {
    const args = buildThumbnailArgs(input, output, opts);
    await this.exec(args);
    return { output, args };
  }

  /**
   * Segment `input` into an HLS media playlist (`playlistPath`) + segments.
   * For master playlists over multiple renditions, use `buildMasterPlaylist`.
   */
  async hls(
    input: string,
    playlistPath: string,
    opts: { segmentSeconds?: number; segmentPattern?: string } = {},
  ): Promise<MediaOperationResult> {
    const args = buildHlsArgs(input, playlistPath, opts);
    await this.exec(args);
    return { output: playlistPath, args };
  }

  private async exec(args: string[]): Promise<void> {
    const res = await this.runner.run(this.ffmpeg, args);
    if (res.code !== 0) {
      throw new MediaCommandError(`ffmpeg exited with code ${res.code}`, res.code, res.stderr);
    }
  }
}

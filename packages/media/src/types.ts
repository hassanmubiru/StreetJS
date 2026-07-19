// src/types.ts
// Public types and contracts for the media package.

/** A single stream (video/audio/subtitle) reported by ffprobe. */
export interface MediaStream {
  index: number;
  type: 'video' | 'audio' | 'subtitle' | 'data' | 'unknown';
  codec: string;
  /** Video only: pixel width. */
  width?: number;
  /** Video only: pixel height. */
  height?: number;
  /** Video only: frames per second (evaluated from the ffprobe fraction). */
  fps?: number;
  /** Audio only: channel count. */
  channels?: number;
  /** Audio only: sample rate in Hz. */
  sampleRate?: number;
  /** Stream bitrate in bits/second, when reported. */
  bitrate?: number;
}

/** Normalized probe result derived from ffprobe's JSON output. */
export interface MediaInfo {
  /** Container format name (e.g. "mov,mp4,m4a,3gp,3g2,mj2"). */
  format: string;
  /** Total duration in seconds. */
  duration: number;
  /** Overall bitrate in bits/second, when reported. */
  bitrate?: number;
  /** File size in bytes, when reported. */
  sizeBytes?: number;
  streams: MediaStream[];
}

/** Options for {@link MediaProcessor.transcode}. */
export interface TranscodeOptions {
  /** Video codec, e.g. "libx264", "libvpx-vp9". Omit to copy/auto. */
  videoCodec?: string;
  /** Audio codec, e.g. "aac", "libopus". Omit to copy/auto. */
  audioCodec?: string;
  /** Target width; height auto if omitted (uses scale filter when set). */
  width?: number;
  /** Target height; width auto if omitted. */
  height?: number;
  /** Target video bitrate, e.g. "2500k". */
  videoBitrate?: string;
  /** Target audio bitrate, e.g. "128k". */
  audioBitrate?: string;
  /** Constant Rate Factor for x264/x265 (0–51; lower = better quality). */
  crf?: number;
  /** Encoder preset, e.g. "veryfast", "medium". */
  preset?: string;
  /** Frames per second to enforce. */
  fps?: number;
  /** Overwrite the output if it exists (adds `-y`). Default true. */
  overwrite?: boolean;
  /** Extra raw ffmpeg args appended before the output path (validated). */
  extraArgs?: string[];
}

/** Options for {@link MediaProcessor.thumbnail}. */
export interface ThumbnailOptions {
  /** Timestamp (seconds) to grab the frame at. Default 0. */
  atSeconds?: number;
  /** Output width; aspect-preserved when height omitted. */
  width?: number;
  /** Output height; aspect-preserved when width omitted. */
  height?: number;
  /** Overwrite the output if it exists. Default true. */
  overwrite?: boolean;
}

/** A single HLS variant (rendition) for the master playlist. */
export interface HlsVariant {
  /** Peak bandwidth in bits/second. */
  bandwidth: number;
  /** Resolution string, e.g. "1280x720". */
  resolution?: string;
  /** Codecs attribute, e.g. "avc1.4d401f,mp4a.40.2". */
  codecs?: string;
  /** Relative URI of the variant's media playlist. */
  uri: string;
}

/** A single media-playlist segment. */
export interface HlsSegment {
  /** Segment duration in seconds. */
  duration: number;
  /** Relative URI of the segment file. */
  uri: string;
}

/**
 * A single timed transcript cue. Structural by design: the segments returned
 * by `@streetjs/ai`'s `transcribe` (`{ start, end, text }`) map onto this
 * directly, so caption building stays dependency-free.
 */
export interface TranscriptCue {
  /** Cue start time in seconds (>= 0). */
  start: number;
  /** Cue end time in seconds (>= start). */
  end: number;
  /** Caption text (CR/LF is normalized on output). */
  text: string;
  /** Optional cue identifier line. */
  id?: string;
}

/** Options for {@link buildWebVtt}. */
export interface WebVttOptions {
  /** Optional header NOTE comment placed after the WEBVTT line. */
  header?: string;
}

/** Options for waveform decoding / peak extraction. */
export interface WaveformOptions {
  /** PCM sample rate (Hz) to decode at. Default 8000. */
  sampleRate?: number;
}

/** A compact, normalized waveform peak set for a scrubber/preview UI. */
export interface WaveformPeaks {
  /** Schema version. */
  version: 1;
  /** Channel count of the reduced data (always mono here). */
  channels: 1;
  /** Number of peak buckets actually produced. */
  bucketCount: number;
  /** Normalized absolute-max amplitude per bucket, each in `[0, 1]`. */
  peaks: number[];
  /** Sample rate the PCM was decoded at, when known. */
  sampleRate?: number;
}

/** Result of a command-backed operation. */
export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * Abstraction over process execution. The default {@link NodeCommandRunner}
 * shells out to real binaries; tests inject a fake so the package is fully
 * exercisable without ffmpeg/ffprobe installed.
 */
export interface CommandRunner {
  run(command: string, args: string[]): Promise<CommandResult>;
}

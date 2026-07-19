# Changelog

All notable changes to `@streetjs/media` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0]

### Added

- **WebVTT captions** — `buildWebVtt(cues, options?)` turns timed transcript cues
  into a valid WebVTT track for an HTML5 `<track>`, plus `formatVttTimestamp`.
  The structural `TranscriptCue` type maps directly onto `@streetjs/ai`'s
  `transcribe` segments, so caption building stays dependency-free.
- **Waveform peaks** — `buildWaveformArgs(input, options?)` decodes an input to
  mono s16le PCM on stdout, and `computeWaveformPeaks(pcm, { buckets })` reduces
  raw PCM bytes into a compact, normalized (`0..1`) peak array (`WaveformPeaks`)
  for a scrubber/preview UI. Both are pure — no binaries or I/O in the reducer.
- New public types: `TranscriptCue`, `WebVttOptions`, `WaveformOptions`,
  `WaveformPeaks`.

Additive, backward-compatible with 1.0.0. 34 tests, 100% line coverage.

[1.1.0]: https://github.com/hassanmubiru/StreetJS/releases/tag/media-v1.1.0

## [1.0.0]

### Added

- Initial release of the StreetJS media-processing abstraction over ffmpeg/ffprobe.
- `MediaProcessor` with `probe`, `transcode`, `thumbnail`, and `hls`, driven by an
  injectable `CommandRunner` (`NodeCommandRunner` default) so it is fully testable
  without the binaries installed.
- Pure argv builders (`buildProbeArgs`, `buildTranscodeArgs`, `buildThumbnailArgs`,
  `buildHlsArgs`, `buildScaleFilter`) with input validation and a `shell: false`
  execution model (no command-injection surface).
- Pure ffprobe-JSON parser (`parseProbeOutput`, `evalFraction`) producing a
  normalized `MediaInfo` (format, duration, bitrate, size, typed streams).
- Pure HLS playlist builders (`buildMasterPlaylist`, `buildMediaPlaylist`).
- Typed error hierarchy: `MediaError`, `MediaValidationError`, `MediaCommandError`,
  `MediaProbeError`.
- Zero runtime dependencies (Node core only); ESM. 21 tests, 100% line coverage,
  and a runnable example that needs no ffmpeg.

[1.0.0]: https://github.com/hassanmubiru/StreetJS/releases/tag/media-v1.0.0

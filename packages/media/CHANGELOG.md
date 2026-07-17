# Changelog

All notable changes to `@streetjs/media` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

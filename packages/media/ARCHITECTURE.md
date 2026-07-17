# Architecture — @streetjs/media

## Purpose

`@streetjs/media` is the StreetJS media-processing layer: a thin, safe, testable
abstraction over `ffmpeg`/`ffprobe` for probing, transcoding, thumbnails, and
HLS. It exists so applications (StreetStudio and others) never shell out to
ffmpeg ad-hoc — they get validated arguments, a normalized probe model, and
deterministic testability.

## Dependencies

```
node:child_process   (spawn — only inside NodeCommandRunner)
```

Zero third-party runtime dependencies. The ffmpeg/ffprobe **binaries** are a
runtime prerequisite of the default runner, not an npm dependency.

## Design

### Layered, with a pure core

The package is split so that everything except the actual process spawn is pure
and unit-testable:

- **`args.ts`** — pure argv builders (`buildProbeArgs`, `buildTranscodeArgs`,
  `buildThumbnailArgs`, `buildHlsArgs`, `buildScaleFilter`) and the ffprobe JSON
  parser (`parseProbeOutput`, `evalFraction`). No I/O.
- **`hls.ts`** — pure HLS master/media playlist builders. No I/O; usable even
  when segments are produced elsewhere.
- **`runner.ts`** — the only impure module: `NodeCommandRunner` wraps
  `child_process.spawn`.
- **`processor.ts`** — `MediaProcessor` composes the builders + parser + an
  **injected** `CommandRunner`, checks exit codes, and maps failures to typed
  errors.

### Injectable command runner

`MediaProcessor` takes a `CommandRunner` (`run(command, args) => Promise<{ code,
stdout, stderr }>`). Production uses `NodeCommandRunner`; tests inject a fake
that returns scripted output. This is the same dependency-injection seam used
across StreetJS (clock in `ratelimit`, fetch in `http-client`), and it makes the
package fully exercisable in CI **without ffmpeg installed**.

### Injection-safe argument construction

Arguments are always passed as a real argv with `shell: false`, so option values
never traverse a shell. On top of that, `args.ts` validates codec/preset tokens
(`[A-Za-z0-9_.+-]`), bitrate strings, CRF range `[0,51]`, positive integer
dimensions/fps, HLS segment patterns, and rejects raw `extraArgs` containing NUL
bytes — turning mistakes and injection attempts into `MediaValidationError`.

### Normalized probe model

`parseProbeOutput` turns ffprobe's `-print_format json` into a stable
`MediaInfo` (format, duration, bitrate, size, and typed streams with
width/height/fps/channels/sampleRate/bitrate), evaluating rational frame rates
like `30000/1001`. Malformed output raises `MediaProbeError` rather than leaking
undefined shapes.

## Testing

The suite runs with **no ffmpeg/ffprobe** by injecting a fake runner, and covers
every argv builder (including all validation rejections), the probe parser
(valid/partial/malformed), the HLS builders, and the processor's success/failure
paths. `NodeCommandRunner` itself is covered against the always-present `node`
binary (stdout capture, non-zero exit, spawn failure). Coverage is 100%
lines/functions and ≥92% branches (declared floor 88%).

## Non-goals

- No bundled ffmpeg binary — the operator provides it (or injects a runner).
- No DASH yet (HLS only); the pure-builder design leaves room to add it.
- No storage/upload concerns — pair with `@streetjs/storage` for persistence.

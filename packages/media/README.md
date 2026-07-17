# @streetjs/media

The StreetJS media-processing abstraction: a provider-agnostic wrapper over
**ffmpeg** and **ffprobe** for probing, transcoding, thumbnail extraction, and
HLS manifest generation. All process execution goes through an **injectable
command runner**, so the whole package is unit-testable without the binaries
installed — and the pure argument builders, ffprobe JSON parser, and HLS
playlist builders have no I/O at all. ESM.

## Install

```bash
npm install @streetjs/media
# and ensure ffmpeg + ffprobe are available on PATH (or pass explicit paths)
```

## Usage

```ts
import { MediaProcessor } from '@streetjs/media';

const media = new MediaProcessor(); // uses ffmpeg/ffprobe on PATH

// Probe → normalized format + stream info
const info = await media.probe('input.mp4');
// { format, duration, bitrate?, sizeBytes?, streams: [{ type, codec, width, height, fps, ... }] }

// Transcode
await media.transcode('input.mp4', 'out.mp4', {
  videoCodec: 'libx264', audioCodec: 'aac', height: 720, crf: 23, preset: 'veryfast',
});

// Thumbnail (fast keyframe seek before decode)
await media.thumbnail('input.mp4', 'thumb.jpg', { atSeconds: 5, width: 320 });

// HLS segmentation (VOD)
await media.hls('input.mp4', 'out.m3u8', { segmentSeconds: 6 });
```

Point at explicit binaries or a custom runner:

```ts
new MediaProcessor({ ffmpegPath: '/usr/bin/ffmpeg', ffprobePath: '/usr/bin/ffprobe' });
new MediaProcessor({ runner: myCommandRunner }); // implements { run(command, args) }
```

## HLS playlists (no ffmpeg required)

The playlist builders are pure and usable independently — e.g. to assemble a
master playlist over renditions produced elsewhere:

```ts
import { buildMasterPlaylist, buildMediaPlaylist } from '@streetjs/media';

buildMasterPlaylist([
  { bandwidth: 800_000,   resolution: '640x360',  uri: '360p/index.m3u8' },
  { bandwidth: 2_500_000, resolution: '1280x720', uri: '720p/index.m3u8' },
]);

buildMediaPlaylist([
  { duration: 6, uri: 'seg0.ts' },
  { duration: 6, uri: 'seg1.ts' },
  { duration: 3.4, uri: 'seg2.ts' },
]); // computes #EXT-X-TARGETDURATION and appends #EXT-X-ENDLIST
```

## Safety & testability

- Arguments are passed as a real **argv** (`shell: false`) — values never go
  through a shell, so there is no command-injection surface. Codec/preset/
  bitrate/segment-pattern values are additionally validated against safe
  character sets, and numeric options are range-checked.
- Because the `CommandRunner` is injectable, applications and tests can script
  ffmpeg/ffprobe behavior deterministically. The pure builders/parser can be
  unit-tested with zero processes.

## API

| Export | Description |
| ------ | ----------- |
| `MediaProcessor` | `probe` / `transcode` / `thumbnail` / `hls` orchestrator. |
| `NodeCommandRunner` | Default runner over `node:child_process`. |
| `buildProbeArgs` / `buildTranscodeArgs` / `buildThumbnailArgs` / `buildHlsArgs` / `buildScaleFilter` | Pure ffmpeg/ffprobe argv builders. |
| `parseProbeOutput` / `evalFraction` | Pure ffprobe-JSON → `MediaInfo` parser. |
| `buildMasterPlaylist` / `buildMediaPlaylist` | Pure HLS m3u8 builders. |
| `MediaError` / `MediaValidationError` / `MediaCommandError` / `MediaProbeError` | Typed errors. |

## Example

A complete runnable example (no ffmpeg needed — uses a fake runner) lives in
[`src/examples/integration.ts`](./src/examples/integration.ts):

```bash
npm run example -w packages/media
```

## License

MIT — see [LICENSE](./LICENSE).

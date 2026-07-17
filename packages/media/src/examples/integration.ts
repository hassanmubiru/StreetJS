/**
 * @streetjs/media — runnable integration example.
 *
 * Demonstrates the whole surface WITHOUT ffmpeg installed by injecting a fake
 * command runner (the real default shells out to ffmpeg/ffprobe on PATH). Also
 * shows the pure ffprobe parser and HLS playlist builders, which need no runner
 * at all.
 *
 * Run with: `npm run example -w packages/media`
 */

import {
  MediaProcessor,
  parseProbeOutput,
  buildMasterPlaylist,
  buildMediaPlaylist,
  type CommandRunner,
  type CommandResult,
} from '../index.js';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`example assertion failed: ${msg}`);
}

// A fake runner scripting ffprobe/ffmpeg responses (no binaries needed).
const probeJson = JSON.stringify({
  format: { format_name: 'mov,mp4', duration: '90.0', bit_rate: '3000000' },
  streams: [
    { index: 0, codec_type: 'video', codec_name: 'h264', width: 1920, height: 1080, r_frame_rate: '30/1' },
    { index: 1, codec_type: 'audio', codec_name: 'aac', channels: 2, sample_rate: '48000' },
  ],
});
class DemoRunner implements CommandRunner {
  async run(command: string): Promise<CommandResult> {
    if (command.includes('ffprobe')) return { code: 0, stdout: probeJson, stderr: '' };
    return { code: 0, stdout: '', stderr: '' }; // ffmpeg success
  }
}

const media = new MediaProcessor({ runner: new DemoRunner() });

// 1. Probe.
const info = await media.probe('input.mp4');
console.log(`probe: ${info.format} · ${info.duration}s · ${info.streams.length} streams`);
assert(info.streams[0]!.width === 1920, 'video width parsed');
assert(info.streams[1]!.channels === 2, 'audio channels parsed');

// 2. Transcode to 720p H.264.
const t = await media.transcode('input.mp4', 'out_720p.mp4', {
  videoCodec: 'libx264', audioCodec: 'aac', height: 720, crf: 23, preset: 'veryfast',
});
console.log('transcode argv:', t.args.join(' '));

// 3. Thumbnail at 5s.
const th = await media.thumbnail('input.mp4', 'thumb.jpg', { atSeconds: 5, width: 320 });
console.log('thumbnail ->', th.output);

// 4. HLS segmentation.
const h = await media.hls('input.mp4', 'out.m3u8', { segmentSeconds: 6 });
console.log('hls ->', h.output);

// 5. Pure playlist builders (no ffmpeg): a two-rendition master + a media playlist.
const master = buildMasterPlaylist([
  { bandwidth: 800_000, resolution: '640x360', uri: '360p/index.m3u8' },
  { bandwidth: 2_500_000, resolution: '1280x720', uri: '720p/index.m3u8' },
]);
const mediaPlaylist = buildMediaPlaylist([
  { duration: 6, uri: 'seg0.ts' },
  { duration: 6, uri: 'seg1.ts' },
  { duration: 3.4, uri: 'seg2.ts' },
]);
assert(master.includes('#EXT-X-STREAM-INF'), 'master playlist built');
assert(mediaPlaylist.includes('#EXT-X-TARGETDURATION:6'), 'media playlist built');
console.log('\nmaster playlist:\n' + master);

// 6. Pure parser can be used standalone.
assert(parseProbeOutput(probeJson).duration === 90, 'standalone parse');

console.log('All @streetjs/media example assertions passed.');

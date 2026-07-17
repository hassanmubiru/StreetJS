import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  MediaProcessor,
  buildProbeArgs,
  buildTranscodeArgs,
  buildThumbnailArgs,
  buildHlsArgs,
  buildScaleFilter,
  parseProbeOutput,
  evalFraction,
  buildMasterPlaylist,
  buildMediaPlaylist,
  MediaValidationError,
  MediaCommandError,
  MediaProbeError,
  type CommandRunner,
  type CommandResult,
} from '../index.js';

// ── A scriptable fake command runner (no ffmpeg/ffprobe needed) ────────────────

class FakeRunner implements CommandRunner {
  calls: { command: string; args: string[] }[] = [];
  constructor(private readonly result: CommandResult) {}
  async run(command: string, args: string[]): Promise<CommandResult> {
    this.calls.push({ command, args });
    return this.result;
  }
}

// ── Argument builders ──────────────────────────────────────────────────────────

test('buildProbeArgs requests JSON format + streams', () => {
  const args = buildProbeArgs('in.mp4');
  assert.deepEqual(args, [
    '-v', 'error', '-hide_banner', '-print_format', 'json', '-show_format', '-show_streams', 'in.mp4',
  ]);
  assert.throws(() => buildProbeArgs(''), MediaValidationError);
});

test('buildScaleFilter preserves aspect with -2 for the omitted dimension', () => {
  assert.equal(buildScaleFilter(1280, 720), 'scale=1280:720');
  assert.equal(buildScaleFilter(640, undefined), 'scale=640:-2');
  assert.equal(buildScaleFilter(undefined, 480), 'scale=-2:480');
  assert.equal(buildScaleFilter(undefined, undefined), undefined);
});

test('buildTranscodeArgs assembles codecs, scale, bitrates, crf, preset, fps, overwrite', () => {
  const args = buildTranscodeArgs('in.mp4', 'out.mp4', {
    videoCodec: 'libx264', audioCodec: 'aac', width: 1280, height: 720,
    videoBitrate: '2500k', audioBitrate: '128k', crf: 23, preset: 'veryfast', fps: 30,
  });
  assert.equal(args[0], '-hide_banner');
  assert.ok(args.includes('-y'), 'overwrite by default');
  assert.deepEqual(args.slice(-1), ['out.mp4'], 'output is last');
  for (const [flag, val] of [['-c:v', 'libx264'], ['-c:a', 'aac'], ['-vf', 'scale=1280:720'], ['-b:v', '2500k'], ['-b:a', '128k'], ['-crf', '23'], ['-preset', 'veryfast'], ['-r', '30']] as const) {
    const i = args.indexOf(flag);
    assert.ok(i >= 0 && args[i + 1] === val, `${flag} ${val}`);
  }
});

test('buildTranscodeArgs uses -n when overwrite is disabled and appends validated extraArgs', () => {
  const args = buildTranscodeArgs('in.mp4', 'out.mp4', { overwrite: false, extraArgs: ['-movflags', '+faststart'] });
  assert.ok(args.includes('-n') && !args.includes('-y'));
  assert.ok(args.includes('-movflags') && args.includes('+faststart'));
});

test('buildTranscodeArgs rejects unsafe values', () => {
  assert.throws(() => buildTranscodeArgs('i', 'o', { videoCodec: 'libx264; rm -rf /' }), MediaValidationError);
  assert.throws(() => buildTranscodeArgs('i', 'o', { videoBitrate: 'lots' }), MediaValidationError);
  assert.throws(() => buildTranscodeArgs('i', 'o', { crf: 99 }), MediaValidationError);
  assert.throws(() => buildTranscodeArgs('i', 'o', { width: -5 }), MediaValidationError);
  assert.throws(() => buildTranscodeArgs('i', 'o', { extraArgs: ['bad\0arg'] }), MediaValidationError);
  assert.throws(() => buildTranscodeArgs('', 'o'), MediaValidationError);
  assert.throws(() => buildTranscodeArgs('i', ''), MediaValidationError);
});

test('buildThumbnailArgs seeks before input and grabs one frame', () => {
  const args = buildThumbnailArgs('in.mp4', 'thumb.jpg', { atSeconds: 5, width: 320 });
  assert.ok(args.includes('-ss') && args[args.indexOf('-ss') + 1] === '5');
  assert.ok(args.indexOf('-ss') < args.indexOf('-i'), 'fast seek before input');
  assert.ok(args.includes('-frames:v') && args[args.indexOf('-frames:v') + 1] === '1');
  assert.ok(args.includes('-vf') && args[args.indexOf('-vf') + 1] === 'scale=320:-2');
  assert.deepEqual(args.slice(-1), ['thumb.jpg']);
  assert.throws(() => buildThumbnailArgs('in.mp4', 'o.jpg', { atSeconds: -1 }), MediaValidationError);
});

test('buildHlsArgs sets segment time and validates inputs', () => {
  const args = buildHlsArgs('in.mp4', 'out.m3u8', { segmentSeconds: 6, segmentPattern: 'seg_%03d.ts' });
  assert.ok(args.includes('-hls_time') && args[args.indexOf('-hls_time') + 1] === '6');
  assert.ok(args.includes('-hls_segment_filename') && args.includes('seg_%03d.ts'));
  assert.equal(args[args.length - 1], 'out.m3u8');
  assert.throws(() => buildHlsArgs('in.mp4', 'out.m3u8', { segmentSeconds: 0 }), MediaValidationError);
  assert.throws(() => buildHlsArgs('in.mp4', 'out.m3u8', { segmentPattern: 'bad pattern!' }), MediaValidationError);
});

// ── ffprobe parsing ────────────────────────────────────────────────────────────

test('evalFraction evaluates rationals and plain numbers', () => {
  assert.equal(evalFraction('30000/1001'), 30000 / 1001);
  assert.equal(evalFraction('25'), 25);
  assert.equal(evalFraction('30/0'), undefined);
  assert.equal(evalFraction(undefined), undefined);
});

test('parseProbeOutput normalizes format and streams', () => {
  const json = JSON.stringify({
    format: { format_name: 'mov,mp4', duration: '12.5', bit_rate: '800000', size: '1048576' },
    streams: [
      { index: 0, codec_type: 'video', codec_name: 'h264', width: 1920, height: 1080, r_frame_rate: '30000/1001', bit_rate: '750000' },
      { index: 1, codec_type: 'audio', codec_name: 'aac', channels: 2, sample_rate: '48000' },
      { index: 2, codec_type: 'subtitle', codec_name: 'mov_text' },
    ],
  });
  const info = parseProbeOutput(json);
  assert.equal(info.format, 'mov,mp4');
  assert.equal(info.duration, 12.5);
  assert.equal(info.bitrate, 800000);
  assert.equal(info.sizeBytes, 1048576);
  assert.equal(info.streams.length, 3);
  const v = info.streams[0]!;
  assert.equal(v.type, 'video');
  assert.equal(v.width, 1920);
  assert.equal(v.height, 1080);
  assert.ok(Math.abs(v.fps! - 29.97) < 0.01);
  const a = info.streams[1]!;
  assert.equal(a.type, 'audio');
  assert.equal(a.channels, 2);
  assert.equal(a.sampleRate, 48000);
  assert.equal(info.streams[2]!.type, 'subtitle');
});

test('parseProbeOutput tolerates missing optionals and defaults', () => {
  const info = parseProbeOutput(JSON.stringify({ format: {}, streams: [{}] }));
  assert.equal(info.format, 'unknown');
  assert.equal(info.duration, 0);
  assert.equal(info.bitrate, undefined);
  assert.equal(info.streams[0]!.type, 'unknown');
  assert.equal(info.streams[0]!.codec, 'unknown');
  assert.equal(info.streams[0]!.index, 0);
});

test('parseProbeOutput throws on malformed input', () => {
  assert.throws(() => parseProbeOutput('not json'), MediaProbeError);
  assert.throws(() => parseProbeOutput('"a string"'), MediaProbeError);
  assert.throws(() => parseProbeOutput(JSON.stringify({ streams: [] })), MediaProbeError);
});

// ── HLS playlists ────────────────────────────────────────────────────────────

test('buildMasterPlaylist emits STREAM-INF entries', () => {
  const m = buildMasterPlaylist([
    { bandwidth: 800000, resolution: '640x360', codecs: 'avc1.4d401e,mp4a.40.2', uri: '360p.m3u8' },
    { bandwidth: 2500000, resolution: '1280x720', uri: '720p.m3u8' },
  ]);
  assert.ok(m.startsWith('#EXTM3U'));
  assert.match(m, /#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360,CODECS="avc1.4d401e,mp4a.40.2"\n360p\.m3u8/);
  assert.match(m, /BANDWIDTH=2500000,RESOLUTION=1280x720\n720p\.m3u8/);
  assert.throws(() => buildMasterPlaylist([]), MediaValidationError);
  assert.throws(() => buildMasterPlaylist([{ bandwidth: 0, uri: 'x' }]), MediaValidationError);
  assert.throws(() => buildMasterPlaylist([{ bandwidth: 1, resolution: 'nope', uri: 'x' }]), MediaValidationError);
  assert.throws(() => buildMasterPlaylist([{ bandwidth: 1, uri: '' }]), MediaValidationError);
});

test('buildMediaPlaylist computes TARGETDURATION and lists segments', () => {
  const m = buildMediaPlaylist([
    { duration: 5.9, uri: 'seg0.ts' },
    { duration: 6.0, uri: 'seg1.ts' },
    { duration: 3.2, uri: 'seg2.ts' },
  ]);
  assert.match(m, /#EXT-X-TARGETDURATION:6/);
  assert.match(m, /#EXT-X-PLAYLIST-TYPE:VOD/);
  assert.match(m, /#EXTINF:5\.900000,\nseg0\.ts/);
  assert.ok(m.trimEnd().endsWith('#EXT-X-ENDLIST'));
  assert.throws(() => buildMediaPlaylist([]), MediaValidationError);
  assert.throws(() => buildMediaPlaylist([{ duration: 0, uri: 'x' }]), MediaValidationError);
  assert.throws(() => buildMediaPlaylist([{ duration: 1, uri: '' }]), MediaValidationError);
});

// ── MediaProcessor (fake runner) ───────────────────────────────────────────────

test('probe runs ffprobe and parses its output', async () => {
  const runner = new FakeRunner({
    code: 0,
    stdout: JSON.stringify({ format: { format_name: 'mp4', duration: '3' }, streams: [] }),
    stderr: '',
  });
  const media = new MediaProcessor({ runner, ffprobePath: 'ffprobe' });
  const info = await media.probe('in.mp4');
  assert.equal(info.duration, 3);
  assert.equal(runner.calls[0]!.command, 'ffprobe');
  assert.ok(runner.calls[0]!.args.includes('in.mp4'));
});

test('probe throws MediaCommandError on a non-zero exit', async () => {
  const runner = new FakeRunner({ code: 1, stdout: '', stderr: 'No such file' });
  const media = new MediaProcessor({ runner });
  await assert.rejects(() => media.probe('missing.mp4'), (err: unknown) => {
    assert.ok(err instanceof MediaCommandError);
    assert.equal((err as MediaCommandError).code, 1);
    assert.match((err as MediaCommandError).stderr, /No such file/);
    return true;
  });
});

test('transcode/thumbnail/hls run ffmpeg with built args and return the output', async () => {
  const runner = new FakeRunner({ code: 0, stdout: '', stderr: '' });
  const media = new MediaProcessor({ runner, ffmpegPath: 'ffmpeg' });

  const t = await media.transcode('in.mp4', 'out.mp4', { videoCodec: 'libx264', crf: 23 });
  assert.equal(t.output, 'out.mp4');
  assert.equal(runner.calls[0]!.command, 'ffmpeg');
  assert.ok(t.args.includes('-crf'));

  const th = await media.thumbnail('in.mp4', 'thumb.jpg', { atSeconds: 2 });
  assert.equal(th.output, 'thumb.jpg');

  const h = await media.hls('in.mp4', 'out.m3u8', { segmentSeconds: 4 });
  assert.equal(h.output, 'out.m3u8');
  assert.ok(h.args.includes('-hls_time'));
});

test('a failing ffmpeg operation raises MediaCommandError with stderr', async () => {
  const runner = new FakeRunner({ code: 69, stdout: '', stderr: 'Invalid codec' });
  const media = new MediaProcessor({ runner });
  await assert.rejects(() => media.transcode('in.mp4', 'out.mp4'), (err: unknown) => {
    assert.ok(err instanceof MediaCommandError);
    assert.equal((err as MediaCommandError).code, 69);
    return true;
  });
});

test('the processor defaults to ffmpeg/ffprobe on PATH when no paths are given', () => {
  // Constructing without a runner uses NodeCommandRunner; we only assert it
  // constructs (no execution here — that would require the binaries).
  assert.doesNotThrow(() => new MediaProcessor());
});

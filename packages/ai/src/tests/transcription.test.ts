import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  FakeAiProvider,
  type TranscriptionRequest,
  type TranscriptionResponse,
  type TranscriptionProvider,
} from '../index.js';
import { OpenAiProvider, type MultipartFetchLike } from '../providers.js';

const enc = (s: string) => new TextEncoder().encode(s);

// ── FakeAiProvider.transcribe (deterministic, offline) ──────────────────────────

test('FakeAiProvider.transcribe decodes UTF-8 audio and emits one segment', async () => {
  const provider = new FakeAiProvider();
  const res = await provider.transcribe({ audio: enc('hello world'), language: 'en' });
  assert.equal(res.text, 'hello world');
  assert.equal(res.language, 'en');
  assert.equal(res.segments?.length, 1);
  assert.equal(res.segments![0]!.start, 0);
  assert.equal(res.segments![0]!.text, 'hello world');
});

test('FakeAiProvider.transcribe omits language when not provided and is deterministic', async () => {
  const provider = new FakeAiProvider();
  const a = await provider.transcribe({ audio: enc('same input') });
  const b = await provider.transcribe({ audio: enc('same input') });
  assert.equal('language' in a, false);
  assert.deepEqual(a, b, 'deterministic for identical input');
});

test('FakeAiProvider honors a transcribeScript override', async () => {
  const provider = new FakeAiProvider({
    transcribeScript: (req): TranscriptionResponse => ({
      text: `scripted:${req.audio.length}`,
      language: 'fr',
      durationSec: 12.5,
    }),
  });
  const res = await provider.transcribe({ audio: enc('anything') });
  assert.equal(res.text, 'scripted:8');
  assert.equal(res.durationSec, 12.5);
});

test('a FakeAiProvider satisfies the TranscriptionProvider contract', async () => {
  const provider: TranscriptionProvider = new FakeAiProvider();
  const res = await provider.transcribe({ audio: enc('contract') });
  assert.equal(res.text, 'contract');
});

// ── OpenAiProvider.transcribe (Whisper, injected multipart fetch) ───────────────

test('OpenAiProvider.transcribe posts multipart to audio/transcriptions and parses verbose_json', async () => {
  let capturedUrl = '';
  let capturedForm: FormData | undefined;
  const fetchStub: MultipartFetchLike = async (url, init) => {
    capturedUrl = url;
    capturedForm = init.body;
    assert.equal(init.method, 'POST');
    assert.match(init.headers['authorization']!, /^Bearer /);
    return {
      ok: true,
      status: 200,
      text: async () => '',
      json: async () => ({
        text: 'the transcript',
        language: 'english',
        duration: 42.0,
        segments: [
          { start: 0, end: 2.5, text: 'the' },
          { start: 2.5, end: 4.0, text: 'transcript' },
        ],
      }),
    };
  };

  const provider = new OpenAiProvider({ apiKey: 'sk-test', transcribeFetch: fetchStub });
  const req: TranscriptionRequest = {
    audio: enc('fake-audio-bytes'),
    mimeType: 'audio/mpeg',
    filename: 'clip.mp3',
    language: 'en',
    prompt: 'proper nouns',
  };
  const res = await provider.transcribe(req);

  assert.match(capturedUrl, /\/audio\/transcriptions$/);
  assert.ok(capturedForm instanceof FormData);
  assert.equal(capturedForm!.get('model'), 'whisper-1');
  assert.equal(capturedForm!.get('response_format'), 'verbose_json');
  assert.equal(capturedForm!.get('language'), 'en');
  assert.equal(capturedForm!.get('prompt'), 'proper nouns');
  assert.ok(capturedForm!.get('file'), 'audio file part attached');

  assert.equal(res.text, 'the transcript');
  assert.equal(res.language, 'english');
  assert.equal(res.durationSec, 42.0);
  assert.equal(res.segments?.length, 2);
  assert.deepEqual(res.segments![1], { start: 2.5, end: 4.0, text: 'transcript' });
});

test('OpenAiProvider.transcribe tolerates a minimal (text-only) response', async () => {
  const fetchStub: MultipartFetchLike = async () => ({
    ok: true, status: 200, text: async () => '', json: async () => ({ text: 'just text' }),
  });
  const provider = new OpenAiProvider({ apiKey: 'k', transcribeFetch: fetchStub });
  const res = await provider.transcribe({ audio: enc('x') });
  assert.equal(res.text, 'just text');
  assert.equal(res.language, undefined);
  assert.equal(res.durationSec, undefined);
  assert.equal(res.segments, undefined);
});

test('OpenAiProvider.transcribe surfaces API errors', async () => {
  const fetchStub: MultipartFetchLike = async () => ({
    ok: false, status: 401, text: async () => 'invalid api key', json: async () => ({}),
  });
  const provider = new OpenAiProvider({ apiKey: 'bad', transcribeFetch: fetchStub });
  await assert.rejects(() => provider.transcribe({ audio: enc('x') }), /openai API error 401/);
});

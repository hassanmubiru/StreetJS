# Changelog

All notable changes to `@streetjs/ai` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0]

### Added

- **Speech-to-text (transcription).** New `TranscriptionRequest`,
  `TranscriptionResponse`, `TranscriptionSegment`, and `TranscriptionProvider`
  types, plus an optional `transcribe?` method on `AiProvider` (backward
  compatible — existing providers are unaffected).
- `FakeAiProvider.transcribe` — deterministic, network-free (decodes UTF-8 audio
  by default; scriptable via `transcribeScript`).
- `OpenAiProvider.transcribe` — real Whisper adapter over
  `audio/transcriptions` using an injectable multipart fetch
  (`MultipartFetchLike`), returning `verbose_json` (text, language, duration,
  time-coded segments) and surfacing API errors.

## [1.0.x]

- Provider-agnostic chat, embeddings, RAG pipeline, vector store, and
  tool-calling session with OpenAI/Anthropic/Ollama/Fake providers.

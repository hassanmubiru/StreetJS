// Unit tests for the OpenAI plugin's request builders + config validation.
// Pure/offline — no network. Run: npm test -w packages/plugin-openai

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  validateOpenAiConfig, buildChatRequest, buildEmbeddingsRequest,
  openAiPluginManifest, OPENAI_PLUGIN_NAME,
} from '../dist/index.js';

const cfg = { apiKey: 'sk-test' };

describe('validateOpenAiConfig', () => {
  it('accepts a minimal config', () => {
    assert.equal(validateOpenAiConfig(cfg).apiKey, 'sk-test');
  });
  it('rejects a missing apiKey', () => {
    assert.throws(() => validateOpenAiConfig({}), /"apiKey" is required/);
  });
  it('rejects a non-https baseUrl', () => {
    assert.throws(() => validateOpenAiConfig({ ...cfg, baseUrl: 'http://x' }), /"baseUrl" must be an https URL/);
  });
});

describe('buildChatRequest', () => {
  it('targets /chat/completions with bearer auth and the model+messages body', () => {
    const req = buildChatRequest(cfg, { model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'hi' }] });
    assert.equal(req.method, 'POST');
    assert.match(req.url, /\/v1\/chat\/completions$/);
    assert.equal(req.headers.authorization, 'Bearer sk-test');
    const body = JSON.parse(req.body);
    assert.equal(body.model, 'gpt-4o-mini');
    assert.equal(body.messages[0].content, 'hi');
  });
  it('honours an organization header and baseUrl override', () => {
    const req = buildChatRequest(
      { apiKey: 'k', organization: 'org_1', baseUrl: 'https://gw.example.com/v1/' },
      { model: 'm', messages: [{ role: 'user', content: 'x' }] },
    );
    assert.equal(req.headers['openai-organization'], 'org_1');
    assert.match(req.url, /^https:\/\/gw\.example\.com\/v1\/chat\/completions$/);
  });
  it('rejects empty messages', () => {
    assert.throws(() => buildChatRequest(cfg, { model: 'm', messages: [] }), /non-empty array/);
  });
});

describe('buildEmbeddingsRequest', () => {
  it('targets /embeddings with the input', () => {
    const req = buildEmbeddingsRequest(cfg, { model: 'text-embedding-3-small', input: 'hello' });
    assert.match(req.url, /\/v1\/embeddings$/);
    assert.equal(JSON.parse(req.body).input, 'hello');
  });
});

describe('manifest', () => {
  it('declares name, capabilities, permissions', () => {
    const m = openAiPluginManifest();
    assert.equal(m.name, OPENAI_PLUGIN_NAME);
    assert.deepEqual(m.capabilities, ['ai', 'llm', 'embeddings']);
    assert.deepEqual(m.permissions, ['net', 'secrets', 'middleware']);
  });
});

// src/platform/ai/llm-client.ts
// LLM client abstractions for OpenAI, Anthropic, and Ollama using node:https only.
import { request as httpsRequest } from 'node:https';
import { request as httpRequest } from 'node:http';
import { URL } from 'node:url';
// ---------------------------------------------------------------------------
// HTTP helper
// ---------------------------------------------------------------------------
async function postJson(url, headers, body) {
    const parsed = new URL(url);
    const useHttps = parsed.protocol === 'https:';
    const reqFn = useHttps ? httpsRequest : httpRequest;
    const payload = JSON.stringify(body);
    return new Promise((resolve, reject) => {
        const req = reqFn({
            hostname: parsed.hostname,
            port: parsed.port || (useHttps ? 443 : 80),
            path: parsed.pathname + (parsed.search || ''),
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'content-length': Buffer.byteLength(payload),
                ...headers,
            },
        }, (res) => {
            const chunks = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => {
                resolve({
                    status: res.statusCode ?? 200,
                    body: Buffer.concat(chunks).toString('utf8'),
                    headers: res.headers,
                });
            });
            res.on('error', reject);
        });
        req.on('error', reject);
        req.write(payload);
        req.end();
    });
}
async function* streamJson(url, headers, body, extractChunk) {
    const parsed = new URL(url);
    const useHttps = parsed.protocol === 'https:';
    const reqFn = useHttps ? httpsRequest : httpRequest;
    const payload = JSON.stringify(body);
    const chunks = [];
    let resolve = null;
    let done = false;
    let error = null;
    const req = reqFn({
        hostname: parsed.hostname,
        port: parsed.port || (useHttps ? 443 : 80),
        path: parsed.pathname + (parsed.search || ''),
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            'content-length': Buffer.byteLength(payload),
            ...headers,
        },
    }, (res) => {
        let buffer = '';
        res.on('data', (chunk) => {
            buffer += chunk.toString('utf8');
            const lines = buffer.split('\n');
            buffer = lines.pop() ?? '';
            for (const line of lines) {
                const extracted = extractChunk(line.trim());
                if (extracted !== null) {
                    chunks.push(extracted);
                    if (resolve) {
                        const r = resolve;
                        resolve = null;
                        r({ value: chunks.shift(), done: false });
                    }
                }
            }
        });
        res.on('end', () => {
            done = true;
            if (resolve) {
                const r = resolve;
                resolve = null;
                r({ value: '', done: true });
            }
        });
        res.on('error', (err) => {
            error = err;
            if (resolve) {
                const r = resolve;
                resolve = null;
                r({ value: '', done: true });
            }
        });
    });
    req.on('error', (err) => {
        error = err;
    });
    req.write(payload);
    req.end();
    while (!done || chunks.length > 0) {
        if (chunks.length > 0) {
            yield chunks.shift();
        }
        else if (!done) {
            await new Promise((r) => {
                resolve = r;
            });
            if (error)
                throw error;
        }
    }
}
// ---------------------------------------------------------------------------
// OpenAiClient
// ---------------------------------------------------------------------------
export class OpenAiClient {
    apiKey;
    baseUrl;
    constructor(apiKey, baseUrl = 'https://api.openai.com') {
        this.apiKey = apiKey;
        this.baseUrl = baseUrl.replace(/\/$/, '');
    }
    async complete(opts) {
        const resp = await postJson(`${this.baseUrl}/v1/chat/completions`, { authorization: `Bearer ${this.apiKey}` }, {
            model: opts.model,
            messages: opts.messages,
            max_tokens: opts.maxTokens,
            temperature: opts.temperature,
        });
        if (resp.status === 429) {
            const retryAfter = Number(resp.headers['retry-after'] ?? 1);
            await new Promise((r) => setTimeout(r, retryAfter * 1_000));
            return this.complete(opts);
        }
        if (resp.status >= 400) {
            throw new Error(`OpenAI error ${resp.status}: ${resp.body}`);
        }
        const data = JSON.parse(resp.body);
        return {
            content: data.choices[0]?.message.content ?? '',
            tokens: data.usage?.total_tokens,
        };
    }
    async *stream(opts) {
        yield* streamJson(`${this.baseUrl}/v1/chat/completions`, { authorization: `Bearer ${this.apiKey}` }, {
            model: opts.model,
            messages: opts.messages,
            max_tokens: opts.maxTokens,
            temperature: opts.temperature,
            stream: true,
        }, (line) => {
            if (!line.startsWith('data: '))
                return null;
            const data = line.slice(6).trim();
            if (data === '[DONE]')
                return null;
            try {
                const parsed = JSON.parse(data);
                return parsed.choices[0]?.delta.content ?? null;
            }
            catch {
                return null;
            }
        });
    }
}
// ---------------------------------------------------------------------------
// AnthropicClient
// ---------------------------------------------------------------------------
export class AnthropicClient {
    apiKey;
    baseUrl;
    constructor(apiKey, baseUrl = 'https://api.anthropic.com') {
        this.apiKey = apiKey;
        this.baseUrl = baseUrl.replace(/\/$/, '');
    }
    async complete(opts) {
        // Extract system message if present
        const systemMsg = opts.messages.find((m) => m.role === 'system')?.content;
        const userMessages = opts.messages.filter((m) => m.role !== 'system');
        const resp = await postJson(`${this.baseUrl}/v1/messages`, {
            'x-api-key': this.apiKey,
            'anthropic-version': '2023-06-01',
        }, {
            model: opts.model,
            messages: userMessages,
            ...(systemMsg ? { system: systemMsg } : {}),
            max_tokens: opts.maxTokens ?? 1024,
            temperature: opts.temperature,
        });
        if (resp.status === 429) {
            const retryAfter = Number(resp.headers['retry-after'] ?? 1);
            await new Promise((r) => setTimeout(r, retryAfter * 1_000));
            return this.complete(opts);
        }
        if (resp.status >= 400) {
            throw new Error(`Anthropic error ${resp.status}: ${resp.body}`);
        }
        const data = JSON.parse(resp.body);
        const text = data.content.filter((c) => c.type === 'text').map((c) => c.text).join('');
        return {
            content: text,
            tokens: data.usage ? data.usage.input_tokens + data.usage.output_tokens : undefined,
        };
    }
    async *stream(opts) {
        const systemMsg = opts.messages.find((m) => m.role === 'system')?.content;
        const userMessages = opts.messages.filter((m) => m.role !== 'system');
        yield* streamJson(`${this.baseUrl}/v1/messages`, {
            'x-api-key': this.apiKey,
            'anthropic-version': '2023-06-01',
        }, {
            model: opts.model,
            messages: userMessages,
            ...(systemMsg ? { system: systemMsg } : {}),
            max_tokens: opts.maxTokens ?? 1024,
            temperature: opts.temperature,
            stream: true,
        }, (line) => {
            if (!line.startsWith('data: '))
                return null;
            const data = line.slice(6).trim();
            try {
                const parsed = JSON.parse(data);
                if (parsed.type === 'content_block_delta' && parsed.delta?.type === 'text_delta') {
                    return parsed.delta.text;
                }
                return null;
            }
            catch {
                return null;
            }
        });
    }
}
// ---------------------------------------------------------------------------
// OllamaClient
// ---------------------------------------------------------------------------
export class OllamaClient {
    baseUrl;
    constructor(baseUrl = 'http://localhost:11434') {
        this.baseUrl = baseUrl.replace(/\/$/, '');
    }
    async complete(opts) {
        const resp = await postJson(`${this.baseUrl}/api/chat`, {}, {
            model: opts.model,
            messages: opts.messages,
            stream: false,
            options: {
                temperature: opts.temperature,
                num_predict: opts.maxTokens,
            },
        });
        if (resp.status >= 400) {
            throw new Error(`Ollama error ${resp.status}: ${resp.body}`);
        }
        const data = JSON.parse(resp.body);
        return {
            content: data.message.content,
            tokens: data.eval_count,
        };
    }
    async *stream(opts) {
        yield* streamJson(`${this.baseUrl}/api/chat`, {}, {
            model: opts.model,
            messages: opts.messages,
            stream: true,
            options: {
                temperature: opts.temperature,
                num_predict: opts.maxTokens,
            },
        }, (line) => {
            if (!line)
                return null;
            try {
                const parsed = JSON.parse(line);
                if (parsed.done)
                    return null;
                return parsed.message?.content ?? null;
            }
            catch {
                return null;
            }
        });
    }
}
//# sourceMappingURL=llm-client.js.map
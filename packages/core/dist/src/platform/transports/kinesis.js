// src/platform/transports/kinesis.ts
// AWS Kinesis StreamTransport: PutRecord to publish, GetRecords polling to
// consume. Uses SigV4 over node:https (no AWS SDK).
import { request as httpsRequest } from 'node:https';
import { createHash, randomBytes } from 'node:crypto';
import { signAwsV4 } from '../../enterprise/storage-adapters.js';
function post(host, headers, body) {
    return new Promise((resolve, reject) => {
        const req = httpsRequest({ method: 'POST', hostname: host, path: '/', headers }, (res) => {
            const chunks = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }));
            res.on('error', reject);
        });
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}
export class KinesisStreamTransport {
    opts;
    host;
    constructor(opts) {
        this.opts = opts;
        this.host = `kinesis.${opts.region}.amazonaws.com`;
    }
    async _call(target, payload) {
        const body = Buffer.from(JSON.stringify(payload), 'utf8');
        const headers = signAwsV4({
            method: 'POST', host: this.host, path: '/', region: this.opts.region, service: 'kinesis',
            accessKeyId: this.opts.accessKeyId, secretAccessKey: this.opts.secretAccessKey,
            payloadHash: createHash('sha256').update(body).digest('hex'),
            extraHeaders: { 'content-type': 'application/x-amz-json-1.1', 'x-amz-target': `Kinesis_20131202.${target}` },
        });
        return post(this.host, { ...headers, 'content-length': String(body.length) }, body);
    }
    async publish(topic, payload) {
        const data = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
        const res = await this._call('PutRecord', {
            StreamName: topic,
            Data: data,
            PartitionKey: randomBytes(8).toString('hex'),
        });
        if (res.status < 200 || res.status >= 300) {
            throw new Error(`Kinesis PutRecord failed (${res.status}): ${res.body.slice(0, 256)}`);
        }
    }
    subscribe(topic, _groupId, handler) {
        let stopped = false;
        let timer = null;
        const interval = this.opts.pollIntervalMs ?? 1000;
        const run = async () => {
            // Get a shard iterator for the first shard, then poll.
            const desc = await this._call('DescribeStream', { StreamName: topic });
            const shardId = JSON.parse(desc.body)
                .StreamDescription?.Shards?.[0]?.ShardId;
            if (!shardId)
                return;
            const iterRes = await this._call('GetShardIterator', { StreamName: topic, ShardId: shardId, ShardIteratorType: 'LATEST' });
            let iterator = JSON.parse(iterRes.body).ShardIterator;
            const poll = async () => {
                if (stopped || !iterator)
                    return;
                try {
                    const res = await this._call('GetRecords', { ShardIterator: iterator });
                    const parsed = JSON.parse(res.body);
                    iterator = parsed.NextShardIterator;
                    for (const rec of parsed.Records ?? []) {
                        try {
                            await handler(JSON.parse(Buffer.from(rec.Data, 'base64').toString('utf8')));
                        }
                        catch { /* skip malformed record */ }
                    }
                }
                catch { /* transient error; retry next tick */ }
                if (!stopped) {
                    timer = setTimeout(() => void poll(), interval);
                    timer.unref();
                }
            };
            void poll();
        };
        void run();
        return () => { stopped = true; if (timer)
            clearTimeout(timer); };
    }
}
//# sourceMappingURL=kinesis.js.map
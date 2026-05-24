import { Transform, type TransformCallback } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { IncomingMessage } from 'node:http';
export interface ParsedFile {
    fieldName: string;
    originalName: string;
    mimeType: string;
    size: number;
    path: string;
    encoding: string;
}
export interface MultipartResult {
    fields: Record<string, string>;
    files: ParsedFile[];
}
export declare class MultipartParser {
    private readonly boundary;
    private readonly uploadsDir;
    private readonly maxBytes;
    constructor(boundary: string, uploadsDir: string, maxBytes: number);
    parse(req: IncomingMessage): Promise<MultipartResult>;
    private _tryParsePart;
}
/** Streaming passthrough transformer that enforces a byte cap */
export declare class BoundedTransform extends Transform {
    private readonly maxBytes;
    private received;
    constructor(maxBytes: number);
    _transform(chunk: Buffer, _enc: BufferEncoding, cb: TransformCallback): void;
}
export { pipeline as streamPipeline };
//# sourceMappingURL=parser.d.ts.map
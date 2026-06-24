// packages/core/tests/helpers/plugin-archive.ts
// TEST-ONLY helper (excluded from the published `dist` via tsconfig.lib.json).
//
// In-memory USTAR tar synthesis + gzip, plus adversarial and well-formed entry
// builders used by the plugin-installer-hardening test suite. Lets a test
// produce the exact same archive raw and gzip-compressed (Req 3.3) and craft
// the zip-slip / link fixtures that drive PS-1 (`_extractTarball`).
//
// Built only on node:zlib + node:buffer — no third-party dependency.

import { gzipSync } from 'node:zlib';

/** USTAR type-flags recognized by the installer's extractor and these helpers. */
export type TarTypeFlag =
  | '0' // regular file
  | '5' // directory
  | '1' // hardlink
  | '2'; // symlink

/** A single tar entry to synthesize. `data` applies to file (`'0'`) entries; */
export interface TarEntry {
  name: string;
  typeFlag: TarTypeFlag;
  /** File contents for `'0'` entries. Ignored for dir/link entries. */
  data?: Buffer | string;
  /** Link target written into the header `linkname` field for `'1'`/`'2'`. */
  linkname?: string;
}

const BLOCK = 512;

/** Write a UTF-8 string into `block` at `offset`, truncated to `length` bytes. */
function writeString(block: Buffer, str: string, offset: number, length: number): void {
  block.write(str, offset, length, 'utf8');
}

/**
 * Write `value` as a NUL-terminated octal numeric field of `length` bytes
 * (length-1 zero-padded octal digits + a trailing NUL), as USTAR requires for
 * the size/mode/uid/gid/mtime fields.
 */
function writeOctal(block: Buffer, value: number, offset: number, length: number): void {
  const digits = length - 1;
  const s = value.toString(8).padStart(digits, '0');
  block.write(s, offset, digits, 'ascii');
  block[offset + digits] = 0;
}

/** Build one 512-byte USTAR header block for `entry` with the given body size. */
function makeHeader(entry: TarEntry, size: number): Buffer {
  const h = Buffer.alloc(BLOCK, 0);

  writeString(h, entry.name, 0, 100); // name
  writeOctal(h, 0o644, 100, 8); // mode
  writeOctal(h, 0, 108, 8); // uid
  writeOctal(h, 0, 116, 8); // gid
  writeOctal(h, size, 124, 12); // size  (offset 124)
  writeOctal(h, 0, 136, 12); // mtime

  // Checksum field is treated as 8 spaces while the checksum is computed.
  h.fill(0x20, 148, 156);

  h[156] = entry.typeFlag.charCodeAt(0); // typeflag (offset 156)
  if (entry.linkname) writeString(h, entry.linkname, 157, 100); // linkname

  h.write('ustar\0', 257, 6, 'ascii'); // magic
  h.write('00', 263, 2, 'ascii'); // version

  // Compute the header checksum (sum of all 512 bytes with the checksum field
  // counted as spaces), then write it as 6 octal digits + NUL + space.
  let sum = 0;
  for (let i = 0; i < BLOCK; i++) sum += h[i];
  h.write(sum.toString(8).padStart(6, '0'), 148, 6, 'ascii');
  h[154] = 0; // NUL
  h[155] = 0x20; // space

  return h;
}

/**
 * Synthesize a valid USTAR tar buffer from `entries`, with correct octal `size`
 * at offset 124, `typeFlag` at offset 156, and the two trailing zero blocks.
 */
export function makeTar(entries: TarEntry[]): Buffer {
  const blocks: Buffer[] = [];

  for (const entry of entries) {
    const data =
      entry.data === undefined
        ? Buffer.alloc(0)
        : Buffer.isBuffer(entry.data)
          ? entry.data
          : Buffer.from(entry.data, 'utf8');
    // Only regular files carry a body; dir/link entries have size 0.
    const size = entry.typeFlag === '0' ? data.length : 0;

    blocks.push(makeHeader(entry, size));

    if (size > 0) {
      const padded = Buffer.alloc(Math.ceil(size / BLOCK) * BLOCK, 0);
      data.copy(padded);
      blocks.push(padded);
    }
  }

  // Two trailing 512-byte zero blocks mark end-of-archive.
  blocks.push(Buffer.alloc(BLOCK, 0));
  blocks.push(Buffer.alloc(BLOCK, 0));

  return Buffer.concat(blocks);
}

/** gzip-compress a buffer so the same archive can be served raw or compressed. */
export function gzip(buf: Buffer): Buffer {
  return gzipSync(buf);
}

// ── Entry builders (well-formed in-containment) ──────────────────────────────

/** A well-formed in-containment regular file entry (`typeFlag '0'`). */
export function fileEntry(name: string, data: Buffer | string = ''): TarEntry {
  return { name, typeFlag: '0', data };
}

/** A well-formed in-containment directory entry (`typeFlag '5'`). */
export function dirEntry(name: string): TarEntry {
  return { name, typeFlag: '5' };
}

/** A file entry whose name carries a single leading `./` (must still extract). */
export function dotSlashFileEntry(name = 'lib/index.js', data: Buffer | string = 'ok'): TarEntry {
  return { name: `./${name}`, typeFlag: '0', data };
}

/** A file entry whose name carries a single leading `/` (must still extract). */
export function slashFileEntry(name = 'lib/index.js', data: Buffer | string = 'ok'): TarEntry {
  return { name: `/${name}`, typeFlag: '0', data };
}

// ── Adversarial entry builders (drive PS-1) ──────────────────────────────────

/** A `..`-traversal file entry, e.g. `../../evil.txt` → escapes `destDir`. */
export function traversalEntry(name = '../../evil.txt', data: Buffer | string = 'pwned'): TarEntry {
  return { name, typeFlag: '0', data };
}

/** An absolute-path file entry whose target lies outside `destDir`. */
export function absoluteEntry(name = '/tmp/streetjs-evil-absolute.txt', data: Buffer | string = 'pwned'): TarEntry {
  return { name, typeFlag: '0', data };
}

/** A symlink entry (`typeFlag '2'`) pointing at an out-of-tree target. */
export function symlinkEntry(name = 'link', linkname = '/etc/passwd'): TarEntry {
  return { name, typeFlag: '2', linkname };
}

/** A hardlink entry (`typeFlag '1'`) referencing another archive member. */
export function hardlinkEntry(name = 'hard', linkname = 'target'): TarEntry {
  return { name, typeFlag: '1', linkname };
}

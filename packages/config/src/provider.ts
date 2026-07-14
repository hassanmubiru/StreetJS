// packages/config/src/provider.ts
// Configuration sources. A Provider yields a nested PlainObject; the loader
// merges providers by precedence, then validates against the schema.
//
// Built-in providers: environment variables, in-memory object, and JSON / YAML /
// TOML files. Parsers are dependency-free and cover a documented configuration
// subset (see README "Supported file syntax"). The Provider interface lets any
// application add new sources without modifying this package.

import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { ConfigParseError } from './errors.js';
import type { ConfigInput, PlainObject } from './types.js';

/** A configuration source. `load()` returns a nested object (sync or async). */
export interface Provider {
  /** Stable identifier used in metadata and errors, e.g. `env`, `json:app.json`. */
  readonly name: string;
  /** Read and parse the source into a nested object. */
  load(): PlainObject | Promise<PlainObject>;
}

// ── object provider ───────────────────────────────────────────────────────────

/** Wrap an in-memory object as the highest-fidelity source (e.g. programmatic overrides). */
export function objectProvider(data: PlainObject, name = 'object'): Provider {
  return { name, load: () => data };
}

// ── environment provider ────────────────────────────────────────────────────────

export interface EnvProviderOptions {
  /** Source env map. Default `process.env`. */
  readonly env?: NodeJS.ProcessEnv;
  /** Only consider variables starting with this prefix; the prefix is stripped. */
  readonly prefix?: string;
  /** Nesting delimiter within a variable name. Default `__` (double underscore). */
  readonly nestingDelimiter?: string;
  /** Explicit `ENV_NAME → "dotted.path"` overrides, applied on top of the convention. */
  readonly map?: Readonly<Record<string, string>>;
}

/**
 * Load configuration from environment variables.
 *
 * Convention: `PREFIX_DATABASE__POOL_SIZE` with prefix `PREFIX_` and delimiter
 * `__` maps to `database.poolSize` — segments are split on the delimiter and each
 * segment is camelCased (so `POOL_SIZE` → `poolSize`, matching camelCase schema
 * keys). An explicit `map` entry overrides the convention for that variable.
 */
export function envProvider(options: EnvProviderOptions = {}): Provider {
  const env = options.env ?? process.env;
  const prefix = options.prefix ?? '';
  const delimiter = options.nestingDelimiter ?? '__';
  const map = options.map ?? {};

  return {
    name: 'env',
    load(): PlainObject {
      const root: Record<string, ConfigInput> = {};
      for (const [rawName, rawValue] of Object.entries(env)) {
        if (rawValue === undefined) continue;
        let path: string[];
        if (map[rawName]) {
          path = map[rawName]!.split('.');
        } else {
          if (prefix && !rawName.startsWith(prefix)) continue;
          const stripped = prefix ? rawName.slice(prefix.length) : rawName;
          if (stripped === '') continue;
          path = stripped.split(delimiter).map(camelCase);
        }
        assignPath(root, path, rawValue);
      }
      return root as PlainObject;
    },
  };
}

function camelCase(segment: string): string {
  const parts = segment.toLowerCase().split(/[_-]/).filter(Boolean);
  if (parts.length === 0) return segment.toLowerCase();
  return parts[0]! + parts.slice(1).map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join('');
}

function assignPath(root: Record<string, ConfigInput>, path: string[], value: ConfigInput): void {
  let node = root;
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i]!;
    const next = node[key];
    if (next === undefined || next === null || typeof next !== 'object' || Array.isArray(next)) {
      const created: Record<string, ConfigInput> = {};
      node[key] = created;
      node = created;
    } else {
      node = next as Record<string, ConfigInput>;
    }
  }
  node[path[path.length - 1]!] = value;
}

// ── file providers ────────────────────────────────────────────────────────────

export interface FileProviderOptions {
  /** If true, a missing file yields `{}` instead of throwing. Default false. */
  readonly optional?: boolean;
}

async function readOptional(path: string, optional: boolean): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (optional && code === 'ENOENT') return null;
    throw e;
  }
}

export function jsonFileProvider(path: string, options: FileProviderOptions = {}): Provider {
  return {
    name: `json:${path}`,
    async load(): Promise<PlainObject> {
      const text = await readOptional(path, options.optional ?? false);
      if (text === null) return {};
      try {
        const parsed = JSON.parse(text) as unknown;
        return asObject(parsed);
      } catch (e) {
        throw new ConfigParseError({ provider: 'json', location: path }, (e as Error).message);
      }
    },
  };
}

export function yamlFileProvider(path: string, options: FileProviderOptions = {}): Provider {
  return {
    name: `yaml:${path}`,
    async load(): Promise<PlainObject> {
      const text = await readOptional(path, options.optional ?? false);
      if (text === null) return {};
      try {
        return asObject(parseYaml(text));
      } catch (e) {
        throw new ConfigParseError({ provider: 'yaml', location: path }, (e as Error).message);
      }
    },
  };
}

export function tomlFileProvider(path: string, options: FileProviderOptions = {}): Provider {
  return {
    name: `toml:${path}`,
    async load(): Promise<PlainObject> {
      const text = await readOptional(path, options.optional ?? false);
      if (text === null) return {};
      try {
        return asObject(parseToml(text));
      } catch (e) {
        throw new ConfigParseError({ provider: 'toml', location: path }, (e as Error).message);
      }
    },
  };
}

/** Dispatch to the right file provider by extension (`.json`/`.yaml`/`.yml`/`.toml`). */
export function fileProvider(path: string, options: FileProviderOptions = {}): Provider {
  const ext = extname(path).toLowerCase();
  switch (ext) {
    case '.json':
      return jsonFileProvider(path, options);
    case '.yaml':
    case '.yml':
      return yamlFileProvider(path, options);
    case '.toml':
      return tomlFileProvider(path, options);
    default:
      throw new ConfigParseError(
        { provider: 'file', location: path },
        `unsupported file extension "${ext}" (expected .json, .yaml, .yml, or .toml)`,
      );
  }
}

function asObject(v: unknown): PlainObject {
  if (v !== null && typeof v === 'object' && !Array.isArray(v)) return v as PlainObject;
  throw new Error('top-level configuration must be an object');
}

// ── JSON is native (JSON.parse) ─────────────────────────────────────────────────

// ── TOML subset parser ──────────────────────────────────────────────────────────
// Supports: comments, [tables] and [a.b.c] nesting, dotted keys, basic ("...")
// and literal ('...') strings, integers/floats (with underscores), booleans, and
// single-line arrays + inline tables. Not supported: [[array-of-tables]],
// multiline strings/arrays, and datetime literals.

export function parseToml(text: string): PlainObject {
  const root: Record<string, ConfigInput> = {};
  let current = root;
  const lines = text.split(/\r?\n/);

  for (let n = 0; n < lines.length; n++) {
    const line = stripComment(lines[n]!).trim();
    if (line === '') continue;

    if (line.startsWith('[[')) {
      throw new Error(`line ${n + 1}: arrays of tables ([[...]]) are not supported`);
    }
    if (line.startsWith('[')) {
      const end = line.indexOf(']');
      if (end === -1) throw new Error(`line ${n + 1}: unterminated table header`);
      const path = splitDottedKey(line.slice(1, end).trim());
      current = descend(root, path);
      continue;
    }

    const eq = findTopLevelEquals(line);
    if (eq === -1) throw new Error(`line ${n + 1}: expected key = value`);
    const keyPart = line.slice(0, eq).trim();
    const valuePart = line.slice(eq + 1).trim();
    const keyPath = splitDottedKey(keyPart);
    const target = descend(current, keyPath.slice(0, -1));
    const [value, rest] = parseTomlValue(valuePart, n + 1);
    if (rest.trim() !== '') throw new Error(`line ${n + 1}: trailing characters after value: "${rest.trim()}"`);
    target[keyPath[keyPath.length - 1]!] = value;
  }
  return root as PlainObject;
}

function descend(root: Record<string, ConfigInput>, path: string[]): Record<string, ConfigInput> {
  let node = root;
  for (const key of path) {
    const next = node[key];
    if (next === undefined) {
      const created: Record<string, ConfigInput> = {};
      node[key] = created;
      node = created;
    } else if (next !== null && typeof next === 'object' && !Array.isArray(next)) {
      node = next as Record<string, ConfigInput>;
    } else {
      throw new Error(`key "${key}" is already defined as a non-table value`);
    }
  }
  return node;
}

function splitDottedKey(key: string): string[] {
  const parts: string[] = [];
  let i = 0;
  while (i < key.length) {
    if (key[i] === '"' || key[i] === "'") {
      const quote = key[i]!;
      let j = i + 1;
      while (j < key.length && key[j] !== quote) j++;
      parts.push(key.slice(i + 1, j));
      i = j + 1;
      while (i < key.length && (key[i] === ' ' || key[i] === '.')) i++;
    } else {
      let j = i;
      while (j < key.length && key[j] !== '.') j++;
      const seg = key.slice(i, j).trim();
      if (seg === '') throw new Error(`empty key segment in "${key}"`);
      parts.push(seg);
      i = j + 1;
    }
  }
  if (parts.length === 0) throw new Error('empty key');
  return parts;
}

function findTopLevelEquals(line: string): number {
  let inStr: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (inStr) {
      if (c === inStr) inStr = null;
    } else if (c === '"' || c === "'") {
      inStr = c;
    } else if (c === '=') {
      return i;
    }
  }
  return -1;
}

/** Parse one TOML value from the start of `str`; returns [value, remainder]. */
function parseTomlValue(str: string, lineNo: number): [ConfigInput, string] {
  const s = str.trimStart();
  if (s === '') throw new Error(`line ${lineNo}: missing value`);
  const c = s[0]!;

  if (c === '"' || c === "'") {
    const [text, rest] = readTomlString(s, lineNo);
    return [text, rest];
  }
  if (c === '[') return parseTomlArray(s, lineNo);
  if (c === '{') return parseTomlInlineTable(s, lineNo);

  // scalar: read until a delimiter that ends the value in this context
  let i = 0;
  while (i < s.length && !',]}'.includes(s[i]!)) i++;
  const token = s.slice(0, i).trim();
  return [parseTomlScalar(token, lineNo), s.slice(i)];
}

function parseTomlScalar(token: string, lineNo: number): ConfigInput {
  if (token === 'true') return true;
  if (token === 'false') return false;
  const numeric = token.replace(/_/g, '');
  if (/^[+-]?\d+$/.test(numeric)) return parseInt(numeric, 10);
  if (/^[+-]?(\d+\.\d*|\.\d+|\d+)([eE][+-]?\d+)?$/.test(numeric) && /[.eE]/.test(numeric)) {
    return Number(numeric);
  }
  throw new Error(`line ${lineNo}: invalid value "${token}"`);
}

function readTomlString(s: string, lineNo: number): [string, string] {
  const quote = s[0]!;
  let i = 1;
  let out = '';
  const literal = quote === "'";
  while (i < s.length) {
    const c = s[i]!;
    if (c === quote) return [out, s.slice(i + 1)];
    if (!literal && c === '\\') {
      const next = s[i + 1];
      const map: Record<string, string> = { n: '\n', t: '\t', r: '\r', '"': '"', '\\': '\\', '0': '\0' };
      if (next === 'u') {
        out += String.fromCharCode(parseInt(s.slice(i + 2, i + 6), 16));
        i += 6;
        continue;
      }
      if (next !== undefined && map[next] !== undefined) {
        out += map[next];
        i += 2;
        continue;
      }
    }
    out += c;
    i++;
  }
  throw new Error(`line ${lineNo}: unterminated string`);
}

function parseTomlArray(s: string, lineNo: number): [ConfigInput[], string] {
  let rest = s.slice(1).trimStart();
  const arr: ConfigInput[] = [];
  if (rest.startsWith(']')) return [arr, rest.slice(1)];
  for (;;) {
    const [value, after] = parseTomlValue(rest, lineNo);
    arr.push(value);
    rest = after.trimStart();
    if (rest.startsWith(',')) {
      rest = rest.slice(1).trimStart();
      if (rest.startsWith(']')) return [arr, rest.slice(1)];
      continue;
    }
    if (rest.startsWith(']')) return [arr, rest.slice(1)];
    throw new Error(`line ${lineNo}: malformed array`);
  }
}

function parseTomlInlineTable(s: string, lineNo: number): [PlainObject, string] {
  let rest = s.slice(1).trimStart();
  const obj: Record<string, ConfigInput> = {};
  if (rest.startsWith('}')) return [obj, rest.slice(1)];
  for (;;) {
    const eq = findTopLevelEquals(rest);
    if (eq === -1) throw new Error(`line ${lineNo}: malformed inline table`);
    const key = splitDottedKey(rest.slice(0, eq).trim());
    const [value, after] = parseTomlValue(rest.slice(eq + 1), lineNo);
    descend(obj, key.slice(0, -1))[key[key.length - 1]!] = value;
    rest = after.trimStart();
    if (rest.startsWith(',')) {
      rest = rest.slice(1).trimStart();
      continue;
    }
    if (rest.startsWith('}')) return [obj as PlainObject, rest.slice(1)];
    throw new Error(`line ${lineNo}: malformed inline table`);
  }
}

function stripComment(line: string): string {
  let inStr: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (inStr) {
      if (c === inStr) inStr = null;
    } else if (c === '"' || c === "'") {
      inStr = c;
    } else if (c === '#') {
      return line.slice(0, i);
    }
  }
  return line;
}

// ── YAML subset parser ──────────────────────────────────────────────────────────
// Supports: comments, blank lines, `---` document start, indentation-based nested
// maps, block sequences (`- item`, including `- key: value` maps), scalars
// (string/number/bool/null), single/double-quoted strings, and inline flow
// arrays/objects of scalars (`[a, b]`, `{a: 1}`). Not supported: anchors/aliases,
// multiline block scalars (`|`, `>`), multiple documents, and complex keys.

interface YamlLine {
  readonly indent: number;
  readonly content: string;
  readonly lineNo: number;
}

export function parseYaml(text: string): PlainObject {
  const lines: YamlLine[] = [];
  const raw = text.split(/\r?\n/);
  for (let i = 0; i < raw.length; i++) {
    const stripped = stripYamlComment(raw[i]!);
    if (stripped.trim() === '' || stripped.trim() === '---') continue;
    const indent = stripped.length - stripped.trimStart().length;
    lines.push({ indent, content: stripped.trim(), lineNo: i + 1 });
  }
  const [value] = parseYamlBlock(lines, 0, 0);
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    if (lines.length === 0) return {};
    throw new Error('top-level YAML must be a mapping');
  }
  return value as PlainObject;
}

function parseYamlBlock(lines: YamlLine[], start: number, minIndent: number): [ConfigInput, number] {
  if (start >= lines.length) return [null, start];
  const first = lines[start]!;
  if (first.content.startsWith('- ') || first.content === '-') {
    return parseYamlSequence(lines, start, first.indent);
  }
  return parseYamlMapping(lines, start, first.indent, minIndent);
}

function parseYamlMapping(lines: YamlLine[], start: number, indent: number, _minIndent: number): [PlainObject, number] {
  const obj: Record<string, ConfigInput> = {};
  let i = start;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.indent < indent) break;
    if (line.indent > indent) throw new Error(`line ${line.lineNo}: unexpected indentation`);
    if (line.content.startsWith('- ') || line.content === '-') break;

    const colon = findYamlColon(line.content);
    if (colon === -1) throw new Error(`line ${line.lineNo}: expected "key: value"`);
    const key = unquoteYamlKey(line.content.slice(0, colon).trim());
    const valueText = line.content.slice(colon + 1).trim();
    i++;

    if (valueText === '') {
      // nested block at deeper indent (map or sequence), else null
      if (i < lines.length && lines[i]!.indent > indent) {
        const [nested, next] = parseYamlBlock(lines, i, indent + 1);
        obj[key] = nested;
        i = next;
      } else if (i < lines.length && lines[i]!.indent === indent && (lines[i]!.content.startsWith('- ') || lines[i]!.content === '-')) {
        // sequence at the same indent as the key (common YAML style)
        const [seq, next] = parseYamlSequence(lines, i, indent);
        obj[key] = seq;
        i = next;
      } else {
        obj[key] = null;
      }
    } else {
      obj[key] = parseYamlScalar(valueText, line.lineNo);
    }
  }
  return [obj as PlainObject, i];
}

function parseYamlSequence(lines: YamlLine[], start: number, indent: number): [ConfigInput[], number] {
  const arr: ConfigInput[] = [];
  let i = start;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.indent < indent) break;
    if (line.indent > indent) throw new Error(`line ${line.lineNo}: unexpected indentation in sequence`);
    if (!(line.content.startsWith('- ') || line.content === '-')) break;

    const itemText = line.content === '-' ? '' : line.content.slice(2).trim();
    i++;
    if (itemText === '') {
      if (i < lines.length && lines[i]!.indent > indent) {
        const [nested, next] = parseYamlBlock(lines, i, indent + 1);
        arr.push(nested);
        i = next;
      } else {
        arr.push(null);
      }
    } else if (findYamlColon(itemText) !== -1 && !itemText.startsWith('[') && !itemText.startsWith('{')) {
      // inline map entry starting a sequence item: "- key: value" (+ deeper keys)
      const synthetic: YamlLine[] = [{ indent: indent + 2, content: itemText, lineNo: line.lineNo }];
      let j = i;
      while (j < lines.length && lines[j]!.indent > indent) {
        synthetic.push(lines[j]!);
        j++;
      }
      const [obj] = parseYamlMapping(synthetic, 0, synthetic[0]!.indent, 0);
      arr.push(obj);
      i = j;
    } else {
      arr.push(parseYamlScalar(itemText, line.lineNo));
    }
  }
  return [arr, i];
}

function parseYamlScalar(text: string, lineNo: number): ConfigInput {
  if (text.startsWith('[') || text.startsWith('{')) return parseYamlFlow(text, lineNo);
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
    return unescapeYamlString(text);
  }
  if (text === 'null' || text === '~') return null;
  if (text === 'true' || text === 'True') return true;
  if (text === 'false' || text === 'False') return false;
  if (/^[+-]?\d+$/.test(text)) return parseInt(text, 10);
  if (/^[+-]?(\d+\.\d*|\.\d+|\d+)([eE][+-]?\d+)?$/.test(text) && /[.eE]/.test(text)) return Number(text);
  return text;
}

function parseYamlFlow(text: string, lineNo: number): ConfigInput {
  // Convert a JSON-ish flow collection to JSON and parse. Supports scalars,
  // quoted strings, and bare words (quoted here). Nested flow is supported.
  try {
    return JSON.parse(flowToJson(text)) as ConfigInput;
  } catch {
    throw new Error(`line ${lineNo}: malformed inline collection "${text}"`);
  }
}

function flowToJson(text: string): string {
  // Wrap bare (unquoted) tokens in double quotes so JSON.parse accepts them.
  let out = '';
  let i = 0;
  const isBoundary = (c: string): boolean => '[]{},:'.includes(c);
  while (i < text.length) {
    const c = text[i]!;
    if (c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') {
        if (text[j] === '\\') j++;
        j++;
      }
      out += text.slice(i, j + 1);
      i = j + 1;
    } else if (c === "'") {
      let j = i + 1;
      while (j < text.length && text[j] !== "'") j++;
      out += JSON.stringify(text.slice(i + 1, j));
      i = j + 1;
    } else if (isBoundary(c) || c === ' ') {
      out += c;
      i++;
    } else {
      let j = i;
      while (j < text.length && !isBoundary(text[j]!) && text[j] !== ' ') j++;
      const token = text.slice(i, j);
      if (/^[+-]?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(token) || token === 'true' || token === 'false' || token === 'null') {
        out += token;
      } else {
        out += JSON.stringify(token);
      }
      i = j;
    }
  }
  return out;
}

function unquoteYamlKey(key: string): string {
  if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) {
    return unescapeYamlString(key);
  }
  return key;
}

function unescapeYamlString(text: string): string {
  const quote = text[0]!;
  const inner = text.slice(1, -1);
  if (quote === "'") return inner.replace(/''/g, "'");
  return inner.replace(/\\(["\\/nrt]|u[0-9a-fA-F]{4})/g, (_m, esc: string) => {
    switch (esc[0]) {
      case 'n':
        return '\n';
      case 'r':
        return '\r';
      case 't':
        return '\t';
      case '"':
        return '"';
      case '\\':
        return '\\';
      case '/':
        return '/';
      case 'u':
        return String.fromCharCode(parseInt(esc.slice(1), 16));
      default:
        return esc;
    }
  });
}

function findYamlColon(content: string): number {
  let inStr: string | null = null;
  let depth = 0;
  for (let i = 0; i < content.length; i++) {
    const c = content[i]!;
    if (inStr) {
      if (c === inStr) inStr = null;
    } else if (c === '"' || c === "'") {
      inStr = c;
    } else if (c === '[' || c === '{') {
      depth++;
    } else if (c === ']' || c === '}') {
      depth--;
    } else if (c === ':' && depth === 0 && (i + 1 >= content.length || content[i + 1] === ' ')) {
      return i;
    }
  }
  return -1;
}

function stripYamlComment(line: string): string {
  let inStr: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (inStr) {
      if (c === inStr) inStr = null;
    } else if (c === '"' || c === "'") {
      inStr = c;
    } else if (c === '#' && (i === 0 || line[i - 1] === ' ' || line[i - 1] === '\t')) {
      return line.slice(0, i);
    }
  }
  return line;
}

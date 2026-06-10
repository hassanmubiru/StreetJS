// src/security/dast.ts
// DAST (Dynamic Application Security Testing) support, driven by the framework's
// generated OpenAPI spec. This module is the offline-verifiable core of the DAST
// pipeline: OpenAPI artifact validation, scan-target enumeration, an in-process
// OpenAPI conformance scanner, normalization of OWASP ZAP baseline reports into
// structured findings, and a severity-gated, deterministic pass/fail decision
// (the "fail the build on High/Critical" gate).
//
// The external scanners themselves (Schemathesis, OWASP ZAP) are invoked by the
// scripts in scripts/dast/ and the CI workflow; this module turns their output
// into a reproducible gate decision. Pure TS + node:http — no third-party deps.

import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';

import type { VerificationArtifact } from '../verification/artifact.js';
import { classify } from '../verification/status.js';
import type { EvidenceComponents, BlockedReason } from '../verification/status.js';

export type DastSeverity = 'info' | 'low' | 'medium' | 'high' | 'critical';

const SEVERITY_RANK: Record<DastSeverity, number> = {
  info: 0, low: 1, medium: 2, high: 3, critical: 4,
};

export interface DastFinding {
  tool: string;
  name: string;
  severity: DastSeverity;
  url?: string;
  description?: string;
}

// ── OpenAPI artifact validation & target enumeration ─────────────────────────

export interface OpenApiValidationResult { valid: boolean; errors: string[]; }

/**
 * Structurally validate an OpenAPI 3.x document well enough to drive a DAST
 * scanner: must declare `openapi: 3.x`, an `info` object with title+version,
 * and a `paths` object whose entries map HTTP methods to operation objects.
 */
export function validateOpenApiDocument(doc: unknown): OpenApiValidationResult {
  const errors: string[] = [];
  const d = doc as Record<string, unknown> | null;
  if (typeof d !== 'object' || d === null) {
    return { valid: false, errors: ['document is not an object'] };
  }
  if (typeof d['openapi'] !== 'string' || !/^3\./.test(d['openapi'] as string)) {
    errors.push('missing or unsupported "openapi" version (expected 3.x)');
  }
  const info = d['info'] as Record<string, unknown> | undefined;
  if (!info || typeof info['title'] !== 'string' || typeof info['version'] !== 'string') {
    errors.push('"info" must include string "title" and "version"');
  }
  const paths = d['paths'] as Record<string, unknown> | undefined;
  if (!paths || typeof paths !== 'object') {
    errors.push('"paths" object is required');
  } else if (Object.keys(paths).length === 0) {
    errors.push('"paths" must declare at least one path');
  } else {
    for (const [p, item] of Object.entries(paths)) {
      if (!p.startsWith('/')) errors.push(`path "${p}" must start with "/"`);
      if (typeof item !== 'object' || item === null) errors.push(`path item "${p}" must be an object`);
    }
  }
  return { valid: errors.length === 0, errors };
}

const HTTP_METHODS = new Set(['get', 'put', 'post', 'delete', 'patch', 'head', 'options', 'trace']);

export interface OpenApiOperationTarget { method: string; path: string; }

/** Enumerate the (method, path) operations a scanner should exercise. */
export function openApiOperations(doc: unknown): OpenApiOperationTarget[] {
  const out: OpenApiOperationTarget[] = [];
  const paths = (doc as { paths?: Record<string, Record<string, unknown>> })?.paths;
  if (!paths) return out;
  for (const [path, item] of Object.entries(paths)) {
    for (const method of Object.keys(item)) {
      if (HTTP_METHODS.has(method.toLowerCase())) {
        out.push({ method: method.toUpperCase(), path });
      }
    }
  }
  return out;
}

// ── In-process OpenAPI conformance scanner ───────────────────────────────────

export interface ConformanceScanOptions {
  /** Base URL of the running target, e.g. 'http://127.0.0.1:8080'. */
  baseUrl: string;
  /** HTTP methods to exercise. Default ['GET'] (no request-body synthesis). */
  methods?: string[];
  /** Optional bearer token for authenticated scans. */
  token?: string;
  /** Value substituted for path params like {id}. Default 'dast-probe'. */
  pathParamValue?: string;
  /** Per-request timeout (ms). Default 5000. */
  timeoutMs?: number;
}

interface ProbeResult { status: number; error?: string; }

function probe(method: string, url: string, token: string | undefined, timeoutMs: number): Promise<ProbeResult> {
  return new Promise((resolve) => {
    let u: URL;
    try { u = new URL(url); } catch { resolve({ status: 0, error: 'invalid_url' }); return; }
    const lib = u.protocol === 'https:' ? httpsRequest : httpRequest;
    const headers: Record<string, string> = token ? { authorization: `Bearer ${token}` } : {};
    const req = lib(
      { method, hostname: u.hostname, port: u.port, path: u.pathname + u.search, headers },
      (res) => { res.resume(); res.once('end', () => resolve({ status: res.statusCode ?? 0 })); },
    );
    req.setTimeout(timeoutMs, () => { req.destroy(); resolve({ status: 0, error: 'timeout' }); });
    req.once('error', (e) => resolve({ status: 0, error: e.message }));
    req.end();
  });
}

/**
 * Exercise every enumerated OpenAPI operation against a live target and report
 * security/robustness findings: a 5xx response or a connection failure is a
 * High finding (the server crashed or errored on a well-formed request derived
 * from its own contract). Runs in-process with no external tooling — the
 * offline counterpart to a Schemathesis scan. Combine with {@link evaluateDastGate}.
 */
export async function openApiConformanceScan(doc: unknown, opts: ConformanceScanOptions): Promise<DastFinding[]> {
  const methods = new Set((opts.methods ?? ['GET']).map((m) => m.toUpperCase()));
  const paramVal = opts.pathParamValue ?? 'dast-probe';
  const timeoutMs = opts.timeoutMs ?? 5000;
  const base = opts.baseUrl.replace(/\/$/, '');
  const findings: DastFinding[] = [];

  for (const op of openApiOperations(doc)) {
    if (!methods.has(op.method)) continue;
    const concretePath = op.path.replace(/\{[^}]+\}/g, encodeURIComponent(paramVal));
    const url = `${base}${concretePath}`;
    const r = await probe(op.method, url, opts.token, timeoutMs);
    if (r.status >= 500) {
      findings.push({ tool: 'openapi-conformance', name: `Server error (${r.status})`, severity: 'high', url, description: `${op.method} ${op.path} returned ${r.status}` });
    } else if (r.status === 0) {
      findings.push({ tool: 'openapi-conformance', name: 'Request failed', severity: 'high', url, description: `${op.method} ${op.path}: ${r.error ?? 'no response'}` });
    }
  }
  return findings;
}

// ── OWASP ZAP baseline report normalization ──────────────────────────────────

/** ZAP riskcode → DAST severity. ZAP: 0 info, 1 low, 2 medium, 3 high. */
function zapRiskToSeverity(riskcode: string | number): DastSeverity {
  switch (Number(riskcode)) {
    case 3: return 'high';
    case 2: return 'medium';
    case 1: return 'low';
    default: return 'info';
  }
}

interface ZapAlert {
  name?: string;
  alert?: string;
  riskcode?: string | number;
  desc?: string;
  instances?: Array<{ uri?: string }>;
}
interface ZapSite { '@name'?: string; alerts?: ZapAlert[]; }
interface ZapReport { site?: ZapSite[]; }

/**
 * Parse an OWASP ZAP baseline JSON report into normalized findings, expanding
 * each alert's instances into individual URL-scoped findings.
 */
export function parseZapReport(report: unknown): DastFinding[] {
  const findings: DastFinding[] = [];
  const sites = (report as ZapReport)?.site ?? [];
  for (const site of sites) {
    for (const alert of site.alerts ?? []) {
      const severity = zapRiskToSeverity(alert.riskcode ?? 0);
      const name = alert.name ?? alert.alert ?? 'unknown';
      const instances = alert.instances && alert.instances.length > 0 ? alert.instances : [{ uri: undefined }];
      for (const inst of instances) {
        findings.push({
          tool: 'owasp-zap', name, severity,
          ...(inst.uri ? { url: inst.uri } : {}),
          ...(alert.desc ? { description: alert.desc } : {}),
        });
      }
    }
  }
  return findings;
}

// ── Severity gate (deterministic pass/fail + exit code) ──────────────────────

export interface DastGateOptions {
  /** Minimum severity that fails the gate. Default 'high'. */
  failOn?: DastSeverity;
}

export interface DastGateResult {
  passed: boolean;
  /** Deterministic process exit code: 0 pass, 2 fail. */
  exitCode: number;
  failOn: DastSeverity;
  counts: Record<DastSeverity, number>;
  offending: DastFinding[];
}

/** Count findings by severity. */
export function summarizeFindings(findings: DastFinding[]): Record<DastSeverity, number> {
  const counts: Record<DastSeverity, number> = { info: 0, low: 0, medium: 0, high: 0, critical: 0 };
  for (const f of findings) counts[f.severity]++;
  return counts;
}

/**
 * Evaluate the DAST gate: fail (exit code 2) if any finding is at or above the
 * `failOn` severity (default 'high'); otherwise pass (exit code 0).
 */
export function evaluateDastGate(findings: DastFinding[], opts: DastGateOptions = {}): DastGateResult {
  const failOn = opts.failOn ?? 'high';
  const threshold = SEVERITY_RANK[failOn];
  const offending = findings.filter((f) => SEVERITY_RANK[f.severity] >= threshold);
  const passed = offending.length === 0;
  return {
    passed,
    exitCode: passed ? 0 : 2,
    failOn,
    counts: summarizeFindings(findings),
    offending,
  };
}

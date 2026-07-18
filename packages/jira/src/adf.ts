// src/adf.ts
// Minimal Atlassian Document Format (ADF) helpers.
//
// Jira Cloud REST API v3 expects rich-text fields (description, comment body)
// as ADF documents rather than plain strings. `textToAdf` wraps plain text into
// the smallest valid ADF document (one paragraph per line).

/** An ADF document node (loosely typed; only what we emit is modeled). */
export interface AdfDocument {
  type: 'doc';
  version: 1;
  content: AdfNode[];
}

export interface AdfNode {
  type: string;
  content?: AdfNode[];
  text?: string;
  [key: string]: unknown;
}

/**
 * Wrap plain text into a minimal ADF document. Each newline-separated line
 * becomes its own paragraph; empty lines become empty paragraphs (blank lines).
 */
export function textToAdf(text: string): AdfDocument {
  const lines = text.split('\n');
  const content: AdfNode[] = lines.map((line) =>
    line.length === 0
      ? { type: 'paragraph' }
      : { type: 'paragraph', content: [{ type: 'text', text: line }] },
  );
  return { type: 'doc', version: 1, content };
}

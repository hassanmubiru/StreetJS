/**
 * Runnable example: `node dist/examples/integration.js`
 *
 * Sanitizes a hostile request body and escapes a value for HTML output.
 */

import { sanitizeString, sanitizeDeep, escapeHtml } from '../index.js';

function main(): void {
  const hostile = {
    name: '<script>steal()</script>',
    bio: 'Click <a href="javascript:evil()">here</a>',
    website: 'javascript:alert(1)',
    tags: ['<img onerror=hack() src=x>', 'normal'],
    age: 30,
  };

  const clean = sanitizeDeep(hostile);
  process.stdout.write('sanitized body:\n' + JSON.stringify(clean, null, 2) + '\n');

  process.stdout.write('\nsanitizeString: ' + sanitizeString('<b onclick=x()>hi</b>') + '\n');
  process.stdout.write('escapeHtml:     ' + escapeHtml('<b>Tom & "Jerry"</b>') + '\n');
}

main();

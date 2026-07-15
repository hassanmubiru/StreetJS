/**
 * Runnable example: `node dist/examples/integration.js`
 *
 * Demonstrates the wire-protocol message builders and the streaming result
 * reader without needing a live server. (Connecting with `PgConnection.connect`
 * / `PgHaClient` requires a real PostgreSQL endpoint.)
 */

import { StreetPostgresWireStream } from '../index.js';
import { buildParseMessage, buildBindMessage } from '../wire.js';

async function main(): Promise<void> {
  // The extended-query protocol builders produce well-formed frames.
  const parse = buildParseMessage('SELECT * FROM users WHERE id = $1');
  const bind = buildBindMessage([7]);
  process.stdout.write(
    `Parse frame: type=0x${parse[0].toString(16)} len=${parse.length}; ` +
      `Bind frame: type=0x${bind[0].toString(16)} len=${bind.length}\n`,
  );

  // The streaming result reader delivers rows as they are parsed.
  const stream = new StreetPostgresWireStream();
  const rows: unknown[] = [];
  stream.on('data', (r: unknown) => rows.push(r));
  stream.pushRow({ id: '1', name: 'Ada' });
  stream.pushRow({ id: '2', name: 'Bob' });
  stream.finalize();
  await new Promise<void>((resolve) => stream.on('end', resolve));
  process.stdout.write(`streamed ${rows.length} rows: ${JSON.stringify(rows)}\n`);

  process.stdout.write(
    '\nConnect to a live database with:\n' +
      "  const conn = await PgConnection.connect({ host, port: 5432, user, password, database });\n" +
      "  const ha = new PgHaClient({ hosts: [...], user, password, database });\n",
  );
}

void main();

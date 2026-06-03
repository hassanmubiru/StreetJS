// src/database/mysql/mariadb.ts
// MariaDbConnection — a MysqlConnection subclass for MariaDB servers.
// MysqlConnection.connect() detects a MariaDB greeting and returns this type.

import { MysqlConnection, type MysqlConnectOptions } from './wire.js';

/**
 * MariaDB-specific connection subclass.
 *
 * MariaDB is highly compatible with MySQL at the wire-protocol level.
 * This subclass exists to allow users and framework code to distinguish
 * between a MySQL and a MariaDB server at runtime (e.g. for feature-detection
 * or dialect-specific SQL generation).
 *
 * All query / stream / close methods are inherited from {@link MysqlConnection}.
 * The server version string from the greeting is available via `.serverVersion`.
 */
export class MariaDbConnection extends MysqlConnection {
  /**
   * Connect to a MariaDB server and return a {@link MariaDbConnection}.
   * If the server turns out to be plain MySQL, the method still returns
   * a `MariaDbConnection` — callers should use the static
   * {@link MysqlConnection.connect} factory if they want automatic
   * subclass selection.
   */
  static override async connect(opts: MysqlConnectOptions): Promise<MariaDbConnection> {
    const conn = new MariaDbConnection();
    await conn._connect(opts);
    return conn;
  }
}

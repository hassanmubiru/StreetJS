// src/database/query-builder.ts
// Type-safe, dialect-aware SQL query builder.

// ── Dialect ───────────────────────────────────────────────────────────────────

/** SQL dialects supported by QueryBuilder. */
export enum SqlDialect {
  postgres = 'postgres',
  mysql    = 'mysql',
  sqlite   = 'sqlite',
}

// ── Internal AST node types ───────────────────────────────────────────────────

interface WhereClause {
  /** Raw SQL fragment (placeholders already substituted with $n / ?). */
  sql: string;
  params: unknown[];
}

interface JoinClause {
  type: 'INNER' | 'LEFT';
  table: string;
  condition: string;
}

interface OrderByClause {
  col: string;
  dir: 'ASC' | 'DESC';
}

interface HavingClause {
  sql: string;
  params: unknown[];
}

// ── QueryBuilder ──────────────────────────────────────────────────────────────

/**
 * Fluent, compile-time-safe SQL query builder.
 *
 * @typeParam T - Shape of the primary table being queried.
 *               `keyof T & string` is used to constrain column names passed
 *               to `select()`, `where()`, `orderBy()`, and `groupBy()`.
 *
 * @example
 * ```ts
 * interface User { id: number; name: string; email: string }
 *
 * const { sql, params } = new QueryBuilder<User>()
 *   .select('id', 'name')
 *   .from('users')
 *   .where('email', '=', 'alice@example.com')
 *   .limit(10)
 *   .build();
 * // sql  → 'SELECT id, name FROM users WHERE email = $1 LIMIT 10'
 * // params → ['alice@example.com']
 * ```
 */
export class QueryBuilder<T extends object> {
  // ── AST state ────────────────────────────────────────────────────────────

  private readonly _selects:  string[]       = [];
  private readonly _wheres:   WhereClause[]  = [];
  private readonly _joins:    JoinClause[]   = [];
  private readonly _orderBys: OrderByClause[] = [];
  private readonly _groupBys: string[]       = [];
  private readonly _havings:  HavingClause[] = [];
  private          _from:     string | null  = null;
  private          _limit:    number | null  = null;
  private          _offset:   number | null  = null;

  private readonly _dialect: SqlDialect;

  constructor(dialect: SqlDialect = SqlDialect.postgres) {
    this._dialect = dialect;
  }

  // ── Fluent API ────────────────────────────────────────────────────────────

  /** Specify columns to SELECT. Restricts to keys of T at compile-time. */
  select(...cols: (keyof T & string)[]): this {
    this._selects.push(...cols);
    return this;
  }

  /** Specify the primary table (FROM clause). */
  from(table: string): this {
    this._from = table;
    return this;
  }

  /**
   * Add a WHERE condition.
   *
   * Two overloads:
   *   1. `where(col, op, value)` – typed column name
   *   2. `where(rawCondition, ...values)` – raw SQL fragment
   */
  where(col: keyof T & string, op: string, value: unknown): this;
  where(rawCondition: string, ...values: unknown[]): this;
  where(colOrRaw: string, opOrFirstVal?: unknown, ...rest: unknown[]): this {
    // Heuristic: if opOrFirstVal is a string that looks like an operator and
    // rest has exactly 0 extra args, treat it as col/op/value; otherwise raw.
    if (
      typeof opOrFirstVal === 'string' &&
      rest.length === 0
    ) {
      // Ambiguous single-value overload – could be raw(condition, value) or
      // col(op) with no value.  Treat as raw with one param when
      // opOrFirstVal doesn't look like a binary SQL operator.
      const sqlOps = ['=', '!=', '<>', '<', '>', '<=', '>=', 'LIKE', 'ILIKE', 'IN', 'NOT IN', 'IS', 'IS NOT'];
      if (sqlOps.includes(opOrFirstVal.toUpperCase())) {
        // where(col, op) with no value — treat as raw condition
        this._wheres.push({ sql: `${colOrRaw} ${opOrFirstVal}`, params: [] });
        return this;
      }
      // where(rawCondition, singleValue)
      this._wheres.push({ sql: colOrRaw, params: [opOrFirstVal] });
      return this;
    }

    if (typeof opOrFirstVal === 'string' && rest.length >= 1) {
      // where(col, op, value[, ...extra]) — typed column form
      this._wheres.push({ sql: `${colOrRaw} ${opOrFirstVal} __PLACEHOLDER__`, params: [rest[0]] });
      return this;
    }

    if (opOrFirstVal === undefined && rest.length === 0) {
      // where(rawCondition) — no params
      this._wheres.push({ sql: colOrRaw, params: [] });
      return this;
    }

    // Fallback: raw condition with collected params
    const params: unknown[] = opOrFirstVal !== undefined ? [opOrFirstVal, ...rest] : [...rest];
    this._wheres.push({ sql: colOrRaw, params });
    return this;
  }

  /** Add an INNER JOIN. */
  join(table: string, condition: string): this {
    this._joins.push({ type: 'INNER', table, condition });
    return this;
  }

  /** Add a LEFT JOIN. */
  leftJoin(table: string, condition: string): this {
    this._joins.push({ type: 'LEFT', table, condition });
    return this;
  }

  /** Add an ORDER BY column. */
  orderBy(col: keyof T & string, dir: 'ASC' | 'DESC' = 'ASC'): this {
    this._orderBys.push({ col, dir });
    return this;
  }

  /** Add GROUP BY columns. */
  groupBy(...cols: (keyof T & string)[]): this {
    this._groupBys.push(...cols);
    return this;
  }

  /** Add a HAVING condition (raw SQL + params). */
  having(condition: string, ...values: unknown[]): this {
    this._havings.push({ sql: condition, params: values });
    return this;
  }

  /** Set LIMIT. */
  limit(n: number): this {
    this._limit = n;
    return this;
  }

  /** Set OFFSET. */
  offset(n: number): this {
    this._offset = n;
    return this;
  }

  /**
   * Embed a sub-query as a derived table.
   *
   * @param qb    - The inner QueryBuilder whose result is used as the table.
   * @param alias - The alias given to the derived table.
   */
  subquery<U extends object>(qb: QueryBuilder<U>, alias: string): this {
    const inner = qb.build();
    // Store as a special join-like entry via the _from slot if no FROM yet,
    // otherwise embed as a derived-table JOIN.
    if (this._from === null) {
      this._from = `(${inner.sql}) AS ${alias}`;
      // Merge params into a leading phantom where so they appear first
      if (inner.params.length > 0) {
        this._wheres.unshift({ sql: '__SUBQUERY_PARAMS__', params: inner.params });
      }
    } else {
      this._joins.push({
        type: 'INNER',
        table: `(${inner.sql}) AS ${alias}`,
        condition: '__SUBQUERY__',
      });
      if (inner.params.length > 0) {
        // Params must be interleaved correctly; store as a phantom where
        this._wheres.push({ sql: '__SUBQUERY_JOIN_PARAMS__', params: inner.params });
      }
    }
    return this;
  }

  // ── Build ─────────────────────────────────────────────────────────────────

  /**
   * Render the current AST to a SQL string + params array.
   * This method is idempotent: calling it multiple times on the same
   * (unmodified) builder always produces identical output.
   */
  build(): { sql: string; params: unknown[] } {
    const parts: string[] = [];
    const allParams: unknown[] = [];

    // Placeholder counter — only increments for postgres
    let paramIdx = 1;
    const placeholder = (): string =>
      this._dialect === SqlDialect.postgres ? `$${paramIdx++}` : '?';

    const addParam = (v: unknown): string => {
      allParams.push(v);
      return placeholder();
    };

    // ── SELECT ──────────────────────────────────────────────────────────────
    const selectList = this._selects.length > 0 ? this._selects.join(', ') : '*';
    parts.push(`SELECT ${selectList}`);

    // ── FROM ────────────────────────────────────────────────────────────────
    if (this._from !== null) {
      // Check if from is a subquery (starts with '(')
      if (this._from.startsWith('(')) {
        // Extract params from phantom where entries
        const subqueryParamEntry = this._wheres.find(
          (w) => w.sql === '__SUBQUERY_PARAMS__',
        );
        if (subqueryParamEntry) {
          const subSql = this._from;
          // Replace __PLACEHOLDER__ occurrences inside subSql with correct placeholders
          const renderedFrom = this._renderSubquerySql(subSql, subqueryParamEntry.params, addParam);
          parts.push(`FROM ${renderedFrom}`);
        } else {
          parts.push(`FROM ${this._from}`);
        }
      } else {
        parts.push(`FROM ${this._from}`);
      }
    }

    // ── JOINs ───────────────────────────────────────────────────────────────
    for (const j of this._joins) {
      if (j.condition === '__SUBQUERY__') {
        // Derived-table join — no ON clause
        const subqueryJoinEntry = this._wheres.find(
          (w) => w.sql === '__SUBQUERY_JOIN_PARAMS__',
        );
        if (subqueryJoinEntry) {
          const renderedTable = this._renderSubquerySql(
            j.table,
            subqueryJoinEntry.params,
            addParam,
          );
          parts.push(`${j.type} JOIN ${renderedTable}`);
        } else {
          parts.push(`${j.type} JOIN ${j.table}`);
        }
      } else {
        parts.push(`${j.type} JOIN ${j.table} ON ${j.condition}`);
      }
    }

    // ── WHERE ───────────────────────────────────────────────────────────────
    const realWheres = this._wheres.filter(
      (w) =>
        w.sql !== '__SUBQUERY_PARAMS__' &&
        w.sql !== '__SUBQUERY_JOIN_PARAMS__',
    );
    if (realWheres.length > 0) {
      const conditions = realWheres.map((w) => {
        let sql = w.sql;
        for (const p of w.params) {
          sql = sql.replace('__PLACEHOLDER__', addParam(p));
        }
        // If no __PLACEHOLDER__ tokens but params exist, append placeholders
        // (raw condition with positional params)
        if (!sql.includes('__PLACEHOLDER__')) {
          // params already consumed above for __PLACEHOLDER__, handle raw case
          // where params were added via fallback path
          for (let i = 0; i < w.params.length - (w.params.length); i++) {
            sql += ` ${addParam(w.params[i])}`;
          }
        }
        return sql;
      });
      parts.push(`WHERE ${conditions.join(' AND ')}`);
    }

    // ── GROUP BY ────────────────────────────────────────────────────────────
    if (this._groupBys.length > 0) {
      parts.push(`GROUP BY ${this._groupBys.join(', ')}`);
    }

    // ── HAVING ──────────────────────────────────────────────────────────────
    if (this._havings.length > 0) {
      const havingClauses = this._havings.map((h) => {
        let sql = h.sql;
        for (const p of h.params) {
          sql = sql.replace('?', addParam(p)).replace(/\$\d+/, addParam(p));
        }
        return sql;
      });
      parts.push(`HAVING ${havingClauses.join(' AND ')}`);
    }

    // ── ORDER BY ────────────────────────────────────────────────────────────
    if (this._orderBys.length > 0) {
      const orderClauses = this._orderBys.map((o) => `${o.col} ${o.dir}`);
      parts.push(`ORDER BY ${orderClauses.join(', ')}`);
    }

    // ── LIMIT / OFFSET ──────────────────────────────────────────────────────
    if (this._limit !== null) {
      parts.push(`LIMIT ${this._limit}`);
    }
    if (this._offset !== null) {
      parts.push(`OFFSET ${this._offset}`);
    }

    return { sql: parts.join(' '), params: allParams };
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  /**
   * Replace `__PLACEHOLDER__` tokens (and bare `?` or `$n` style markers)
   * in a subquery-derived SQL fragment with fresh placeholders from the
   * current build context.
   */
  private _renderSubquerySql(
    sql: string,
    params: unknown[],
    addParam: (v: unknown) => string,
  ): string {
    let result = sql;
    for (const p of params) {
      // Replace the first `$<digits>` or `?` placeholder with a fresh one
      result = result.replace(/\$\d+|\?/, addParam(p));
    }
    return result;
  }
}

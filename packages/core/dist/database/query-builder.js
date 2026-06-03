// src/database/query-builder.ts
// Type-safe, dialect-aware SQL query builder.
// ── Dialect ───────────────────────────────────────────────────────────────────
/** SQL dialects supported by QueryBuilder. */
export var SqlDialect;
(function (SqlDialect) {
    SqlDialect["postgres"] = "postgres";
    SqlDialect["mysql"] = "mysql";
    SqlDialect["sqlite"] = "sqlite";
})(SqlDialect || (SqlDialect = {}));
// ── QueryBuilder ──────────────────────────────────────────────────────────────
/**
 * Fluent, compile-time-safe SQL query builder.
 *
 * @typeParam T - Shape of the primary table being queried.
 *               `keyof T & string` restricts column arguments to actual table
 *               columns at compile time.
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
 * // sql    → 'SELECT id, name FROM users WHERE email = $1 LIMIT 10'
 * // params → ['alice@example.com']
 * ```
 */
export class QueryBuilder {
    // ── AST state ─────────────────────────────────────────────────────────────
    /** Columns listed in SELECT. */
    selects = [];
    /** WHERE conditions (each holds a '?'-parameterised SQL fragment). */
    wheres = [];
    /** JOIN clauses. */
    joins = [];
    /** ORDER BY entries. */
    orderBys = [];
    /** GROUP BY columns. */
    groupBys = [];
    /** HAVING conditions. */
    havings = [];
    /** FROM clause (table name or derived-table expression). */
    _from = null;
    /** LIMIT value. */
    _limit = null;
    /** OFFSET value. */
    _offset = null;
    dialect;
    constructor(dialect = SqlDialect.postgres) {
        this.dialect = dialect;
    }
    // ── Fluent API ────────────────────────────────────────────────────────────
    /** Select specific columns. Column names are typed as `keyof T & string`. */
    select(...cols) {
        this.selects.push(...cols);
        return this;
    }
    /** Set the primary table (FROM clause). */
    from(table) {
        this._from = { sql: table, params: [] };
        return this;
    }
    where(colOrRaw, opOrFirstVal, ...rest) {
        if (typeof opOrFirstVal === 'string' && rest.length === 1) {
            // where(col, op, value)
            this.wheres.push({ sql: `${colOrRaw} ${opOrFirstVal} ?`, params: [rest[0]] });
        }
        else if (typeof opOrFirstVal === 'string' && rest.length === 0) {
            // Could be where(col, op) without value – rare but valid
            // Treat as a raw condition with no params
            this.wheres.push({ sql: `${colOrRaw} ${opOrFirstVal}`, params: [] });
        }
        else if (opOrFirstVal === undefined && rest.length === 0) {
            // where(rawCondition)
            this.wheres.push({ sql: colOrRaw, params: [] });
        }
        else {
            // where(rawCondition, value1, value2, …)
            const params = opOrFirstVal !== undefined
                ? [opOrFirstVal, ...rest]
                : [...rest];
            this.wheres.push({ sql: colOrRaw, params });
        }
        return this;
    }
    /** Add an INNER JOIN. */
    join(table, condition) {
        this.joins.push({ type: 'INNER', table, tableParams: [], condition });
        return this;
    }
    /** Add a LEFT JOIN. */
    leftJoin(table, condition) {
        this.joins.push({ type: 'LEFT', table, tableParams: [], condition });
        return this;
    }
    /** Add an ORDER BY entry. */
    orderBy(col, dir = 'ASC') {
        this.orderBys.push({ col, dir });
        return this;
    }
    /** Add GROUP BY columns. */
    groupBy(...cols) {
        this.groupBys.push(...cols);
        return this;
    }
    /** Add a HAVING condition (raw SQL with `?`-parameterised values). */
    having(condition, ...values) {
        this.havings.push({ sql: condition, params: values });
        return this;
    }
    /** Set LIMIT. */
    limit(n) {
        this._limit = n;
        return this;
    }
    /** Set OFFSET. */
    offset(n) {
        this._offset = n;
        return this;
    }
    /**
     * Embed the result of another `QueryBuilder` as a derived table.
     *
     * If no `from()` has been called yet the sub-query becomes the FROM source.
     * Otherwise it is appended as an INNER JOIN derived table (no ON clause).
     *
     * @param qb    - Inner query builder (built in `?`-placeholder mode so params
     *               can be re-numbered later).
     * @param alias - SQL alias for the derived table.
     */
    subquery(qb, alias) {
        // Build the inner query using mysql/sqlite '?' style so placeholders can
        // be trivially renumbered during the outer build.
        const inner = qb._buildInternal();
        const derivedSql = `(${inner.sql}) AS ${alias}`;
        if (this._from === null) {
            this._from = { sql: derivedSql, params: inner.params };
        }
        else {
            this.joins.push({
                type: 'INNER',
                table: derivedSql,
                tableParams: inner.params,
                condition: null,
            });
        }
        return this;
    }
    // ── Build ─────────────────────────────────────────────────────────────────
    /**
     * Render the current AST to a `{ sql, params }` pair.
     *
     * This method is **idempotent**: calling it multiple times on the same
     * (unmodified) builder always produces identical output because it only
     * reads AST state without mutating it.
     *
     * Placeholder style:
     *   - `postgres` dialect → `$1`, `$2`, …
     *   - `mysql` / `sqlite` dialects → `?`
     */
    build() {
        return this._buildInternal(this.dialect);
    }
    // ── Private ───────────────────────────────────────────────────────────────
    /**
     * Internal build that accepts an explicit dialect override so that
     * sub-queries can always be rendered with '?' placeholders, making them
     * trivially composable by the outer builder.
     */
    _buildInternal(dialect = SqlDialect.mysql) {
        const allParams = [];
        let paramIdx = 1;
        /** Consume one value: push it to allParams and return the placeholder. */
        const consume = (v) => {
            allParams.push(v);
            return dialect === SqlDialect.postgres ? `$${paramIdx++}` : '?';
        };
        /**
         * Replace each `?` in a SQL fragment with the appropriate placeholder
         * and push the matching param.
         */
        const expand = (sql, params) => {
            let i = 0;
            return sql.replace(/\?/g, () => consume(params[i++]));
        };
        const parts = [];
        // SELECT
        const selectList = this.selects.length > 0 ? this.selects.join(', ') : '*';
        parts.push(`SELECT ${selectList}`);
        // FROM
        if (this._from !== null) {
            const fromSql = expand(this._from.sql, this._from.params);
            parts.push(`FROM ${fromSql}`);
        }
        // JOINs
        for (const j of this.joins) {
            const tableSql = expand(j.table, j.tableParams);
            if (j.condition !== null) {
                parts.push(`${j.type} JOIN ${tableSql} ON ${j.condition}`);
            }
            else {
                parts.push(`${j.type} JOIN ${tableSql}`);
            }
        }
        // WHERE
        if (this.wheres.length > 0) {
            const conditions = this.wheres.map((w) => expand(w.sql, w.params));
            parts.push(`WHERE ${conditions.join(' AND ')}`);
        }
        // GROUP BY
        if (this.groupBys.length > 0) {
            parts.push(`GROUP BY ${this.groupBys.join(', ')}`);
        }
        // HAVING
        if (this.havings.length > 0) {
            const havingParts = this.havings.map((h) => expand(h.sql, h.params));
            parts.push(`HAVING ${havingParts.join(' AND ')}`);
        }
        // ORDER BY
        if (this.orderBys.length > 0) {
            const orderParts = this.orderBys.map((o) => `${o.col} ${o.dir}`);
            parts.push(`ORDER BY ${orderParts.join(', ')}`);
        }
        // LIMIT / OFFSET
        if (this._limit !== null) {
            parts.push(`LIMIT ${this._limit}`);
        }
        if (this._offset !== null) {
            parts.push(`OFFSET ${this._offset}`);
        }
        return { sql: parts.join(' '), params: allParams };
    }
}

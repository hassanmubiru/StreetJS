/** SQL dialects supported by QueryBuilder. */
export declare enum SqlDialect {
    postgres = "postgres",
    mysql = "mysql",
    sqlite = "sqlite"
}
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
export declare class QueryBuilder<T extends object> {
    /** Columns listed in SELECT. */
    private readonly selects;
    /** WHERE conditions (each holds a '?'-parameterised SQL fragment). */
    private readonly wheres;
    /** JOIN clauses. */
    private readonly joins;
    /** ORDER BY entries. */
    private readonly orderBys;
    /** GROUP BY columns. */
    private readonly groupBys;
    /** HAVING conditions. */
    private readonly havings;
    /** FROM clause (table name or derived-table expression). */
    private _from;
    /** LIMIT value. */
    private _limit;
    /** OFFSET value. */
    private _offset;
    private readonly dialect;
    constructor(dialect?: SqlDialect);
    /** Select specific columns. Column names are typed as `keyof T & string`. */
    select(...cols: (keyof T & string)[]): this;
    /** Set the primary table (FROM clause). */
    from(table: string): this;
    /**
     * Add a WHERE condition.
     *
     * Overloads
     *   1. `where(col, op, value)` – typed column + operator + value
     *   2. `where(rawCondition, ...values)` – raw SQL fragment with `?` slots
     */
    where(col: keyof T & string, op: string, value: unknown): this;
    where(rawCondition: string, ...values: unknown[]): this;
    /** Add an INNER JOIN. */
    join(table: string, condition: string): this;
    /** Add a LEFT JOIN. */
    leftJoin(table: string, condition: string): this;
    /** Add an ORDER BY entry. */
    orderBy(col: keyof T & string, dir?: 'ASC' | 'DESC'): this;
    /** Add GROUP BY columns. */
    groupBy(...cols: (keyof T & string)[]): this;
    /** Add a HAVING condition (raw SQL with `?`-parameterised values). */
    having(condition: string, ...values: unknown[]): this;
    /** Set LIMIT. */
    limit(n: number): this;
    /** Set OFFSET. */
    offset(n: number): this;
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
    subquery<U extends object>(qb: QueryBuilder<U>, alias: string): this;
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
    build(): {
        sql: string;
        params: unknown[];
    };
    /**
     * Internal build that accepts an explicit dialect override so that
     * sub-queries can always be rendered with '?' placeholders, making them
     * trivially composable by the outer builder.
     */
    private _buildInternal;
}

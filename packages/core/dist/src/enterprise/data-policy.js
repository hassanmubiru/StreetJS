// src/enterprise/data-policy.ts
// Data retention, field-level encryption decorators, and compliance reporting.
/**
 * Marks a property with a retention duration (e.g. '90d', '1y').
 * Metadata key: 'street:retention'
 */
export function RetainFor(duration) {
    return (target, propertyKey) => {
        const key = String(propertyKey);
        const existing = Reflect.getMetadata('street:retention', target.constructor) ?? {};
        existing[key] = duration;
        Reflect.defineMetadata('street:retention', existing, target.constructor);
    };
}
/**
 * Marks a property for transparent AES-256-GCM field-level encryption.
 * Metadata key: 'street:encrypt'
 */
export function Encrypt() {
    return (target, propertyKey) => {
        const key = String(propertyKey);
        const existing = Reflect.getMetadata('street:encrypt', target.constructor) ?? [];
        if (!existing.includes(key))
            existing.push(key);
        Reflect.defineMetadata('street:encrypt', existing, target.constructor);
    };
}
/**
 * Marks a property with a data classification level.
 * Metadata key: 'street:classify'
 */
export function Classify(level) {
    return (target, propertyKey) => {
        const key = String(propertyKey);
        const existing = Reflect.getMetadata('street:classify', target.constructor) ?? {};
        existing[key] = level;
        Reflect.defineMetadata('street:classify', existing, target.constructor);
    };
}
/**
 * Deletes rows older than the specified retention period in batches.
 */
export class RetentionJob {
    pool;
    batchSize;
    constructor(pool, batchSize = 1_000) {
        this.pool = pool;
        this.batchSize = batchSize;
    }
    async run(entityMeta) {
        for (const { table, retentionDays } of entityMeta) {
            await this._deleteForTable(table, retentionDays);
        }
    }
    async _deleteForTable(table, retentionDays) {
        // Sanitize table name (alphanumeric + underscore only)
        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(table)) {
            throw new Error(`Invalid table name: ${table}`);
        }
        let deleted = 0;
        do {
            const result = await this.pool.query(`DELETE FROM ${table}
         WHERE id IN (
           SELECT id FROM ${table}
           WHERE created_at < NOW() - INTERVAL '${retentionDays} days'
           LIMIT ${this.batchSize}
         )`);
            deleted = result.rows.length;
        } while (deleted >= this.batchSize);
    }
}
export class ComplianceReporter {
    static report(entities) {
        const reports = [];
        for (const EntityClass of entities) {
            const entityName = EntityClass.name;
            const retentionMeta = Reflect.getMetadata('street:retention', EntityClass) ?? {};
            const encryptMeta = Reflect.getMetadata('street:encrypt', EntityClass) ?? [];
            const classifyMeta = Reflect.getMetadata('street:classify', EntityClass) ?? {};
            // Collect all annotated fields
            const allFields = new Set([
                ...Object.keys(retentionMeta),
                ...encryptMeta,
                ...Object.keys(classifyMeta),
            ]);
            for (const field of allFields) {
                reports.push({
                    field,
                    entity: entityName,
                    classification: classifyMeta[field],
                    encrypted: encryptMeta.includes(field),
                    retentionPeriod: retentionMeta[field],
                });
            }
        }
        return reports;
    }
}
//# sourceMappingURL=data-policy.js.map
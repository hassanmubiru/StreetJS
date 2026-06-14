// packages/orm/src/metadata.ts
// Entity/column/relation metadata captured by decorators and assembled into a
// validated relation graph. All identifiers (table/column names) originate here
// — from compile-time decorator arguments, never from user input — and are
// validated as SQL-safe identifiers so the query planner can quote them safely.

import 'reflect-metadata';

export class OrmError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OrmError';
  }
}

/** A SQL identifier is safe when it is a bare word (letters, digits, underscore). */
export function isSafeIdentifier(name: string): boolean {
  return typeof name === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(name);
}

function assertIdent(kind: string, name: string): string {
  if (!isSafeIdentifier(name)) throw new OrmError(`Invalid ${kind} identifier: ${JSON.stringify(name)}`);
  return name;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Ctor<T = unknown> = new (...args: any[]) => T;
export type RelationKind = 'hasOne' | 'hasMany' | 'belongsTo' | 'manyToMany';

export interface ColumnMeta { property: string; column: string; primary: boolean; sqlType: string; }

export interface RelationMeta {
  property: string;
  kind: RelationKind;
  target: () => Ctor;
  /**
   * For hasOne/hasMany: the FK column on the TARGET table referencing this entity's PK.
   * For belongsTo: the FK column on THIS table referencing the target's PK.
   */
  foreignKey?: string;
  /** For manyToMany: the join table and its two FK columns. */
  through?: string;
  ownerKey?: string;  // join-table column → this entity PK
  targetKey?: string; // join-table column → target entity PK
}

export interface EntityMeta {
  ctor: Ctor;
  table: string;
  columns: ColumnMeta[];
  primaryKey: ColumnMeta;
  relations: RelationMeta[];
}

const ENTITY = Symbol('streetjs:orm:entity');
const COLUMNS = Symbol('streetjs:orm:columns');
const RELATIONS = Symbol('streetjs:orm:relations');

function columnsOf(ctor: Ctor): ColumnMeta[] {
  const holder = ctor as unknown as { [COLUMNS]?: ColumnMeta[] };
  if (!Object.prototype.hasOwnProperty.call(ctor, COLUMNS)) holder[COLUMNS] = [];
  return holder[COLUMNS]!;
}
function relationsOf(ctor: Ctor): RelationMeta[] {
  const holder = ctor as unknown as { [RELATIONS]?: RelationMeta[] };
  if (!Object.prototype.hasOwnProperty.call(ctor, RELATIONS)) holder[RELATIONS] = [];
  return holder[RELATIONS]!;
}

// ── Decorators ────────────────────────────────────────────────────────────────

export function Entity(table: string): ClassDecorator {
  assertIdent('table', table);
  return (target) => {
    (target as unknown as { [ENTITY]?: string })[ENTITY] = table;
  };
}

/** A SQL column type is a conservative token (letters, digits, spaces, parens). */
export function isSafeSqlType(t: string): boolean {
  return typeof t === 'string' && /^[A-Za-z][A-Za-z0-9 ()]*$/.test(t);
}

function assertType(t: string): string {
  if (!isSafeSqlType(t)) throw new OrmError(`Invalid SQL type: ${JSON.stringify(t)}`);
  return t;
}

export function Column(column?: string, opts?: { type?: string }): PropertyDecorator {
  return (proto, property) => {
    const name = column ?? String(property);
    columnsOf(proto.constructor as Ctor).push({
      property: String(property), column: assertIdent('column', name), primary: false,
      sqlType: assertType(opts?.type ?? 'text'),
    });
  };
}

export function PrimaryKey(column?: string, opts?: { type?: string }): PropertyDecorator {
  return (proto, property) => {
    const name = column ?? String(property);
    columnsOf(proto.constructor as Ctor).push({
      property: String(property), column: assertIdent('column', name), primary: true,
      sqlType: assertType(opts?.type ?? 'integer'),
    });
  };
}

export function HasMany(target: () => Ctor, foreignKey: string): PropertyDecorator {
  return (proto, property) => {
    relationsOf(proto.constructor as Ctor).push({ property: String(property), kind: 'hasMany', target, foreignKey: assertIdent('foreignKey', foreignKey) });
  };
}

export function HasOne(target: () => Ctor, foreignKey: string): PropertyDecorator {
  return (proto, property) => {
    relationsOf(proto.constructor as Ctor).push({ property: String(property), kind: 'hasOne', target, foreignKey: assertIdent('foreignKey', foreignKey) });
  };
}

export function BelongsTo(target: () => Ctor, foreignKey: string): PropertyDecorator {
  return (proto, property) => {
    relationsOf(proto.constructor as Ctor).push({ property: String(property), kind: 'belongsTo', target, foreignKey: assertIdent('foreignKey', foreignKey) });
  };
}

export function ManyToMany(
  target: () => Ctor,
  opts: { through: string; ownerKey: string; targetKey: string },
): PropertyDecorator {
  return (proto, property) => {
    relationsOf(proto.constructor as Ctor).push({
      property: String(property),
      kind: 'manyToMany',
      target,
      through: assertIdent('through', opts.through),
      ownerKey: assertIdent('ownerKey', opts.ownerKey),
      targetKey: assertIdent('targetKey', opts.targetKey),
    });
  };
}

// ── Registry ────────────────────────────────────────────────────────────────

/** Build + validate the entity/relation graph for a set of entity classes. */
export class EntityRegistry {
  private readonly byCtor = new Map<Ctor, EntityMeta>();

  constructor(entities: Ctor[]) {
    for (const ctor of entities) this.register(ctor);
    this.validate();
  }

  private register(ctor: Ctor): void {
    const table = (ctor as unknown as { [ENTITY]?: string })[ENTITY];
    if (!table) throw new OrmError(`${ctor.name} is missing @Entity(table)`);
    const columns = columnsOf(ctor);
    const pk = columns.find((c) => c.primary);
    if (!pk) throw new OrmError(`${ctor.name} (${table}) is missing a @PrimaryKey`);
    this.byCtor.set(ctor, { ctor, table, columns, primaryKey: pk, relations: relationsOf(ctor) });
  }

  /** Validate that every relation target is registered and well-formed. */
  private validate(): void {
    for (const meta of this.byCtor.values()) {
      for (const rel of meta.relations) {
        const targetCtor = rel.target();
        if (!this.byCtor.has(targetCtor)) {
          throw new OrmError(`${meta.ctor.name}.${rel.property} → target ${targetCtor.name} is not registered with the Orm`);
        }
        if (rel.kind === 'manyToMany') {
          if (!rel.through || !rel.ownerKey || !rel.targetKey) {
            throw new OrmError(`${meta.ctor.name}.${rel.property} (manyToMany) needs through/ownerKey/targetKey`);
          }
        } else if (!rel.foreignKey) {
          throw new OrmError(`${meta.ctor.name}.${rel.property} (${rel.kind}) needs a foreignKey`);
        }
      }
    }
  }

  get(ctor: Ctor): EntityMeta {
    const meta = this.byCtor.get(ctor);
    if (!meta) throw new OrmError(`${ctor.name} is not registered with the Orm`);
    return meta;
  }

  metaOf(ctor: () => Ctor): EntityMeta {
    return this.get(ctor());
  }
}

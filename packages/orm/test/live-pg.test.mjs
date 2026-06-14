// Live PostgreSQL integration test for @streetjs/orm.
//
// Skips when PG_HOST is unset (offline suite stays hermetic); runs in CI where
// the orm-integration workflow provides a postgres service container. Creates a
// schema, seeds related rows, and exercises eager (1:1, 1:N, N:M) + lazy loading
// + relation filtering against real Postgres via the native streetjs PgPool.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { PgPool } from 'streetjs';
import {
  Orm, Entity, PrimaryKey, Column, HasMany, HasOne, BelongsTo, ManyToMany,
} from '../dist/index.js';

const HOST = process.env.PG_HOST;

// Fixtures (decorators applied imperatively so this runs as plain ESM).
class User {}
class Post {}
class Profile {}
class Tag {}
PrimaryKey()(User.prototype, 'id'); Column('email')(User.prototype, 'email');
HasMany(() => Post, 'author_id')(User.prototype, 'posts');
HasOne(() => Profile, 'user_id')(User.prototype, 'profile');
Entity('orm_users')(User);
PrimaryKey()(Post.prototype, 'id'); Column('author_id')(Post.prototype, 'author_id');
Column('published')(Post.prototype, 'published');
BelongsTo(() => User, 'author_id')(Post.prototype, 'author');
ManyToMany(() => Tag, { through: 'orm_post_tags', ownerKey: 'post_id', targetKey: 'tag_id' })(Post.prototype, 'tags');
Entity('orm_posts')(Post);
PrimaryKey()(Profile.prototype, 'id'); Column('user_id')(Profile.prototype, 'user_id');
Column('bio')(Profile.prototype, 'bio'); Entity('orm_profiles')(Profile);
PrimaryKey()(Tag.prototype, 'id'); Column('name')(Tag.prototype, 'name'); Entity('orm_tags')(Tag);

describe('@streetjs/orm — live PostgreSQL', () => {
  let pool;
  let orm;

  before(async () => {
    if (!HOST) return;
    pool = new PgPool({
      host: HOST,
      port: process.env.PG_PORT ? Number(process.env.PG_PORT) : 5432,
      user: process.env.PG_USER ?? 'street',
      password: process.env.PG_PASSWORD ?? 'street_secret',
      database: process.env.PG_DATABASE ?? 'street_test',
    });
    const ddl = [
      'DROP TABLE IF EXISTS orm_post_tags, orm_posts, orm_profiles, orm_tags, orm_users CASCADE',
      'CREATE TABLE orm_users (id int PRIMARY KEY, email text NOT NULL)',
      'CREATE TABLE orm_profiles (id int PRIMARY KEY, user_id int NOT NULL, bio text)',
      'CREATE TABLE orm_posts (id int PRIMARY KEY, author_id int NOT NULL, published boolean NOT NULL)',
      'CREATE TABLE orm_tags (id int PRIMARY KEY, name text NOT NULL)',
      'CREATE TABLE orm_post_tags (post_id int NOT NULL, tag_id int NOT NULL)',
      "INSERT INTO orm_users VALUES (1,'a@x.co'),(2,'b@x.co')",
      "INSERT INTO orm_profiles VALUES (100,1,'hi')",
      'INSERT INTO orm_posts VALUES (10,1,true),(11,1,false),(12,2,true)',
      "INSERT INTO orm_tags VALUES (5,'ts'),(6,'db')",
      'INSERT INTO orm_post_tags VALUES (10,5),(10,6)',
    ];
    for (const sql of ddl) await pool.query(sql, []);
    orm = new Orm({ pool, entities: [User, Post, Profile, Tag] });
  });

  after(async () => { if (pool) await pool.close(); });

  it('eager-loads 1:N and 1:1', async (t) => {
    if (!HOST) { t.skip('PG_HOST not set'); return; }
    const users = orm.getRepository(User);
    const rows = await users.find({ where: { id: 1 }, with: ['posts', 'profile'] });
    assert.equal(rows[0].posts.length, 2);
    assert.equal(rows[0].profile.bio, 'hi');
  });

  it('relation filtering (only published posts)', async (t) => {
    if (!HOST) { t.skip('PG_HOST not set'); return; }
    const users = orm.getRepository(User);
    const rows = await users.find({ where: { id: 1 }, with: { posts: { where: { published: true } } } });
    assert.equal(rows[0].posts.length, 1);
    assert.equal(rows[0].posts[0].id, 10);
  });

  it('belongsTo + manyToMany', async (t) => {
    if (!HOST) { t.skip('PG_HOST not set'); return; }
    const posts = orm.getRepository(Post);
    const rows = await posts.find({ where: { id: 10 }, with: ['author', 'tags'] });
    assert.equal(rows[0].author.email, 'a@x.co');
    assert.deepEqual(rows[0].tags.map((x) => x.name).sort(), ['db', 'ts']);
  });

  it('lazy loadRelation', async (t) => {
    if (!HOST) { t.skip('PG_HOST not set'); return; }
    const users = orm.getRepository(User);
    const u = await users.findOne({ where: { id: 2 } });
    const posts = await users.loadRelation(u, 'posts');
    assert.equal(posts.length, 1);
    assert.equal(posts[0].id, 12);
  });
});

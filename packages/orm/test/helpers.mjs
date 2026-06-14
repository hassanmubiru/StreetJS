// Shared test fixtures. Decorators are plain functions, so we apply them
// imperatively here (the .mjs tests run against the compiled dist).
import {
  Entity, PrimaryKey, Column, HasMany, HasOne, BelongsTo, ManyToMany, EntityRegistry,
} from '../dist/index.js';

export class User {}
export class Post {}
export class Profile {}
export class Tag {}

PrimaryKey()(User.prototype, 'id');
Column('email')(User.prototype, 'email');
HasMany(() => Post, 'authorId')(User.prototype, 'posts');
HasOne(() => Profile, 'userId')(User.prototype, 'profile');
Entity('users')(User);

PrimaryKey()(Post.prototype, 'id');
Column('authorId')(Post.prototype, 'authorId');
Column('published')(Post.prototype, 'published');
BelongsTo(() => User, 'authorId')(Post.prototype, 'author');
ManyToMany(() => Tag, { through: 'post_tags', ownerKey: 'postId', targetKey: 'tagId' })(Post.prototype, 'tags');
Entity('posts')(Post);

PrimaryKey()(Profile.prototype, 'id');
Column('userId')(Profile.prototype, 'userId');
Column('bio')(Profile.prototype, 'bio');
Entity('profiles')(Profile);

PrimaryKey()(Tag.prototype, 'id');
Column('name')(Tag.prototype, 'name');
Entity('tags')(Tag);

export function buildRegistry() {
  return new EntityRegistry([User, Post, Profile, Tag]);
}

// src/cli/commands.ts
// CLI command implementations using @Command decorator.

import { Injectable } from '../core/container.js';
import { Command } from '../core/decorators.js';
import { StreetMigrationRunner } from '../database/migrations.js';
import { AppConfig } from '../config/index.js';
import { UserService } from '../services/user.service.js';
import type { ParsedArgs } from './kernel.js';

@Injectable()
export class MigrateCommand {
  constructor(
    private readonly runner: StreetMigrationRunner,
    config: AppConfig
  ) {
    void config; // config available if needed for future use
  }

  @Command('migrate', 'Run pending database migrations')
  async run(args: ParsedArgs): Promise<void> {
    const dir = String(args.flags['dir'] ?? './migrations');
    console.log(`[cli] Running migrations from: ${dir}`);
    await this.runner.run(dir);
    console.log('[cli] Migrations complete.');
  }

  @Command('migrate:rollback', 'Rollback the last N migrations')
  async rollback(args: ParsedArgs): Promise<void> {
    const steps = parseInt(String(args.flags['steps'] ?? '1'), 10);
    const dir = String(args.flags['dir'] ?? './migrations');
    console.log(`[cli] Rolling back ${steps} migration(s) from: ${dir}`);
    await this.runner.rollback(dir, steps);
    console.log('[cli] Rollback complete.');
  }
}

@Injectable()
export class UserCommand {
  constructor(
    private readonly userService: UserService,
    _config: AppConfig
  ) {}

  @Command('user:create', 'Create a new user (--email --name --password)')
  async create(args: ParsedArgs): Promise<void> {
    const email = String(args.flags['email'] ?? '');
    const name = String(args.flags['name'] ?? '');
    const password = String(args.flags['password'] ?? '');

    if (!email || !name || !password) {
      console.error('[cli] Usage: user:create --email <email> --name <name> --password <pass>');
      process.exitCode = 1;
      return;
    }

    const user = await this.userService.register({ email, name, password });
    console.log('[cli] User created:', JSON.stringify(user, null, 2));
  }

  @Command('user:list', 'List all users (--page --limit)')
  async list(args: ParsedArgs): Promise<void> {
    const page = parseInt(String(args.flags['page'] ?? '1'), 10);
    const limit = parseInt(String(args.flags['limit'] ?? '20'), 10);
    const result = await this.userService.findAll(page, limit);
    console.log(`[cli] Users (page ${page}, total ${result.total}):`);
    for (const user of result.items) {
      console.log(`  ${user.id} | ${user.email} | ${user.name}`);
    }
  }

  @Command('user:delete', 'Delete a user by ID (--id <uuid>)')
  async delete(args: ParsedArgs): Promise<void> {
    const id = String(args.flags['id'] ?? '');
    if (!id) {
      console.error('[cli] Usage: user:delete --id <uuid>');
      process.exitCode = 1;
      return;
    }
    await this.userService.remove(id);
    console.log(`[cli] User ${id} deleted.`);
  }
}

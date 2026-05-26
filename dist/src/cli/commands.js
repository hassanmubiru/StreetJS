// src/cli/commands.ts
// CLI command implementations using @Command decorator.
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
import { Injectable } from '../core/container.js';
import { Command } from '../core/decorators.js';
import { StreetMigrationRunner } from '../database/migrations.js';
import { AppConfig } from '../config/index.js';
import { UserService } from '../services/user.service.js';
let MigrateCommand = class MigrateCommand {
    runner;
    constructor(runner, config) {
        this.runner = runner;
        void config; // config available if needed for future use
    }
    async run(args) {
        const dir = String(args.flags['dir'] ?? './migrations');
        console.log(`[cli] Running migrations from: ${dir}`);
        await this.runner.run(dir);
        console.log('[cli] Migrations complete.');
    }
    async rollback(args) {
        const steps = parseInt(String(args.flags['steps'] ?? '1'), 10);
        const dir = String(args.flags['dir'] ?? './migrations');
        console.log(`[cli] Rolling back ${steps} migration(s) from: ${dir}`);
        await this.runner.rollback(dir, steps);
        console.log('[cli] Rollback complete.');
    }
};
__decorate([
    Command('migrate', 'Run pending database migrations'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], MigrateCommand.prototype, "run", null);
__decorate([
    Command('migrate:rollback', 'Rollback the last N migrations'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], MigrateCommand.prototype, "rollback", null);
MigrateCommand = __decorate([
    Injectable(),
    __metadata("design:paramtypes", [StreetMigrationRunner,
        AppConfig])
], MigrateCommand);
export { MigrateCommand };
let UserCommand = class UserCommand {
    userService;
    constructor(userService, _config) {
        this.userService = userService;
    }
    async create(args) {
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
    async list(args) {
        const page = parseInt(String(args.flags['page'] ?? '1'), 10);
        const limit = parseInt(String(args.flags['limit'] ?? '20'), 10);
        const result = await this.userService.findAll(page, limit);
        console.log(`[cli] Users (page ${page}, total ${result.total}):`);
        for (const user of result.items) {
            console.log(`  ${user.id} | ${user.email} | ${user.name}`);
        }
    }
    async delete(args) {
        const id = String(args.flags['id'] ?? '');
        if (!id) {
            console.error('[cli] Usage: user:delete --id <uuid>');
            process.exitCode = 1;
            return;
        }
        await this.userService.remove(id);
        console.log(`[cli] User ${id} deleted.`);
    }
};
__decorate([
    Command('user:create', 'Create a new user (--email --name --password)'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], UserCommand.prototype, "create", null);
__decorate([
    Command('user:list', 'List all users (--page --limit)'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], UserCommand.prototype, "list", null);
__decorate([
    Command('user:delete', 'Delete a user by ID (--id <uuid>)'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], UserCommand.prototype, "delete", null);
UserCommand = __decorate([
    Injectable(),
    __metadata("design:paramtypes", [UserService,
        AppConfig])
], UserCommand);
export { UserCommand };
//# sourceMappingURL=commands.js.map
import { StreetMigrationRunner } from '../database/migrations.js';
import { AppConfig } from '../config/index.js';
import { UserService } from '../services/user.service.js';
import type { ParsedArgs } from './kernel.js';
export declare class MigrateCommand {
    private readonly runner;
    constructor(runner: StreetMigrationRunner, config: AppConfig);
    run(args: ParsedArgs): Promise<void>;
    rollback(args: ParsedArgs): Promise<void>;
}
export declare class UserCommand {
    private readonly userService;
    constructor(userService: UserService, _config: AppConfig);
    create(args: ParsedArgs): Promise<void>;
    list(args: ParsedArgs): Promise<void>;
    delete(args: ParsedArgs): Promise<void>;
}
//# sourceMappingURL=commands.d.ts.map
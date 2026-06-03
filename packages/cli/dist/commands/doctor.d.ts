import type { CliContext } from '../index.js';
export declare class DoctorCommand {
    execute(ctx: CliContext): Promise<void>;
    private readTsVersion;
    private checkEnvVars;
    private checkDbConnectivity;
}
export declare class EnvValidateCommand {
    execute(ctx: CliContext): Promise<void>;
}
//# sourceMappingURL=doctor.d.ts.map
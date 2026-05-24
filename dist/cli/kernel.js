// src/cli/kernel.ts
// CLI kernel: argv parser, flag parser, @Command decorator dispatch with DI.
import { container } from '../core/container.js';
import { getCommandMeta } from '../core/decorators.js';
/** Parse process.argv into structured args */
export function parseArgv(argv) {
    // argv[0] = node, argv[1] = script
    const args = argv.slice(2);
    const flags = {};
    const positional = [];
    let command = null;
    let i = 0;
    while (i < args.length) {
        const arg = args[i];
        if (arg.startsWith('--')) {
            const key = arg.slice(2);
            const eqIdx = key.indexOf('=');
            if (eqIdx !== -1) {
                flags[key.slice(0, eqIdx)] = key.slice(eqIdx + 1);
            }
            else {
                const next = args[i + 1];
                if (next && !next.startsWith('-')) {
                    flags[key] = next;
                    i++;
                }
                else {
                    flags[key] = true;
                }
            }
        }
        else if (arg.startsWith('-') && arg.length === 2) {
            const key = arg.slice(1);
            const next = args[i + 1];
            if (next && !next.startsWith('-')) {
                flags[key] = next;
                i++;
            }
            else {
                flags[key] = true;
            }
        }
        else {
            if (command === null) {
                command = arg;
            }
            else {
                positional.push(arg);
            }
        }
        i++;
    }
    return { command, positional, flags };
}
export class CliKernel {
    handlers = new Map();
    opts;
    constructor(opts = {}) {
        this.opts = {
            appName: opts.appName ?? 'street',
            version: opts.version ?? '1.0.0',
        };
    }
    /** Register a class containing @Command-decorated methods */
    register(ctor) {
        const instance = container.resolve(ctor);
        const commands = getCommandMeta(ctor);
        for (const cmd of commands) {
            if (this.handlers.has(cmd.name)) {
                throw new Error(`Duplicate CLI command: "${cmd.name}"`);
            }
            this.handlers.set(cmd.name, {
                instance,
                method: cmd.handlerMethod,
                description: cmd.description,
            });
        }
    }
    /** Run a command from parsed args */
    async run(args) {
        if (args.flags['version'] || args.flags['v']) {
            console.log(`${this.opts.appName} v${this.opts.version}`);
            return;
        }
        if (!args.command || args.flags['help'] || args.flags['h']) {
            this._printHelp();
            return;
        }
        const handler = this.handlers.get(args.command);
        if (!handler) {
            console.error(`Unknown command: "${args.command}"`);
            console.error(`Run "${this.opts.appName} --help" to see available commands.`);
            process.exitCode = 1;
            return;
        }
        const method = handler.instance[handler.method];
        if (typeof method !== 'function') {
            throw new Error(`Handler method "${handler.method}" is not a function`);
        }
        await method.call(handler.instance, args);
    }
    /** Execute from process.argv */
    async execute() {
        const args = parseArgv(process.argv);
        await this.run(args);
    }
    _printHelp() {
        console.log(`\n${this.opts.appName} v${this.opts.version}\n`);
        console.log('Commands:\n');
        for (const [name, h] of this.handlers.entries()) {
            console.log(`  ${name.padEnd(20)} ${h.description}`);
        }
        console.log('\nFlags:\n');
        console.log('  --help, -h           Show this help');
        console.log('  --version, -v        Show version\n');
    }
}
//# sourceMappingURL=kernel.js.map
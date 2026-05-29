// packages/cli/src/argv.ts
// Robust argument parser supporting flags, subcommands, and positional args.
/**
 * Parse process.argv-like arrays into structured command, positional args, and flags.
 *
 * Supports:
 *   --flag=value
 *   --flag value
 *   --flag         (boolean)
 *   -f value
 *   -f             (boolean)
 *   command sub positional
 */
export function argvParser(argv) {
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
                if (next !== undefined && !next.startsWith('-')) {
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
            if (next !== undefined && !next.startsWith('-')) {
                flags[key] = next;
                i++;
            }
            else {
                flags[key] = true;
            }
        }
        else {
            // First non-flag token is the command
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
//# sourceMappingURL=argv.js.map
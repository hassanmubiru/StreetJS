// src/jobs/scheduler.ts
// Cron scheduler with 5-field expression parsing and single-instance guard.
// ── Errors ────────────────────────────────────────────────────────────────────
export class CronParseError extends Error {
    constructor(expression, reason) {
        super(`Invalid cron expression "${expression}": ${reason}`);
        this.name = 'CronParseError';
    }
}
function parseField(raw, min, max, label, expr) {
    if (raw === '*') {
        const result = [];
        for (let i = min; i <= max; i++)
            result.push(i);
        return result;
    }
    // Support step values: */N or start-end/N
    if (raw.includes('/')) {
        const [rangePart, stepPart] = raw.split('/');
        const step = parseInt(stepPart, 10);
        if (isNaN(step) || step <= 0) {
            throw new CronParseError(expr, `invalid step value in field "${raw}" (${label})`);
        }
        let rangeMin = min;
        let rangeMax = max;
        if (rangePart !== '*') {
            if (rangePart.includes('-')) {
                const [lo, hi] = rangePart.split('-').map(Number);
                if (isNaN(lo) || isNaN(hi))
                    throw new CronParseError(expr, `invalid range in field "${raw}" (${label})`);
                rangeMin = lo;
                rangeMax = hi;
            }
            else {
                rangeMin = parseInt(rangePart, 10);
                if (isNaN(rangeMin))
                    throw new CronParseError(expr, `invalid range start in field "${raw}" (${label})`);
            }
        }
        if (rangeMin < min || rangeMax > max || rangeMin > rangeMax) {
            throw new CronParseError(expr, `range "${rangePart}" out of bounds [${min}-${max}] for field (${label})`);
        }
        const result = [];
        for (let i = rangeMin; i <= rangeMax; i += step)
            result.push(i);
        return result;
    }
    // Support comma-separated values
    if (raw.includes(',')) {
        const values = raw.split(',').flatMap((v) => parseField(v.trim(), min, max, label, expr));
        return [...new Set(values)].sort((a, b) => a - b);
    }
    // Support ranges: lo-hi
    if (raw.includes('-')) {
        const [lo, hi] = raw.split('-').map(Number);
        if (isNaN(lo) || isNaN(hi)) {
            throw new CronParseError(expr, `invalid range "${raw}" in field (${label})`);
        }
        if (lo < min || hi > max || lo > hi) {
            throw new CronParseError(expr, `range "${raw}" out of bounds [${min}-${max}] for field (${label})`);
        }
        const result = [];
        for (let i = lo; i <= hi; i++)
            result.push(i);
        return result;
    }
    // Single value
    const n = parseInt(raw, 10);
    if (isNaN(n)) {
        throw new CronParseError(expr, `non-numeric value "${raw}" in field (${label})`);
    }
    if (n < min || n > max) {
        throw new CronParseError(expr, `value ${n} out of range [${min}-${max}] for field (${label})`);
    }
    return [n];
}
function parseCron(expression) {
    const parts = expression.trim().split(/\s+/);
    if (parts.length !== 5) {
        throw new CronParseError(expression, `expected 5 fields, got ${parts.length}`);
    }
    const [minuteStr, hourStr, dayStr, monthStr, weekdayStr] = parts;
    return {
        minute: parseField(minuteStr, 0, 59, 'minute', expression),
        hour: parseField(hourStr, 0, 23, 'hour', expression),
        day: parseField(dayStr, 1, 31, 'day', expression),
        month: parseField(monthStr, 1, 12, 'month', expression),
        weekday: parseField(weekdayStr, 0, 7, 'weekday', expression),
    };
}
/**
 * Compute the next Date on or after `from` that matches the cron fields.
 * Returns null if no match can be found within ~4 years.
 */
function nextFireTime(fields, from) {
    // Round up to the next whole minute
    const d = new Date(from);
    d.setSeconds(0, 0);
    d.setMinutes(d.getMinutes() + 1);
    const limit = new Date(from.getTime() + 4 * 365 * 24 * 60 * 60 * 1000);
    while (d < limit) {
        // Month check (Date.getMonth() is 0-based)
        if (!fields.month.includes(d.getMonth() + 1)) {
            d.setMonth(d.getMonth() + 1, 1);
            d.setHours(0, 0, 0, 0);
            continue;
        }
        // Day-of-month check
        if (!fields.day.includes(d.getDate())) {
            d.setDate(d.getDate() + 1);
            d.setHours(0, 0, 0, 0);
            continue;
        }
        // Weekday check (0 and 7 both represent Sunday; Date.getDay() is 0-based)
        const wd = d.getDay(); // 0=Sun … 6=Sat
        const weekdayMatch = fields.weekday.includes(wd) ||
            (wd === 0 && fields.weekday.includes(7));
        if (!weekdayMatch) {
            d.setDate(d.getDate() + 1);
            d.setHours(0, 0, 0, 0);
            continue;
        }
        // Hour check
        if (!fields.hour.includes(d.getHours())) {
            d.setHours(d.getHours() + 1, 0, 0, 0);
            continue;
        }
        // Minute check
        const nextMinute = fields.minute.find((m) => m >= d.getMinutes());
        if (nextMinute === undefined) {
            d.setHours(d.getHours() + 1, 0, 0, 0);
            continue;
        }
        d.setMinutes(nextMinute, 0, 0);
        return d;
    }
    return null;
}
export class CronScheduler {
    jobs = new Map();
    started = false;
    /**
     * Register a cron job.
     * Throws `CronParseError` immediately if the expression is invalid.
     */
    register(expression, name, fn) {
        const fields = parseCron(expression); // throws CronParseError on bad input
        this.jobs.set(name, { fields, name, fn, timer: null, running: false });
    }
    /** Start all registered cron jobs by scheduling the first timeout. */
    start() {
        this.started = true;
        for (const entry of this.jobs.values()) {
            this._schedule(entry);
        }
    }
    /** Stop all cron job timers. */
    stop() {
        this.started = false;
        for (const entry of this.jobs.values()) {
            if (entry.timer !== null) {
                clearTimeout(entry.timer);
                entry.timer = null;
            }
        }
    }
    _schedule(entry) {
        if (!this.started)
            return;
        const next = nextFireTime(entry.fields, new Date());
        if (!next)
            return;
        const delay = Math.max(0, next.getTime() - Date.now());
        entry.timer = setTimeout(() => {
            void this._fire(entry);
        }, delay);
        entry.timer.unref?.();
    }
    async _fire(entry) {
        if (!this.started)
            return;
        // Single-instance guard: skip if already running
        if (entry.running) {
            this._schedule(entry);
            return;
        }
        entry.running = true;
        try {
            await entry.fn();
        }
        catch {
            // Swallow — caller can handle errors inside fn
        }
        finally {
            entry.running = false;
        }
        this._schedule(entry);
    }
}
//# sourceMappingURL=scheduler.js.map
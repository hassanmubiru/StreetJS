import type { JobQueuePool } from './queue.js';
export declare const STREET_WORKFLOWS_MIGRATION_SQL = "\nCREATE TABLE IF NOT EXISTS street_workflows (\n  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),\n  name         TEXT NOT NULL,\n  status       TEXT NOT NULL DEFAULT 'pending',\n  current_step INT NOT NULL DEFAULT 0,\n  step_outputs JSONB NOT NULL DEFAULT '{}',\n  input        JSONB NOT NULL DEFAULT '{}',\n  error        TEXT,\n  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),\n  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()\n);\nCREATE INDEX IF NOT EXISTS street_workflows_name_status ON street_workflows (name, status);\n";
export interface WorkflowContext {
    workflowId: string;
}
export interface WorkflowStep {
    name: string;
    run(input: unknown, ctx: WorkflowContext): Promise<unknown>;
    compensate?(output: unknown, ctx: WorkflowContext): Promise<void>;
    timeoutMs?: number;
    /**
     * Optional conditional-branching predicate (Requirement 24.4). Evaluated with
     * the current input (the prior step's output) and the workflow context just
     * before the step would run. When it resolves to `false`, the step's `run()`
     * is skipped entirely: no compensation is registered for it, the current
     * input is passed through unchanged to the next step, and the pass-through
     * value is recorded in `step_outputs[name]` so a later `resume()` treats the
     * step as already-handled rather than re-evaluating it.
     */
    condition?(input: unknown, ctx: WorkflowContext): boolean | Promise<boolean>;
}
/**
 * Raised when a step exceeds its configured `timeoutMs`. Carrying a dedicated
 * error type lets `resume()` distinguish a timeout (workflow status
 * `timed_out`) from an ordinary step failure (status `failed`), while still
 * triggering Saga compensation in both cases.
 */
export declare class WorkflowStepTimeoutError extends Error {
    readonly stepName: string;
    readonly timeoutMs: number;
    constructor(stepName: string, timeoutMs: number);
}
export declare class WorkflowEngine {
    private readonly pool;
    private readonly definitions;
    constructor(pool: JobQueuePool);
    /** Define a named workflow with an ordered list of steps. */
    define(name: string, steps: WorkflowStep[]): void;
    /** Start a new workflow instance and immediately resume it. Returns the workflow ID. */
    start(name: string, input: unknown): Promise<string>;
    /** Resume a workflow from its current step. */
    resume(workflowId: string): Promise<void>;
    private _runWithTimeout;
    private _compensate;
}
//# sourceMappingURL=workflow.d.ts.map
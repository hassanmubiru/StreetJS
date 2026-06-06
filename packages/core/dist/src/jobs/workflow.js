// src/jobs/workflow.ts
// Saga-pattern workflow engine backed by PostgreSQL.
// ── Migration SQL ─────────────────────────────────────────────────────────────
export const STREET_WORKFLOWS_MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS street_workflows (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending',
  current_step INT NOT NULL DEFAULT 0,
  step_outputs JSONB NOT NULL DEFAULT '{}',
  input        JSONB NOT NULL DEFAULT '{}',
  error        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS street_workflows_name_status ON street_workflows (name, status);
`;
/**
 * Raised when a step exceeds its configured `timeoutMs`. Carrying a dedicated
 * error type lets `resume()` distinguish a timeout (workflow status
 * `timed_out`) from an ordinary step failure (status `failed`), while still
 * triggering Saga compensation in both cases.
 */
export class WorkflowStepTimeoutError extends Error {
    stepName;
    timeoutMs;
    constructor(stepName, timeoutMs) {
        super(`Step "${stepName}" timed out after ${timeoutMs}ms`);
        this.name = 'WorkflowStepTimeoutError';
        this.stepName = stepName;
        this.timeoutMs = timeoutMs;
    }
}
// ── WorkflowEngine ────────────────────────────────────────────────────────────
export class WorkflowEngine {
    pool;
    definitions = new Map();
    constructor(pool) {
        this.pool = pool;
    }
    /** Define a named workflow with an ordered list of steps. */
    define(name, steps) {
        this.definitions.set(name, steps);
    }
    /** Start a new workflow instance and immediately resume it. Returns the workflow ID. */
    async start(name, input) {
        if (!this.definitions.has(name)) {
            throw new Error(`Workflow "${name}" is not defined`);
        }
        const result = await this.pool.query(`INSERT INTO street_workflows (name, input) VALUES ($1, $2::jsonb) RETURNING id`, [name, JSON.stringify(input)]);
        const workflowId = result.rows[0]['id'];
        await this.resume(workflowId);
        return workflowId;
    }
    /** Resume a workflow from its current step. */
    async resume(workflowId) {
        const result = await this.pool.query(`SELECT name, status, current_step, step_outputs, input FROM street_workflows WHERE id=$1`, [workflowId]);
        if (result.rows.length === 0) {
            throw new Error(`Workflow "${workflowId}" not found`);
        }
        const row = result.rows[0];
        const name = row['name'];
        const status = row['status'];
        if (status === 'completed' || status === 'failed') {
            return; // Already terminal — nothing to do
        }
        // Acquire a distributed lock so only one worker can advance this workflow at a time.
        const { DistributedLock } = await import('../microservices/distributed-lock.js');
        const lock = new DistributedLock(this.pool);
        const lockHandle = await lock.acquire(`workflow:${workflowId}`, 30_000);
        try {
            const steps = this.definitions.get(name);
            if (!steps) {
                throw new Error(`Workflow definition "${name}" not found`);
            }
            const stepOutputs = row['step_outputs']
                ? JSON.parse(row['step_outputs'])
                : {};
            let currentStepIndex = parseInt(row['current_step'], 10);
            const ctx = { workflowId };
            // Keep track of completed steps and their outputs for compensation
            const completedSteps = [];
            // Populate already-completed steps from stored outputs
            for (let i = 0; i < currentStepIndex; i++) {
                const step = steps[i];
                if (step) {
                    completedSteps.push({ step, output: stepOutputs[step.name] });
                }
            }
            // Get initial input for this resume (output of previous step, or workflow input)
            let currentInput = currentStepIndex === 0
                ? (row['input'] ? JSON.parse(row['input']) : undefined)
                : (completedSteps.length > 0
                    ? completedSteps[completedSteps.length - 1].output
                    : undefined);
            // Execute remaining steps
            for (let i = currentStepIndex; i < steps.length; i++) {
                const step = steps[i];
                // Skip already-completed steps (recorded in step_outputs). This makes
                // resume() robust even if current_step lags behind step_outputs after a
                // crash: we propagate the recorded output as the next step's input so the
                // chain continues from exactly the right place without re-execution.
                if (stepOutputs[step.name] !== undefined) {
                    const recordedOutput = stepOutputs[step.name];
                    completedSteps.push({ step, output: recordedOutput });
                    currentInput = recordedOutput;
                    currentStepIndex = i + 1;
                    continue;
                }
                // Mark workflow as running at this step
                await this.pool.query(`UPDATE street_workflows SET status='running', current_step=$1, updated_at=NOW() WHERE id=$2`, [i, workflowId]);
                try {
                    const output = await this._runWithTimeout(step, currentInput, ctx);
                    // Persist step output
                    stepOutputs[step.name] = output;
                    await this.pool.query(`UPDATE street_workflows
           SET step_outputs=$1::jsonb, current_step=$2, updated_at=NOW()
           WHERE id=$3`, [JSON.stringify(stepOutputs), i + 1, workflowId]);
                    completedSteps.push({ step, output });
                    currentInput = output;
                    currentStepIndex = i + 1;
                }
                catch (err) {
                    const errorMsg = err instanceof Error ? err.message : String(err);
                    // A timeout is a distinct terminal state from an ordinary failure:
                    // mark the workflow `timed_out` (Requirement 24.5) rather than `failed`,
                    // but still run Saga compensation for the steps completed so far.
                    const status = err instanceof WorkflowStepTimeoutError ? 'timed_out' : 'failed';
                    await this.pool.query(`UPDATE street_workflows SET status=$1, error=$2, updated_at=NOW() WHERE id=$3`, [status, errorMsg, workflowId]);
                    // Saga compensation: run compensate() for completed steps in reverse
                    await this._compensate(completedSteps, ctx);
                    return;
                }
            }
            // All steps completed
            await this.pool.query(`UPDATE street_workflows SET status='completed', updated_at=NOW() WHERE id=$1`, [workflowId]);
        }
        finally {
            await lockHandle.release();
        }
    }
    // ── Internal ──────────────────────────────────────────────────────────────
    async _runWithTimeout(step, input, ctx) {
        if (!step.timeoutMs) {
            return step.run(input, ctx);
        }
        const timeoutMs = step.timeoutMs;
        let timer;
        try {
            return await Promise.race([
                step.run(input, ctx),
                new Promise((_, reject) => {
                    timer = setTimeout(() => reject(new WorkflowStepTimeoutError(step.name, timeoutMs)), timeoutMs);
                    // Don't keep the event loop alive solely for this timer.
                    timer.unref?.();
                }),
            ]);
        }
        finally {
            // Clear the timer if the step settled first, preventing a leaked timer.
            if (timer)
                clearTimeout(timer);
        }
    }
    async _compensate(completedSteps, ctx) {
        // Run in reverse order
        for (let i = completedSteps.length - 1; i >= 0; i--) {
            const { step, output } = completedSteps[i];
            if (typeof step.compensate === 'function') {
                try {
                    await step.compensate(output, ctx);
                }
                catch (compensateErr) {
                    // Log but do not re-throw — keep compensating remaining steps
                    const msg = compensateErr instanceof Error ? compensateErr.message : String(compensateErr);
                    process.stderr.write(`[WorkflowEngine] Compensation error in step "${step.name}": ${msg}\n`);
                }
            }
        }
    }
}
//# sourceMappingURL=workflow.js.map
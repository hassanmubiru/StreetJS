// src/microservices/saga.ts
// Saga orchestrator: run steps, compensate in reverse on failure.
// ── SagaOrchestrator ──────────────────────────────────────────────────────────
export class SagaOrchestrator {
    /**
     * Execute the given saga steps in order.
     *
     * If any step's `action()` throws:
     *  1. Call `compensate()` on all previously-completed steps in reverse order.
     *  2. Log (but not rethrow) any compensation errors.
     *  3. Re-throw the original failure so the caller knows the saga failed.
     */
    async execute(steps) {
        const completed = [];
        for (const step of steps) {
            try {
                await step.action();
                completed.push(step);
            }
            catch (err) {
                // Compensate in reverse order
                const toCompensate = [...completed].reverse();
                for (const completedStep of toCompensate) {
                    try {
                        await completedStep.compensate();
                    }
                    catch (compensationErr) {
                        const name = completedStep.name ?? '(unnamed step)';
                        console.error(`[SagaOrchestrator] Compensation failed for step "${name}":`, compensationErr);
                    }
                }
                throw err;
            }
        }
    }
}
//# sourceMappingURL=saga.js.map
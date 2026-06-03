export interface SagaStep {
    /** Execute the forward action. */
    action(): Promise<void>;
    /** Execute the compensating action (must not throw). */
    compensate(): Promise<void>;
    /** Optional name for logging. */
    name?: string;
}
export declare class SagaOrchestrator {
    /**
     * Execute the given saga steps in order.
     *
     * If any step's `action()` throws:
     *  1. Call `compensate()` on all previously-completed steps in reverse order.
     *  2. Log (but not rethrow) any compensation errors.
     *  3. Re-throw the original failure so the caller knows the saga failed.
     */
    execute(steps: SagaStep[]): Promise<void>;
}
//# sourceMappingURL=saga.d.ts.map
# ADR 0028: Workflow Close Conformance

**Status:** Accepted  
**Scope:** `@streetjs/workflow` engine shutdown

## Decision

`WorkflowEngine.close()` owns one memoized close promise and aborts every
cooperative activity signal currently tracked by the engine's coordinator before
awaiting pending auto-resume work. Repeated close calls observe the same result.

Durable waiting runs are not deleted or resumed by close. Their persisted state
remains available to a later engine instance, while active activities receive the
existing cooperative `AbortSignal` cancellation mechanism.

## Rationale

The engine already supported per-run cancellation, but engine shutdown did not
exercise that ownership boundary. Aborting tracked activity signals prevents the
engine from leaving cooperative work alive after its resources are released, and
memoization makes plugin unload and repeated shutdown deterministic.

## Non-goals

- forcibly cancelling activities that ignore their signal;
- changing durable run status to `cancelled` during engine close;
- deleting persisted waiting runs;
- adding a shutdown timeout to the workflow engine itself.

## Evidence

Focused tests cover shared close identity and abort delivery to an active
cooperative activity. Existing cancellation, replay, waiting, and plugin unload
tests remain part of workflow package verification.

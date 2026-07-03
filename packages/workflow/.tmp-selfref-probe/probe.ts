import { createWorkflow } from "@streetjs/workflow";
import type { WorkflowContext, WorkflowEngine, Activity } from "@streetjs/workflow";

export function make(): WorkflowEngine {
  return createWorkflow();
}
export type C = WorkflowContext;
export type A = Activity<{ ok: boolean }>;

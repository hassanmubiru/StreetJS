// Unit tests for the @streetjs/workflow typed error hierarchy.
//
// Verifies that every concrete error subclass:
//   - is an `instanceof WorkflowError` (and, transitively, `instanceof Error`)
//   - carries its descriptive, strongly typed message fields
//   - sets its own `name`
//   - preserves the standard `cause` convention
//
// Uses the Node.js built-in test runner (node:test) and is executed via
// `node --test dist/tests/*.test.js`.
//
// Requirements: 1.4, 1.5, 11.5, 13.4, 14.3, 15.4

import test from "node:test";
import assert from "node:assert/strict";

import {
  WorkflowError,
  RegistrationError,
  WorkflowNotFoundError,
  CancelledResumeError,
  WorkflowConfigError,
  PersistenceError,
  ResumeIntegrityError,
} from "../errors.js";

test("WorkflowError is an Error, sets its name, and carries an optional cause", () => {
  const err = new WorkflowError("something went wrong");
  assert.ok(err instanceof WorkflowError);
  assert.ok(err instanceof Error);
  assert.equal(err.name, "WorkflowError");
  assert.equal(err.message, "something went wrong");
  assert.equal(err.cause, undefined);

  const underlying = new Error("root cause");
  const wrapped = new WorkflowError("wrapped", { cause: underlying });
  assert.equal(wrapped.cause, underlying);
});

test("RegistrationError is a WorkflowError carrying the offending workflowName (Req 1.4)", () => {
  const err = new RegistrationError("order-processing");
  assert.ok(err instanceof RegistrationError);
  assert.ok(err instanceof WorkflowError);
  assert.ok(err instanceof Error);
  assert.equal(err.name, "RegistrationError");
  assert.equal(err.workflowName, "order-processing");
  assert.match(err.message, /order-processing/);

  const custom = new RegistrationError("dupe", "custom message", {
    cause: "boom",
  });
  assert.equal(custom.message, "custom message");
  assert.equal(custom.workflowName, "dupe");
  assert.equal(custom.cause, "boom");
});

test("WorkflowNotFoundError is a WorkflowError carrying the requested workflowName (Req 1.5)", () => {
  const err = new WorkflowNotFoundError("missing-workflow");
  assert.ok(err instanceof WorkflowNotFoundError);
  assert.ok(err instanceof WorkflowError);
  assert.ok(err instanceof Error);
  assert.equal(err.name, "WorkflowNotFoundError");
  assert.equal(err.workflowName, "missing-workflow");
  assert.match(err.message, /missing-workflow/);
});

test("CancelledResumeError is a WorkflowError carrying the cancelled runId (Req 14.3)", () => {
  const err = new CancelledResumeError("run-123");
  assert.ok(err instanceof CancelledResumeError);
  assert.ok(err instanceof WorkflowError);
  assert.ok(err instanceof Error);
  assert.equal(err.name, "CancelledResumeError");
  assert.equal(err.runId, "run-123");
  assert.match(err.message, /run-123/);
});

test("WorkflowConfigError is a WorkflowError carrying bridge and operation fields (Req 15.4)", () => {
  const err = new WorkflowConfigError("no storage bridge wired", {
    bridge: "storage",
    operation: "put",
  });
  assert.ok(err instanceof WorkflowConfigError);
  assert.ok(err instanceof WorkflowError);
  assert.ok(err instanceof Error);
  assert.equal(err.name, "WorkflowConfigError");
  assert.equal(err.message, "no storage bridge wired");
  assert.equal(err.bridge, "storage");
  assert.equal(err.operation, "put");

  const bare = new WorkflowConfigError("misconfigured");
  assert.equal(bare.bridge, undefined);
  assert.equal(bare.operation, undefined);
});

test("PersistenceError is a WorkflowError carrying operation and runId fields (Req 11.5)", () => {
  const err = new PersistenceError("failed to save run", {
    operation: "save",
    runId: "run-456",
  });
  assert.ok(err instanceof PersistenceError);
  assert.ok(err instanceof WorkflowError);
  assert.ok(err instanceof Error);
  assert.equal(err.name, "PersistenceError");
  assert.equal(err.message, "failed to save run");
  assert.equal(err.operation, "save");
  assert.equal(err.runId, "run-456");

  const bare = new PersistenceError("out of memory");
  assert.equal(bare.operation, undefined);
  assert.equal(bare.runId, undefined);
});

test("ResumeIntegrityError is a WorkflowError carrying runId and seq fields (Req 13.4)", () => {
  const err = new ResumeIntegrityError("run-789", undefined, { seq: 7 });
  assert.ok(err instanceof ResumeIntegrityError);
  assert.ok(err instanceof WorkflowError);
  assert.ok(err instanceof Error);
  assert.equal(err.name, "ResumeIntegrityError");
  assert.equal(err.runId, "run-789");
  assert.equal(err.seq, 7);
  assert.match(err.message, /run-789/);

  const bare = new ResumeIntegrityError("run-000");
  assert.equal(bare.runId, "run-000");
  assert.equal(bare.seq, undefined);
});

test("every subclass is catchable through a single WorkflowError check", () => {
  const errors: WorkflowError[] = [
    new RegistrationError("a"),
    new WorkflowNotFoundError("b"),
    new CancelledResumeError("c"),
    new WorkflowConfigError("d"),
    new PersistenceError("e"),
    new ResumeIntegrityError("f"),
  ];
  for (const err of errors) {
    assert.ok(err instanceof WorkflowError);
    assert.ok(err instanceof Error);
    assert.notEqual(err.name, "WorkflowError");
  }
});

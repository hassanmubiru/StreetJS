import test from "node:test";
import assert from "node:assert/strict";

import {
  validateRequest,
  assertValid,
  required,
  isString,
  matches,
  isInteger,
} from "../validation.js";
import { RequestValidationError } from "../errors.js";
import type { ValidationSchema } from "../types.js";

// ── rule helpers ─────────────────────────────────────────────────────────────────

test("rule helpers accept valid values and reject invalid ones with clear messages", () => {
  assert.equal(required()("x"), true);
  assert.equal(required()(undefined), "is required");
  assert.equal(required()(null), "is required");

  assert.equal(isString()("hi"), true);
  assert.equal(isString()(42), "must be a string");

  assert.equal(matches(/^\d+$/)("123"), true);
  assert.equal(matches(/^\d+$/)("abc"), "must match /^\\d+$/");
  assert.equal(matches(/^\d+$/)(7), "must match /^\\d+$/");

  assert.equal(isInteger()(3), true);
  assert.equal(isInteger()(3.5), "must be an integer");
  assert.equal(isInteger()("3"), "must be an integer");
});

// ── validateRequest: valid input ───────────────────────────────────────────────────

test("validateRequest returns [] when every rule passes", () => {
  const schema: ValidationSchema = {
    headers: { authorization: required() },
    query: { page: isInteger() },
    params: { id: matches(/^\d+$/) },
    body: (b) => (typeof b === "object" && b !== null ? true : "must be an object"),
  };
  const issues = validateRequest(schema, {
    headers: { authorization: "Bearer t" },
    query: { page: 1 },
    params: { id: "42" },
    body: { name: "a" },
  });
  assert.deepEqual(issues, []);
});

// ── validateRequest: one issue per location ─────────────────────────────────────────

test("a missing required header produces one issue with correct location/field/message", () => {
  const schema: ValidationSchema = { headers: { authorization: required() } };
  const issues = validateRequest(schema, { headers: {} });
  assert.deepEqual(issues, [
    { location: "headers", field: "authorization", message: "is required" },
  ]);
});

test("a missing required query param produces one issue", () => {
  const schema: ValidationSchema = { query: { page: required() } };
  const issues = validateRequest(schema, { query: {} });
  assert.deepEqual(issues, [{ location: "query", field: "page", message: "is required" }]);
});

test("a missing required path param produces one issue", () => {
  const schema: ValidationSchema = { params: { id: required() } };
  const issues = validateRequest(schema, { params: {} });
  assert.deepEqual(issues, [{ location: "params", field: "id", message: "is required" }]);
});

test("a missing/invalid body produces one issue with field 'body'", () => {
  const schema: ValidationSchema = { body: required() };
  const issues = validateRequest(schema, {});
  assert.deepEqual(issues, [{ location: "body", field: "body", message: "is required" }]);
});

// ── validateRequest: accumulation & stable order ────────────────────────────────────

test("multiple failures accumulate in the stable order headers → params → query → body", () => {
  const schema: ValidationSchema = {
    headers: { authorization: required() },
    query: { page: required() },
    params: { id: required() },
    body: required(),
  };
  const issues = validateRequest(schema, {});
  assert.deepEqual(
    issues.map((i) => i.location),
    ["headers", "params", "query", "body"],
  );
  assert.equal(issues.length, 4);
});

test("multiple rules within a location run in declared order", () => {
  const schema: ValidationSchema = {
    query: { a: required(), b: required() },
  };
  const issues = validateRequest(schema, { query: {} });
  assert.deepEqual(
    issues.map((i) => i.field),
    ["a", "b"],
  );
});

// ── header case-insensitivity ───────────────────────────────────────────────────────

test("header field names are matched case-insensitively", () => {
  const schema: ValidationSchema = { headers: { Authorization: isString() } };
  const issues = validateRequest(schema, { headers: { authorization: "Bearer t" } });
  assert.deepEqual(issues, []);
});

// ── assertValid ─────────────────────────────────────────────────────────────────────

test("assertValid returns void when the request is valid", () => {
  const schema: ValidationSchema = { headers: { authorization: required() } };
  assert.equal(assertValid(schema, { headers: { authorization: "x" } }), undefined);
});

test("assertValid throws RequestValidationError whose issues match and status is 400", () => {
  const schema: ValidationSchema = {
    headers: { authorization: required() },
    body: required(),
  };
  const input = {};
  const expected = validateRequest(schema, input);
  assert.throws(
    () => assertValid(schema, input),
    (err: unknown) => {
      assert.ok(err instanceof RequestValidationError);
      assert.equal(err.status, 400);
      assert.deepEqual(err.issues, expected);
      return true;
    },
  );
});

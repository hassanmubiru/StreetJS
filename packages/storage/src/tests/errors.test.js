// Unit tests for the typed error hierarchy of @streetjs/storage.
//
// Verifies that every concrete error subclass derives from both StorageError
// and the native Error (so consumers can catch the whole family or discriminate
// on a subclass), that each carries its descriptive typed fields, and that each
// sets `name` correctly. Uses the Node.js built-in test runner (node:test) and
// is executed via `node --test dist/tests/*.test.js`.
//
// Requirements: 1.5, 9.4, 11.3

import test from "node:test";
import assert from "node:assert/strict";

import {
  StorageError,
  StorageConfigError,
  NotFoundError,
  ValidationError,
  AuthorizationError,
  UnsupportedImageError,
} from "../index.js";

test("StorageError is a native Error and sets its name", () => {
  const err = new StorageError("boom");
  assert.ok(err instanceof Error);
  assert.ok(err instanceof StorageError);
  assert.equal(err.name, "StorageError");
  assert.equal(err.message, "boom");
});

test("StorageError carries an optional cause", () => {
  const underlying = new Error("root cause");
  const err = new StorageError("wrapped", { cause: underlying });
  assert.equal(err.cause, underlying);
});

test("StorageConfigError is instanceof StorageError and Error", () => {
  const err = new StorageConfigError("bad config", { provider: "s3" });
  assert.ok(err instanceof Error);
  assert.ok(err instanceof StorageError);
  assert.ok(err instanceof StorageConfigError);
});

test("StorageConfigError carries provider and name", () => {
  const err = new StorageConfigError("unknown provider", { provider: "nope" });
  assert.equal(err.name, "StorageConfigError");
  assert.equal(err.provider, "nope");
});

test("NotFoundError is instanceof StorageError and Error", () => {
  const err = new NotFoundError("photos/1.png");
  assert.ok(err instanceof Error);
  assert.ok(err instanceof StorageError);
  assert.ok(err instanceof NotFoundError);
});

test("NotFoundError carries key, name, and default message", () => {
  const err = new NotFoundError("photos/1.png");
  assert.equal(err.name, "NotFoundError");
  assert.equal(err.key, "photos/1.png");
  assert.equal(err.message, 'Object not found for key "photos/1.png"');
});

test("ValidationError is instanceof StorageError and Error", () => {
  const err = new ValidationError("file too large");
  assert.ok(err instanceof Error);
  assert.ok(err instanceof StorageError);
  assert.ok(err instanceof ValidationError);
});

test("ValidationError carries validationError, optional key, and name", () => {
  const err = new ValidationError("file too large", { key: "uploads/big.zip" });
  assert.equal(err.name, "ValidationError");
  assert.equal(err.validationError, "file too large");
  assert.equal(err.key, "uploads/big.zip");
  assert.equal(err.message, "Upload validation failed: file too large");
});

test("AuthorizationError is instanceof StorageError and Error", () => {
  const err = new AuthorizationError("denied");
  assert.ok(err instanceof Error);
  assert.ok(err instanceof StorageError);
  assert.ok(err instanceof AuthorizationError);
});

test("AuthorizationError carries key, operation, accessLevel, and name", () => {
  const err = new AuthorizationError("access denied", {
    key: "private/secret.txt",
    operation: "read",
    accessLevel: "private",
  });
  assert.equal(err.name, "AuthorizationError");
  assert.equal(err.key, "private/secret.txt");
  assert.equal(err.operation, "read");
  assert.equal(err.accessLevel, "private");
});

test("UnsupportedImageError is instanceof StorageError and Error", () => {
  const err = new UnsupportedImageError("cannot process");
  assert.ok(err instanceof Error);
  assert.ok(err instanceof StorageError);
  assert.ok(err instanceof UnsupportedImageError);
});

test("UnsupportedImageError carries format, key, and name", () => {
  const err = new UnsupportedImageError("unsupported format", {
    format: "image/tiff",
    key: "images/scan.tiff",
  });
  assert.equal(err.name, "UnsupportedImageError");
  assert.equal(err.format, "image/tiff");
  assert.equal(err.key, "images/scan.tiff");
});

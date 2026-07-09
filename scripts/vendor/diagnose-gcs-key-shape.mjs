#!/usr/bin/env node
// TEMPORARY diagnostic for the vendor-integration.yml "Diagnose GCS
// service-account key shape" step. Reads the materialized GCS service-account
// key file (path from GOOGLE_APPLICATION_CREDENTIALS) and reports its
// structural shape — never its actual secret values — so a JWT-signing
// failure downstream (google-auth-library "key must be a string, a buffer or
// an object") can be diagnosed without ever printing the private key.
//
// Delete this script and its workflow step once the root cause is confirmed
// and fixed.

import { readFileSync } from "node:fs";

const path = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (!path) {
  console.log("GOOGLE_APPLICATION_CREDENTIALS is not set.");
  process.exit(0);
}

const raw = readFileSync(path, "utf8");
console.log("file byte length:", raw.length);
console.log("starts with brace:", raw.trimStart().startsWith("{"));

let obj;
try {
  obj = JSON.parse(raw);
  console.log("JSON.parse: OK");
} catch (error) {
  console.log("JSON.parse FAILED:", error.message);
  process.exit(0);
}

console.log("top-level keys:", Object.keys(obj));
console.log("type field:", obj.type);
console.log(
  "client_email present:",
  typeof obj.client_email === "string" && obj.client_email.length > 0,
);
console.log("private_key typeof:", typeof obj.private_key);
console.log(
  "private_key length:",
  typeof obj.private_key === "string" ? obj.private_key.length : "n/a",
);
console.log(
  "private_key starts with BEGIN marker:",
  typeof obj.private_key === "string" && obj.private_key.includes("BEGIN PRIVATE KEY"),
);
console.log(
  "private_key contains literal backslash-n (unescaped):",
  typeof obj.private_key === "string" && obj.private_key.includes("\\n"),
);
console.log(
  "private_key contains real newline:",
  typeof obj.private_key === "string" && obj.private_key.includes("\n"),
);

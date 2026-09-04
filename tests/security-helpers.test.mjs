import assert from "node:assert/strict";
import test from "node:test";
import { parseByteRange, RangeNotSatisfiableError } from "../src/lib/range.ts";
import { normalizeEmail, parseNonNegativeNumber, parseRole, validatePassword } from "../src/lib/validation.ts";
import { issueShareGrant, verifyShareGrant } from "../src/lib/share-access.ts";

test("parses normal, open-ended, and suffix byte ranges", () => {
  assert.deepEqual(parseByteRange("bytes=0-9", 100), { start: 0, end: 9 });
  assert.deepEqual(parseByteRange("bytes=90-", 100), { start: 90, end: 99 });
  assert.deepEqual(parseByteRange("bytes=-10", 100), { start: 90, end: 99 });
  assert.deepEqual(parseByteRange("bytes=0-999", 100), { start: 0, end: 99 });
  assert.equal(parseByteRange(null, 100), null);
});

test("rejects malformed and unsatisfiable byte ranges", () => {
  for (const header of [
    "bytes=100-100",
    "bytes=10-9",
    "bytes=1-2-3",
    "bytes=abc-def",
    "bytes=0-1,4-5",
    "bytes=-0",
  ]) {
    assert.throws(() => parseByteRange(header, 100), RangeNotSatisfiableError);
  }
  assert.throws(() => parseByteRange("bytes=0-0", 0), RangeNotSatisfiableError);
});

test("normalizes and validates shared input values", () => {
  assert.equal(normalizeEmail("  Test@Example.COM "), "test@example.com");
  assert.equal(normalizeEmail("user@"), null);
  assert.equal(normalizeEmail("@example.com"), null);
  assert.equal(normalizeEmail("not-an-email"), null);
  assert.equal(validatePassword("12345678"), "12345678");
  assert.equal(validatePassword("short"), null);
  assert.equal(validatePassword("x".repeat(257)), null);
  assert.equal(parseRole("ADMIN"), "ADMIN");
  assert.equal(parseRole("owner"), null);
  assert.equal(parseNonNegativeNumber("1024"), 1024);
  assert.equal(parseNonNegativeNumber(1.5), null);
});

test("share grants are signed and bound to the current access version", () => {
  process.env.NEXTAUTH_SECRET = "unit-test-secret-that-is-long-enough-123456";
  const shareId = "share-123";
  const token = issueShareGrant("file", shareId, 3);
  let cookieValue = token;
  const request = { cookies: { get: () => cookieValue ? { value: cookieValue } : undefined } };

  assert.equal(verifyShareGrant(request, "file", shareId, 3), true);
  assert.equal(verifyShareGrant(request, "file", shareId, 4), false);
  assert.equal(verifyShareGrant(request, "album", shareId, 3), false);

  const [payload, signature] = token.split(".");
  cookieValue = `${payload}.${signature.startsWith("a") ? "b" : "a"}${signature.slice(1)}`;
  assert.equal(verifyShareGrant(request, "file", shareId, 3), false);
});

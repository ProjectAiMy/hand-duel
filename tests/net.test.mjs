import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { sha256js } from "../js/net.js";

test("JS SHA-256 fallback matches the real thing", () => {
  for (const s of ["", "abc", "3:scissors:k2j3h4", "x".repeat(55), "y".repeat(64), "z".repeat(200)]) {
    const want = createHash("sha256").update(s).digest("hex");
    assert.equal(sha256js(new TextEncoder().encode(s)), want, s.slice(0, 20));
  }
});

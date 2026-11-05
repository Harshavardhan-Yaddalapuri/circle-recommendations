import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/db.js";

test("seed loads every file into its table", () => {
  const db = openDb();
  const count = (table) => db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
  assert.equal(count("topics"), 22);
  assert.equal(count("users"), 100);
  assert.equal(count("circles"), 40);
  assert.ok(count("memberships") > 400);
  assert.ok(count("posts") > 350);
  assert.ok(count("user_topic_interests") > 0);
  assert.ok(count("circle_tags") > 0);
});

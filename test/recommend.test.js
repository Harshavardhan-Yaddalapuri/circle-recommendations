import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/db.js";
import { recommend, isEligible, DATA_NOW } from "../src/recommend.js";

const db = openDb();
const ids = (userId, limit = 5) => recommend(db, userId, { limit }).recommendations.map((r) => r.circle_id);

test("obvious matches: user 7 gets Women Who Lead (#5) and Speak Up Circle (#6) on top", () => {
  assert.deepEqual(ids(7).slice(0, 2), [5, 6]);
});

test("duplicates: user 15 sees exactly one of the three Negotiation Circles", () => {
  const list = ids(15, 20);
  assert.equal(list.filter((id) => [10, 11, 12].includes(id)).length, 1);
  assert.ok(list.includes(13), "still gets her other interest, Confidence (#13)");
});

test("full/inactive: user 23 gets Level Up Collective (#22) first, never #20 (full) or #21 (inactive)", () => {
  const list = ids(23, 20);
  assert.equal(list[0], 22);
  assert.ok(!list.includes(20));
  assert.ok(!list.includes(21));
});

test("cold start: user 42 still gets a full list, explained as a starting point", () => {
  const result = recommend(db, 42, { limit: 5 });
  assert.equal(result.basis, "none");
  assert.equal(result.recommendations.length, 5);
  for (const r of result.recommendations) assert.match(r.reason, /^A great place to start: an active Circle on /);
});

test("no stated interests but has memberships: interests are inferred from joined Circles", () => {
  const user = db.prepare(
    `SELECT u.id FROM users u WHERE u.id != 42
       AND NOT EXISTS (SELECT 1 FROM user_topic_interests i WHERE i.user_id = u.id) LIMIT 1`,
  ).get();
  const result = recommend(db, user.id);
  assert.equal(result.basis, "inferred");
  assert.match(result.recommendations[0].reason, /like a Circle you're already in/);
});

test("every user gets a non-empty, valid, de-duplicated list", () => {
  const nowMs = Date.parse(DATA_NOW);
  const circle = db.prepare(
    `SELECT c.*, EXISTS (SELECT 1 FROM memberships m WHERE m.circle_id = c.id AND m.user_id = ?) AS is_member
     FROM circles c WHERE c.id = ?`,
  );
  for (const { id } of db.prepare("SELECT id FROM users").all()) {
    const recs = recommend(db, id, { limit: 20 }).recommendations;
    assert.ok(recs.length > 0, `user ${id} got no recommendations`);
    const topics = recs.map((r) => r.topic).filter(Boolean);
    assert.equal(new Set(topics).size, topics.length, `user ${id} got two Circles on one topic`);
    for (const r of recs) {
      assert.ok(isEligible(circle.get(id, r.circle_id), nowMs), `user ${id} got ineligible Circle ${r.circle_id}`);
      assert.ok(r.reason.length > 0);
    }
  }
});

test("reason mentions activity, format and how to join", () => {
  const [top] = recommend(db, 23).recommendations; // #22: hybrid, request, 14/20
  assert.equal(
    top.reason,
    "Focused on Getting promoted, one of your interests. 8 posts in the last 30 days, meets online and in person, join by request.",
  );
});

test("reason warns when only a few spots are left", () => {
  const visibilityLab = recommend(db, 7).recommendations.find((r) => r.circle_id === 34); // #34: 7/10
  assert.match(visibilityLab.reason, /only 3 spots left/);
});

test("unknown user returns null", () => {
  assert.equal(recommend(db, 9999), null);
});

test("with the real clock, every Circle is stale, so nothing is recommended (why DATA_NOW is pinned)", () => {
  const now = new Date().toISOString(); // dataset ends 2026-09-20; any later "now" is > 30 days past it
  for (const { id } of db.prepare("SELECT id FROM users").all()) {
    assert.deepEqual(recommend(db, id, { now }).recommendations, [], `user ${id}`);
  }
});

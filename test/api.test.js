import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/server.js";

let server;
let base;

before(async () => {
  // Loopback only: the test server never needs to be reachable from the network.
  server = createApp().listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

// fetch keeps connections alive; drop them so close() can't wait on an open socket.
after(() => {
  server.closeAllConnections();
  server.close();
});

test("GET /users/7/recommendations returns a ranked list with reasons", async () => {
  const res = await fetch(`${base}/users/7/recommendations?limit=3`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.user_id, 7);
  assert.equal(body.recommendations.length, 3);
  assert.equal(body.recommendations[0].circle_id, 5);
  assert.ok(body.recommendations[0].reason);
});

test("unknown user returns 404", async () => {
  const res = await fetch(`${base}/users/9999/recommendations`);
  assert.equal(res.status, 404);
});

test("user id that isn't a plain positive integer returns 400", async () => {
  for (const id of ["abc", "0", "7.0", "0x7"]) {
    const res = await fetch(`${base}/users/${id}/recommendations`);
    assert.equal(res.status, 400, `id=${id}`);
  }
});

test("out-of-range limit returns 400", async () => {
  for (const limit of ["0", "21", "two", "1e1", "2.0"]) {
    const res = await fetch(`${base}/users/7/recommendations?limit=${limit}`);
    assert.equal(res.status, 400, `limit=${limit}`);
  }
});

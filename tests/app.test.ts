import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fixture } from "./helper.js";
const request = (agentId: string, extra = {}) => ({
  agentId,
  tool: "ticket.read",
  requestKey: randomUUID(),
  payload: { email: "private@example.com", nested: { apiToken: "secret" } },
  ...extra,
});
test("Authentication and request protection reject unauthorized writes", async (t) => {
  const f = await fixture(t);
  assert.equal((await f.call("/dashboard")).status, 401);
  assert.equal(
    (await f.call("/login", { email: "admin@demo.local", password: "bad" }))
      .status,
    401,
  );
  assert.equal((await f.call("/agents", {}, f.cookie, false)).status, 403);
});
test("Viewer cannot create agents", async (t) => {
  const f = await fixture(t);
  assert.equal(
    (await f.call("/agents", {}, await f.login("viewer@demo.local"))).status,
    403,
  );
});
test("Tenant isolation hides agents and prevents cross-tenant requests", async (t) => {
  const f = await fixture(t);
  const a = (await f.call("/dashboard", undefined, f.cookie)).data.agents[0];
  const other = await f.login("other@demo.local");
  assert.equal(
    (await f.call("/dashboard", undefined, other)).data.agents.length,
    0,
  );
  assert.equal((await f.call("/requests", request(a.id), other)).status, 404);
});
test("Allowed requests redact sensitive values and execute exactly once", async (t) => {
  const f = await fixture(t);
  const a = (await f.call("/dashboard", undefined, f.cookie)).data.agents[0];
  const b = request(a.id);
  const r = await f.call("/requests", b, f.cookie);
  assert.equal(r.data.status, "allowed");
  assert.ok(!r.data.payload.includes("private@example.com"));
  assert.ok(!r.data.payload.includes("secret"));
  const replay = await f.call("/requests", b, f.cookie);
  assert.equal(replay.data.id, r.data.id);
  const e = await f.call("/requests/" + r.data.id + "/execute", {}, f.cookie);
  const e2 = await f.call("/requests/" + r.data.id + "/execute", {}, f.cookie);
  assert.equal(e.data.executionId, e2.data.executionId);
  assert.equal(
    f.db.prepare("SELECT count(*) AS n FROM executions").get()!.n,
    1,
  );
});
test("Disallowed tool cannot execute", async (t) => {
  const f = await fixture(t);
  const a = (await f.call("/dashboard", undefined, f.cookie)).data.agents[0];
  const r = await f.call(
    "/requests",
    request(a.id, { tool: "database.delete" }),
    f.cookie,
  );
  assert.equal(r.data.status, "denied");
  assert.equal(
    (await f.call("/requests/" + r.data.id + "/execute", {}, f.cookie)).status,
    409,
  );
});
test("High-value refunds require approval before execution", async (t) => {
  const f = await fixture(t);
  const a = (await f.call("/dashboard", undefined, f.cookie)).data.agents[0];
  const r = await f.call(
    "/requests",
    request(a.id, { tool: "refund.issue", amount: 25000 }),
    f.cookie,
  );
  assert.equal(r.data.status, "pending");
  assert.equal(
    (await f.call("/requests/" + r.data.id + "/execute", {}, f.cookie)).status,
    409,
  );
  assert.equal(
    (
      await f.call(
        "/requests/" + r.data.id + "/decision",
        { decision: "approved" },
        f.cookie,
      )
    ).status,
    200,
  );
  assert.equal(
    (await f.call("/requests/" + r.data.id + "/execute", {}, f.cookie)).status,
    200,
  );
  assert.equal(
    (
      await f.call(
        "/requests/" + r.data.id + "/decision",
        { decision: "approved" },
        f.cookie,
      )
    ).status,
    409,
  );
});
test("Rejected approval releases reserved budget and cannot execute", async (t) => {
  const f = await fixture(t);
  const a = (await f.call("/dashboard", undefined, f.cookie)).data.agents[0];
  const r = await f.call(
    "/requests",
    request(a.id, { tool: "refund.issue", amount: 25000 }),
    f.cookie,
  );
  assert.equal(
    f.db.prepare("SELECT spent FROM agents WHERE id=?").get(a.id)!.spent,
    5,
  );
  await f.call(
    "/requests/" + r.data.id + "/decision",
    { decision: "rejected" },
    f.cookie,
  );
  assert.equal(
    f.db.prepare("SELECT spent FROM agents WHERE id=?").get(a.id)!.spent,
    0,
  );
  assert.equal(
    (await f.call("/requests/" + r.data.id + "/execute", {}, f.cookie)).status,
    409,
  );
});
test("Budget reservations stop overspending", async (t) => {
  const f = await fixture(t);
  const a = await f.call(
    "/agents",
    { name: "Budget test", tools: ["refund.issue"], budget: 5, rateLimit: 10 },
    f.cookie,
  );
  await f.call(
    "/requests",
    request(a.data.id, { tool: "refund.issue", amount: 25000 }),
    f.cookie,
  );
  const r = await f.call(
    "/requests",
    request(a.data.id, { tool: "refund.issue", amount: 25000 }),
    f.cookie,
  );
  assert.equal(r.data.status, "denied");
  assert.match(r.data.reason, /budget/);
});
test("Per-agent rate limit blocks excess requests", async (t) => {
  const f = await fixture(t);
  const a = await f.call(
    "/agents",
    { name: "Rate test", tools: ["ticket.read"], budget: 100, rateLimit: 1 },
    f.cookie,
  );
  await f.call("/requests", request(a.data.id), f.cookie);
  const r = await f.call("/requests", request(a.data.id), f.cookie);
  assert.equal(r.data.status, "denied");
  assert.match(r.data.reason, /limit/);
});
test("Idempotency key conflict does not overwrite a request", async (t) => {
  const f = await fixture(t);
  const a = (await f.call("/dashboard", undefined, f.cookie)).data.agents[0];
  const b = request(a.id);
  await f.call("/requests", b, f.cookie);
  assert.equal(
    (await f.call("/requests", { ...b, tool: "refund.issue" }, f.cookie))
      .status,
    409,
  );
});
test("Invalid numeric input is rejected and logout invalidates session", async (t) => {
  const f = await fixture(t);
  const a = (await f.call("/dashboard", undefined, f.cookie)).data.agents[0];
  assert.equal(
    (await f.call("/requests", request(a.id, { amount: -10 }), f.cookie))
      .status,
    400,
  );
  await f.call("/logout", {}, f.cookie);
  assert.equal((await f.call("/dashboard", undefined, f.cookie)).status, 401);
});

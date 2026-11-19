import { z } from "zod";
import {
  base,
  admin,
  ensure,
  atomic,
  type Options,
  type User,
} from "./base.js";
import { randomUUID } from "node:crypto";
export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [
        k,
        /email|password|token|secret|phone|authorization/i.test(k)
          ? "[REDACTED]"
          : redact(v),
      ]),
    );
  return typeof value === "string"
    ? value.replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, "[EMAIL]")
    : value;
}
export function createApp(options: Options = {}) {
  const { app, db, finish } = base(options);
  db.exec(`CREATE TABLE IF NOT EXISTS agents(id TEXT PRIMARY KEY,org INTEGER NOT NULL,name TEXT NOT NULL,tools TEXT NOT NULL,budget INTEGER NOT NULL,spent INTEGER NOT NULL DEFAULT 0,rate_limit INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS requests(id TEXT PRIMARY KEY,org INTEGER NOT NULL,agent_id TEXT REFERENCES agents(id),tool TEXT NOT NULL,amount INTEGER NOT NULL,cost INTEGER NOT NULL,status TEXT NOT NULL,reason TEXT NOT NULL,payload TEXT NOT NULL,request_key TEXT NOT NULL,created INTEGER NOT NULL,decided_by INTEGER,UNIQUE(org,request_key));
 CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY,org INTEGER NOT NULL,request_id TEXT NOT NULL,event TEXT NOT NULL,actor TEXT NOT NULL,details TEXT NOT NULL,created INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS executions(request_id TEXT PRIMARY KEY,result TEXT NOT NULL);`);
  const audit = (
    org: number,
    id: string,
    event: string,
    actor: string,
    details: string,
  ) =>
    db
      .prepare(
        "INSERT INTO audit(org,request_id,event,actor,details,created) VALUES(?,?,?,?,?,?)",
      )
      .run(org, id, event, actor, details, Date.now());
  if (options.demo && !db.prepare("SELECT id FROM agents LIMIT 1").get())
    db.prepare("INSERT INTO agents VALUES(?,?,?,?,?,?,?)").run(
      randomUUID(),
      1,
      "Customer Support Agent",
      JSON.stringify(["ticket.read", "refund.issue"]),
      500,
      0,
      10,
    );
  app.get("/api/dashboard", (_req, res) => {
    const u: User = res.locals.user;
    res.json({
      agents: db
        .prepare("SELECT * FROM agents WHERE org=?")
        .all(u.org)
        .map((a) => ({ ...a, tools: JSON.parse(a.tools as string) })),
      requests: db
        .prepare(
          "SELECT r.*,a.name AS agent FROM requests r JOIN agents a ON r.agent_id=a.id WHERE r.org=? ORDER BY r.created DESC LIMIT 100",
        )
        .all(u.org),
      audit: db
        .prepare("SELECT * FROM audit WHERE org=? ORDER BY id DESC LIMIT 100")
        .all(u.org),
    });
  });
  app.post("/api/agents", admin, (req, res) => {
    const b = z
      .object({
        name: z.string().trim().min(2).max(80),
        tools: z.array(z.enum(["ticket.read", "refund.issue"])).min(1),
        budget: z.number().int().min(1).max(100000),
        rateLimit: z.number().int().min(1).max(100),
      })
      .parse(req.body);
    const id = randomUUID();
    db.prepare("INSERT INTO agents VALUES(?,?,?,?,?,?,?)").run(
      id,
      res.locals.user.org,
      b.name,
      JSON.stringify(b.tools),
      b.budget,
      0,
      b.rateLimit,
    );
    res.status(201).json({ id });
  });
  app.post("/api/requests", admin, (req, res) => {
    const b = z
      .object({
        agentId: z.string().uuid(),
        tool: z.string().min(1).max(80),
        amount: z.number().int().min(0).max(1000000).default(0),
        requestKey: z.string().min(8).max(100),
        payload: z.record(z.string(), z.unknown()).default({}),
      })
      .parse(req.body);
    const u: User = res.locals.user;
    const result = atomic(db, () => {
      const existing = db
        .prepare("SELECT * FROM requests WHERE org=? AND request_key=?")
        .get(u.org, b.requestKey);
      if (existing) {
        ensure(
          existing.agent_id === b.agentId &&
            existing.tool === b.tool &&
            existing.amount === b.amount &&
            existing.payload === JSON.stringify(redact(b.payload)),
          409,
          "Idempotency key already used for different input",
        );
        return existing;
      }
      const a = db
        .prepare("SELECT * FROM agents WHERE id=? AND org=?")
        .get(b.agentId, u.org);
      ensure(a, 404, "Agent not found");
      const cost = b.tool === "refund.issue" ? 5 : 1;
      let status = "allowed",
        reason = "Policy checks passed";
      const count = db
        .prepare(
          "SELECT count(*) AS n FROM requests WHERE agent_id=? AND created>?",
        )
        .get(b.agentId, Date.now() - 60000)!.n as number;
      if (!JSON.parse(a.tools as string).includes(b.tool)) {
        status = "denied";
        reason = "Tool is not allowed for this agent";
      } else if (count >= Number(a.rate_limit)) {
        status = "denied";
        reason = "Per-minute request limit reached";
      } else if (Number(a.spent) + cost > Number(a.budget)) {
        status = "denied";
        reason = "Agent budget exhausted";
      } else if (b.tool === "refund.issue" && b.amount > 10000) {
        status = "pending";
        reason = "Refund over PKR 100 requires administrator approval";
      }
      const id = randomUUID();
      db.prepare("INSERT INTO requests VALUES(?,?,?,?,?,?,?,?,?,?,?,?)").run(
        id,
        u.org,
        b.agentId,
        b.tool,
        b.amount,
        cost,
        status,
        reason,
        JSON.stringify(redact(b.payload)),
        b.requestKey,
        Date.now(),
        null,
      );
      // Reserve credits for pending approvals to prevent oversubscription.
      if (status !== "denied")
        db.prepare("UPDATE agents SET spent=spent+? WHERE id=?").run(
          cost,
          b.agentId,
        );
      audit(u.org, id, "policy." + status, u.email, reason);
      return db.prepare("SELECT * FROM requests WHERE id=?").get(id);
    });
    res.status(201).json(result);
  });
  app.post("/api/requests/:id/decision", admin, (req, res) => {
    const b = z
      .object({ decision: z.enum(["approved", "rejected"]) })
      .parse(req.body);
    const u: User = res.locals.user;
    const result = atomic(db, () => {
      const r = db
        .prepare("SELECT * FROM requests WHERE id=? AND org=?")
        .get(String(req.params.id), u.org);
      ensure(r, 404, "Request not found");
      ensure(
        r.status === "pending",
        409,
        "Only pending requests can be decided",
      );
      db.prepare(
        "UPDATE requests SET status=?,decided_by=?,reason=? WHERE id=?",
      ).run(b.decision, u.id, "Administrator " + b.decision, r.id as string);
      if (b.decision === "rejected")
        db.prepare("UPDATE agents SET spent=spent-? WHERE id=?").run(
          r.cost as number,
          r.agent_id as string,
        );
      audit(
        u.org,
        r.id as string,
        "approval." + b.decision,
        u.email,
        "Administrator decision",
      );
      return { ok: true };
    });
    res.json(result);
  });
  app.post("/api/requests/:id/execute", admin, (req, res) => {
    const u: User = res.locals.user;
    const result = atomic(db, () => {
      const r = db
        .prepare("SELECT * FROM requests WHERE id=? AND org=?")
        .get(String(req.params.id), u.org);
      ensure(r, 404, "Request not found");
      const prior = db
        .prepare("SELECT result FROM executions WHERE request_id=?")
        .get(r.id as string);
      if (prior) return JSON.parse(prior.result as string);
      ensure(
        ["allowed", "approved"].includes(r.status as string),
        409,
        "Request must pass policy and approval before execution",
      );
      const result = {
        executionId: randomUUID(),
        mode: "simulation",
        tool: r.tool,
        message:
          r.tool === "ticket.read"
            ? "Synthetic ticket T-102 retrieved"
            : "Synthetic refund recorded; no money moved",
      };
      db.prepare("INSERT INTO executions VALUES(?,?)").run(
        r.id as string,
        JSON.stringify(result),
      );
      db.prepare("UPDATE requests SET status='executed' WHERE id=?").run(
        r.id as string,
      );
      audit(u.org, r.id as string, "tool.executed", u.email, result.message);
      return result;
    });
    res.json(result);
  });
  finish();
  return { app, db };
}

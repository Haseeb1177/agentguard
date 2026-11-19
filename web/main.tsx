import React, { useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { api, money } from "./api.js";
import "./style.css";
type User = { email: string; role: string };
function App() {
  const [user, setUser] = useState<User | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const [data, setData] = useState<any>(null);
  const refresh = async () => setData(await api("/dashboard"));
  useEffect(() => {
    api("/me")
      .then(async (u) => {
        setUser(u);
        await refresh();
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);
  async function action(
    fn: () => Promise<unknown>,
    message = "Saved successfully",
  ) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
      await refresh();
      setNotice(message);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (loading) return <div className="login">Loading workspace…</div>;
  if (!user)
    return (
      <div className="login">
        <div className="brand">
          AgentGuard<span style={{ color: "#637b90" }}> /</span>
        </div>
        <h1>Welcome back.</h1>
        <p>Review every action. Keep agents accountable.</p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            setBusy(true);
            setError("");
            try {
              const u = await api("/login", Object.fromEntries(f));
              setUser(u);
              await refresh();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            Email
            <input
              type="email"
              name="email"
              defaultValue="admin@demo.local"
              required
            />
          </label>
          <label>
            Password
            <input
              type="password"
              name="password"
              required
              autoComplete="current-password"
            />
          </label>
          <button disabled={busy}>
            {busy ? "Signing in…" : "Sign in to workspace →"}
          </button>
        </form>
        {error && (
          <div role="alert" className="notice error">
            {error}
          </div>
        )}
        <p className="muted">
          Local demo: admin@demo.local
          <br />
          Password: PortfolioDemo!2026
          <br />
          Read-only account: viewer@demo.local
        </p>
      </div>
    );
  const readOnly = user.role !== "admin";
  return (
    <div className="layout">
      <aside>
        <div className="brand">
          AgentGuard<span style={{ color: "#637b90" }}> /</span>
        </div>
        <div className="nav">
          <div>◈ &nbsp; Agent operations</div>
        </div>
        <p className="aside-note">
          Policy checks, approval gates and an auditable record of every
          simulated action.
        </p>
        <p className="user">
          {user.email}
          <br />
          {user.role} workspace
        </p>
        <button
          className="secondary"
          onClick={async () => {
            await api("/logout", {});
            setUser(null);
            setData(null);
          }}
        >
          Sign out
        </button>
      </aside>
      <main>
        <div className="top">
          <div>
            <div className="eyebrow">Control plane / overview</div>
            <h1>Agents, under control.</h1>
            <p style={{ margin: 0 }}>
              Know what your agents can do—and what they actually did.
            </p>
          </div>
          <span className="pill">● Simulation workspace</span>
        </div>
        {error && (
          <div role="alert" className="notice error">
            {error}
          </div>
        )}
        {notice && (
          <div role="status" className="notice">
            {notice}
          </div>
        )}
        {readOnly && (
          <p className="notice">
            Read-only access. An administrator can make changes.
          </p>
        )}
        {data ? (
          <>
            <div className="stats">
              <div className="stat">
                <span>Registered agents</span>
                <strong>{data.agents.length}</strong>
              </div>
              <div className="stat">
                <span>Awaiting approval</span>
                <strong>
                  {
                    data.requests.filter((r: any) => r.status === "pending")
                      .length
                  }
                </strong>
              </div>
              <div className="stat">
                <span>Blocked requests · last 100</span>
                <strong>
                  {
                    data.requests.filter((r: any) => r.status === "denied")
                      .length
                  }
                </strong>
              </div>
            </div>
            <div className="grid">
              <section>
                <div className="panel">
                  <h2>Test a tool request</h2>
                  <p className="muted">
                    Policies run before execution. Refunds above PKR 100 require
                    approval. Each request consumes 1 or 5 demo credits.
                  </p>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      const f = new FormData(e.currentTarget);
                      action(
                        () =>
                          api("/requests", {
                            agentId: f.get("agentId"),
                            tool: f.get("tool"),
                            amount: Math.round(Number(f.get("amount")) * 100),
                            requestKey: crypto.randomUUID(),
                            payload: { email: f.get("email") },
                          }),
                        "Request evaluated. Review its policy decision.",
                      );
                    }}
                  >
                    <label>
                      Agent
                      <select name="agentId" required>
                        {data.agents.map((a: any) => (
                          <option key={a.id} value={a.id}>
                            {a.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Tool
                      <select name="tool">
                        <option value="ticket.read">
                          Read a support ticket
                        </option>
                        <option value="refund.issue">
                          Issue a simulated refund
                        </option>
                        <option value="database.delete">
                          Delete database (blocked demo)
                        </option>
                      </select>
                    </label>
                    <label>
                      Refund amount · PKR
                      <input
                        name="amount"
                        type="number"
                        min="0"
                        max="10000"
                        step="0.01"
                        defaultValue="250"
                        required
                      />
                    </label>
                    <label>
                      Customer email · redacted from logs
                      <input
                        name="email"
                        type="email"
                        defaultValue="customer@example.com"
                        required
                      />
                    </label>
                    <button disabled={busy || readOnly || !data.agents.length}>
                      Evaluate request →
                    </button>
                  </form>
                </div>
                <div className="panel">
                  <h2>Agent policies</h2>
                  <div className="list">
                    {data.agents.map((a: any) => (
                      <div className="item" key={a.id}>
                        <strong>{a.name}</strong>
                        <p>{a.tools.join(" · ")}</p>
                        <p>
                          {a.spent} / {a.budget} credits reserved or used ·{" "}
                          {a.rate_limit} requests/min
                        </p>
                      </div>
                    ))}
                  </div>
                  <details style={{ marginTop: 20 }}>
                    <summary>Add an agent</summary>
                    <form
                      style={{ marginTop: 15 }}
                      onSubmit={(e) => {
                        e.preventDefault();
                        const f = new FormData(e.currentTarget);
                        action(() =>
                          api("/agents", {
                            name: f.get("name"),
                            tools:
                              f.get("tools") === "read"
                                ? ["ticket.read"]
                                : ["ticket.read", "refund.issue"],
                            budget: Number(f.get("budget")),
                            rateLimit: Number(f.get("rateLimit")),
                          }),
                        );
                      }}
                    >
                      <label>
                        Name
                        <input
                          name="name"
                          required
                          minLength={2}
                          maxLength={80}
                        />
                      </label>
                      <label>
                        Allowed tools
                        <select name="tools">
                          <option value="read">Read tickets only</option>
                          <option value="both">Read tickets + refunds</option>
                        </select>
                      </label>
                      <div className="row">
                        <label>
                          Credit budget
                          <input
                            name="budget"
                            type="number"
                            min="1"
                            max="100000"
                            defaultValue="100"
                            required
                          />
                        </label>
                        <label>
                          Requests/min
                          <input
                            name="rateLimit"
                            type="number"
                            min="1"
                            max="100"
                            defaultValue="10"
                            required
                          />
                        </label>
                      </div>
                      <button disabled={busy || readOnly}>Create agent</button>
                    </form>
                  </details>
                </div>
              </section>
              <section>
                <div className="panel">
                  <h2>Request activity</h2>
                  <div className="list">
                    {!data.requests.length && (
                      <div className="empty">
                        No requests yet. Evaluate your first tool request.
                      </div>
                    )}
                    {data.requests.map((r: any) => (
                      <div className="item" key={r.id}>
                        <div className="item-head">
                          <strong>{r.tool}</strong>
                          <span className={"tag " + r.status}>{r.status}</span>
                        </div>
                        <p>
                          {r.agent} · {new Date(r.created).toLocaleString()}
                        </p>
                        <p>{r.reason}</p>
                        <code>{r.payload}</code>
                        <div className="actions">
                          {r.status === "pending" && (
                            <>
                              <button
                                disabled={busy || readOnly}
                                onClick={() =>
                                  action(
                                    () =>
                                      api("/requests/" + r.id + "/decision", {
                                        decision: "approved",
                                      }),
                                    "Approved. Execute when ready.",
                                  )
                                }
                              >
                                Approve
                              </button>
                              <button
                                disabled={busy || readOnly}
                                className="danger"
                                onClick={() =>
                                  action(() =>
                                    api("/requests/" + r.id + "/decision", {
                                      decision: "rejected",
                                    }),
                                  )
                                }
                              >
                                Reject
                              </button>
                            </>
                          )}
                          {["allowed", "approved"].includes(r.status) && (
                            <button
                              disabled={busy || readOnly}
                              onClick={() =>
                                action(
                                  () =>
                                    api("/requests/" + r.id + "/execute", {}),
                                  "Simulated tool executed. No real money moved.",
                                )
                              }
                            >
                              Execute simulation
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="panel">
                  <h2>Audit trail</h2>
                  <div className="tablewrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Event</th>
                          <th>Actor</th>
                          <th>Time</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.audit.map((a: any) => (
                          <tr key={a.id}>
                            <td>{a.event}</td>
                            <td>{a.actor}</td>
                            <td>{new Date(a.created).toLocaleTimeString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {!data.audit.length && (
                    <p className="empty">
                      Policy decisions and execution events appear here.
                    </p>
                  )}
                </div>
              </section>
            </div>
          </>
        ) : (
          <p>Loading data…</p>
        )}
        <footer>
          Portfolio MVP · deterministic policies · synthetic tools · budgets use
          demo credits
        </footer>
      </main>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);

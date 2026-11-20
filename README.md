# AgentGuard

A policy and approval dashboard for simulated AI-agent tool calls.

Built with React, TypeScript, Express, Node.js 24 and SQLite. This portfolio MVP includes deployment configuration for a Vercel frontend and a Render API with persistent SQLite storage. Hosting must be provisioned separately.

## Run in three commands

Install **Node.js 24.x**, then open a terminal in this folder:

```sh
npm ci
npm run build
npm run demo
```

Open http://127.0.0.1:3000. Demo login:

- Administrator: `admin@demo.local`
- Read-only viewer: `viewer@demo.local`
- Password for both: `PortfolioDemo!2026`

These credentials are synthetic and intentionally public. Use demo mode only locally with synthetic data. Demo users are created only when the database is empty. Data persists in `data/app.sqlite` and is excluded from Git.

For development: `npm run dev` (Vite frontend on port 5173, API on 3000). Extra Vite options are forwarded: `npm run dev -- --port 5174 --strictPort`. For two projects at once, use a different `API_PORT` for the second dev server; in PowerShell: `$env:API_PORT="3001"; npm run dev -- --port 5174`. For the built app, use `PORT` instead.

## Verification

```sh
npm run build
npm test
```

Tests use real HTTP servers and isolated SQLite databases. They cover domain rules, authentication, roles, organization isolation, production configuration, origin checks, secure cookie attributes, proxy forwarding, restart persistence and graceful process shutdown. `.github/workflows/ci.yml` builds and tests on push and pull request. See [VERIFICATION.md](VERIFICATION.md) for results and limits.

## Deploy to Vercel + Render

Follow [DEPLOYMENT.md](DEPLOYMENT.md). The repository includes `vercel.mjs`, `render.yaml`, a Node version pin and production startup checks. This setup requires a **paid Render web service and persistent disk**. No MongoDB cluster or external API key is required. Keep backend credentials in Render environment settings.

## Architecture

```mermaid
flowchart TD
  A[React dashboard] --> B[Express API]
  B --> C[Session and role checks]
  C --> D[Validated domain operations]
  D --> E[SQLite transactions]
```

- `web/`: responsive dashboard and typed API helper.
- `src/base.ts`: password hashing, expiring sessions, request protection and role checks.
- `src/app.ts`: domain routes and transactional persistence.
- `src/config.ts`: deployment environment validation.
- `src/server.ts`: server startup, health-compatible binding and graceful shutdown.
- `tests/`: HTTP integration tests.

SQLite makes the demo self-contained. Organization IDs scope each domain query; tests cover cross-organization access. There is no organization signup or team invitation UI yet. Single-process execution and synchronous SQLite transactions keep the prototype small; PostgreSQL and a durable queue are future work for distributed deployment.

## Non-demo startup

Copy `.env.example` to `.env`, set a unique administrator email and a password of at least 16 characters, and choose a fresh `DB_PATH`. Then run `npm start`. Bootstrap credentials are only used for an empty database; editing the environment does not change an existing account password.

Public startup requires `NODE_ENV=production`, an absolute database path in an existing persistent directory, `APP_ORIGINS`, `ADMIN_EMAIL` and a unique `ADMIN_PASSWORD`. Demo startup and existing demo databases are rejected in production. The app has no password reset, MFA or account-management screens. See the deployment guide before exposing it publicly.

A Dockerfile is provided, but Docker execution was not verified in the build environment. It defaults to production startup and requires the production environment settings above plus a writable mounted `/app/data` volume. The supported hosted path in the guide uses Render’s native Node runtime.

## API conventions

All write requests need `Content-Type: application/json` and `X-Requested-With: portfolio-app`; production also requires an exact allowed `Origin`. Login sets an HttpOnly, SameSite=Strict cookie; other endpoints require that session. Mutations require the administrator role. API errors return `{"error":"..."}` and an appropriate HTTP status. The health endpoint is public.

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/login` | Sign in with email/password |
| GET | `/api/me` | Current user and role |
| POST | `/api/logout` | Revoke the current session |
| GET | `/api/dashboard` | Organization-scoped workspace data |

## Implemented features

- Per-agent tool allowlist, lifetime demo-credit budget and rolling one-minute request limit.
- Server-defined operation cost: 1 credit for reading, 5 for a refund.
- Refunds over PKR 100 require explicit administrator approval.
- Pending approvals reserve budget; rejecting them releases that reservation.
- Request idempotency keys and exactly-once simulated execution records.
- Nested sensitive-key redaction and email-pattern masking before payload persistence.
- Audit timeline for policy decisions, approvals and execution.

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/agents` | Name, tool allowlist, budget and rate limit |
| POST | `/api/requests` | Evaluate a tool request |
| POST | `/api/requests/:id/decision` | Approve or reject a pending request |
| POST | `/api/requests/:id/execute` | Execute an allowed/approved simulated tool |

### Example request

```json
{"agentId":"<agent UUID>","tool":"refund.issue","amount":25000,"requestKey":"<unique retry key>","payload":{"email":"customer@example.com"}}
```

Amounts are integer paisa: `25000` means PKR 250. Reuse the same request key and input for a retry. A different operational input returns 409. Payloads are compared after redaction; secrets discarded by redaction are not retained for comparison.

### Two-minute interview demo

1. Sign in and evaluate `database.delete`: it is denied.
2. Submit a PKR 250 refund: it waits for approval.
3. Approve and execute: a synthetic refund record appears.
4. Show the redacted customer email, audit timeline and reserved/used credits.
5. Explain the idempotency and budget tests.

### Boundaries

All tools are synthetic. No LLM, external agent framework or payment gateway is connected, and no money is moved. Credits are demo policy units, not measured provider charges. Redaction is heuristic and is not comprehensive DLP. The audit log is stored in the application database and is not cryptographically tamper-evident. The same administrator can submit and approve a request; independent approver separation is future work. Policies are set at agent creation; policy editing, service API keys, an SDK, streaming telemetry and prompt-injection detection are not implemented.

### CV description

Developed a TypeScript agent-control prototype with tool allowlists, approval gates, transactional budget reservations, redacted audit logs, and idempotent simulated execution.

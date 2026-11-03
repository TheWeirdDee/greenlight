// Local verification stack. NOT used in production.
//
//   - Postgres: a real PostgreSQL server (embedded-postgres binaries) running the project's real
//     migrations, so the app's postgres.js adapter, row locks and concurrency behave as they would on Supabase.
//   - Auth: a minimal stand-in for the Supabase Auth (GoTrue) endpoints that @supabase/ssr calls
//     (signup, password sign-in, refresh, user, logout), issuing signed JWTs.
//
// It exists so the complete browser workflow can be exercised without a Supabase project. It is a
// local test double, and results from it are reported as such — not as Supabase verification.
import { createHash, createHmac, randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import http from "node:http";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import EmbeddedPostgres from "embedded-postgres";

const DB_PORT = Number(process.env.E2E_DB_PORT ?? 54329);
const AUTH_PORT = Number(process.env.E2E_AUTH_PORT ?? 54330);
const JWT_SECRET = "local-e2e-secret-not-for-production";

const server = new EmbeddedPostgres({
  databaseDir: mkdtempSync(join(tmpdir(), "greenlight-e2e-pg-")),
  user: "postgres",
  password: "postgres",
  port: DB_PORT,
  persistent: false,
  initdbFlags: ["--encoding=UTF8", "--locale=C"],
});
await server.initialise();
await server.start();
const client = server.getPgClient();
await client.connect();
// Same shape the app expects from Supabase: an auth schema, auth.uid() and the standard roles.
const pg = { exec: (text) => client.query(text), query: (text, params) => client.query(text, params) };
await pg.exec(`
  create schema if not exists auth;
  create table auth.users (id uuid primary key, email text unique not null, password_hash text not null, meta jsonb not null default '{}', created_at timestamptz not null default now());
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  do $$ begin
    if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  end $$;
`);
const migrations = join(process.cwd(), "supabase", "migrations");
// Same sequence as scripts/migrate.mjs: bootstrap (role + schema), then each migration in a transaction.
await pg.exec(readFileSync(join(process.cwd(), "supabase", "bootstrap.sql"), "utf8"));
for (const f of readdirSync(migrations).filter((n) => n.endsWith(".sql")).sort()) {
  await pg.exec("begin");
  try {
    await pg.exec(readFileSync(join(migrations, f), "utf8"));
    await pg.exec("commit");
  } catch (e) {
    await pg.exec("rollback");
    throw e;
  }
}
await pg.exec("alter role greenlight_app login password 'e2e'"); // the app logs in as this role, never as postgres

// ── JWT helpers ──────────────────────────────────────────────────────────────────────────
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const sign = (payload) => {
  const head = b64({ alg: "HS256", typ: "JWT" });
  const body = b64(payload);
  return `${head}.${body}.${createHmac("sha256", JWT_SECRET).update(`${head}.${body}`).digest("base64url")}`;
};
const verify = (jwt) => {
  const [h, b, s] = jwt.split(".");
  if (!h || !b || !s) return null;
  const expected = createHmac("sha256", JWT_SECRET).update(`${h}.${b}`).digest("base64url");
  if (expected !== s) return null;
  const payload = JSON.parse(Buffer.from(b, "base64url").toString());
  return payload.exp * 1000 > Date.now() ? payload : null;
};
const hashPw = (p) => createHash("sha256").update(`pw:${p}`).digest("hex");

const refreshTokens = new Map();
const userJson = (u) => ({
  id: u.id,
  aud: "authenticated",
  role: "authenticated",
  email: u.email,
  email_confirmed_at: u.created_at,
  phone: "",
  confirmed_at: u.created_at,
  last_sign_in_at: new Date().toISOString(),
  app_metadata: { provider: "email", providers: ["email"] },
  user_metadata: u.meta ?? {},
  identities: [],
  created_at: u.created_at,
  updated_at: u.created_at,
});
const session = (u) => {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + 3600;
  const access_token = sign({
    aud: "authenticated", exp, iat: now, sub: u.id, email: u.email, phone: "", role: "authenticated", aal: "aal1", amr: [{ method: "password", timestamp: now }],
    session_id: randomUUID(), app_metadata: { provider: "email", providers: ["email"] }, user_metadata: u.meta ?? {}, is_anonymous: false,
  });
  const refresh_token = randomUUID().replace(/-/g, "").slice(0, 12);
  refreshTokens.set(refresh_token, u.id);
  return { access_token, token_type: "bearer", expires_in: 3600, expires_at: exp, refresh_token, user: userJson(u) };
};

const rowToUser = (r) => ({ id: r.id, email: r.email, meta: r.meta, created_at: new Date(r.created_at).toISOString() });
const findByEmail = async (email) => (await pg.query("select * from auth.users where email = $1", [email.toLowerCase()])).rows[0];
const findById = async (id) => (await pg.query("select * from auth.users where id = $1", [id])).rows[0];

const readBody = (req) => new Promise((res) => { let d = ""; req.on("data", (c) => (d += c)); req.on("end", () => res(d ? JSON.parse(d) : {})); });
const send = (res, status, body) => {
  res.writeHead(status, {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "*",
    "access-control-allow-methods": "GET,POST,PUT,DELETE,OPTIONS",
  });
  res.end(body === undefined ? "" : JSON.stringify(body));
};
const authError = (res, status, code, msg) => send(res, status, { code: status, error_code: code, msg, error: code, error_description: msg });

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    if (req.method === "OPTIONS") return send(res, 204);
    try {
      if (url.pathname === "/health") return send(res, 200, { ok: true });

      if (url.pathname === "/auth/v1/signup" && req.method === "POST") {
        const { email, password, data } = await readBody(req);
        if (!email || !password || password.length < 8) return authError(res, 422, "weak_password", "Password should be at least 8 characters.");
        if (await findByEmail(email)) return authError(res, 422, "user_already_exists", "User already registered");
        const id = randomUUID();
        await pg.query("insert into auth.users (id, email, password_hash, meta) values ($1, $2, $3, $4::jsonb)", [id, email.toLowerCase(), hashPw(password), JSON.stringify(data ?? {})]);
        return send(res, 200, session(rowToUser(await findById(id))));
      }

      if (url.pathname === "/auth/v1/token" && req.method === "POST") {
        const grant = url.searchParams.get("grant_type");
        const body = await readBody(req);
        if (grant === "password") {
          const u = await findByEmail(body.email ?? "");
          if (!u || u.password_hash !== hashPw(body.password ?? "")) return authError(res, 400, "invalid_credentials", "Invalid login credentials");
          return send(res, 200, session(rowToUser(u)));
        }
        if (grant === "refresh_token") {
          const uid = refreshTokens.get(body.refresh_token);
          const u = uid && (await findById(uid));
          if (!u) return authError(res, 400, "refresh_token_not_found", "Invalid Refresh Token");
          return send(res, 200, session(rowToUser(u)));
        }
      }

      if (url.pathname === "/auth/v1/user" && req.method === "GET") {
        const claims = verify((req.headers.authorization ?? "").replace(/^Bearer /i, ""));
        const u = claims && (await findById(claims.sub));
        if (!u) return authError(res, 401, "bad_jwt", "invalid JWT");
        return send(res, 200, userJson(rowToUser(u)));
      }

      if (url.pathname === "/auth/v1/logout") return send(res, 204);
      if (url.pathname === "/auth/v1/.well-known/jwks.json") return send(res, 200, { keys: [] });
      return send(res, 404, { error: "not_found" });
    } catch (e) {
      console.error("[auth-stub]", e);
      return send(res, 500, { error: "stub_error", message: String(e) });
    }
  })
  .listen(AUTH_PORT, "127.0.0.1", () => console.log(`E2E stack ready: postgres :${DB_PORT}, auth :${AUTH_PORT}`));

const shutdown = async () => {
  try {
    await client.end();
    await server.stop();
  } finally {
    process.exit(0);
  }
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

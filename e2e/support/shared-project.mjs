// Rehearses Greenlight's database rollout against a simulated *shared* Supabase project.
//
//   node e2e/support/shared-project.mjs
//
// Boots a real PostgreSQL server and shapes it like a live project that already hosts another app:
// another app's `public.profiles` / `workspaces` / `launches` tables holding data, a trigger on the
// shared `auth.users`, the `supabase_realtime` publication, and an administrator that — like Supabase's
// `postgres` role — can create roles but is NOT a superuser. Then it runs the real scripts
// (audit → dry-run → migrate → migrate again) and proves the existing application is untouched.
//
// This is a rehearsal on a local database. It is not evidence about the real Supabase project.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import postgres from "postgres";

const free = () =>
  new Promise((res) => {
    const s = net.createServer().listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => res(port));
    });
  });
const port = await free();
const pg = new EmbeddedPostgres({
  databaseDir: mkdtempSync(join(tmpdir(), "greenlight-shared-")),
  user: "postgres",
  password: "postgres",
  port,
  persistent: false,
  initdbFlags: ["--encoding=UTF8", "--locale=C"],
  onLog: () => {},
  onError: () => {},
});
await pg.initialise();
await pg.start();

const checks = [];
const check = (name, ok, detail = "") => {
  checks.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

const su = postgres(`postgres://postgres:postgres@127.0.0.1:${port}/postgres`, { max: 1, onnotice: () => {} });
try {
  // ── Shape the "existing project" ─────────────────────────────────────────────────────────
  await su.unsafe(`
    create schema auth;
    create table auth.users (id uuid primary key default gen_random_uuid(), email text);
    create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
    do $$ begin
      create role anon nologin; create role authenticated nologin; create role service_role nologin;
    end $$;
    -- another application, using the very names Greenlight would otherwise collide with
    create table public.profiles (id uuid primary key, handle text not null);
    create table public.workspaces (id serial primary key, title text);
    create table public.launches (id serial primary key, name text, secret text);
    insert into public.profiles values (gen_random_uuid(), 'alice'), (gen_random_uuid(), 'bob');
    insert into public.workspaces (title) values ('their workspace');
    insert into public.launches (name, secret) values ('their launch', 'do-not-touch');
    -- another app's trigger on the shared users table
    create function public.on_new_user() returns trigger language plpgsql as $$ begin insert into public.profiles values (new.id, 'auto'); return new; end $$;
    create trigger other_app_on_signup after insert on auth.users for each row execute function public.on_new_user();
    create publication supabase_realtime;
    -- an administrator like Supabase's: can create roles, is not a superuser
    create role supa_admin login password 'admin' createrole createdb;
    grant all on schema public to supa_admin;
    grant all on all tables in schema public to supa_admin;
    grant usage on schema auth to supa_admin;
    grant create on database postgres to supa_admin; -- Supabase's postgres role owns its database
    alter publication supabase_realtime owner to supa_admin;
  `);
  const fingerprint = async () => {
    const rows = await su.unsafe(`select 'profiles' t, count(*)::int n, md5(string_agg(handle, ',' order by handle)) h from public.profiles
      union all select 'workspaces', count(*)::int, md5(string_agg(title, ',')) from public.workspaces
      union all select 'launches', count(*)::int, md5(string_agg(name || secret, ',')) from public.launches`);
    return createHash("sha256").update(JSON.stringify(rows)).digest("hex");
  };
  const before = await fingerprint();
  const trgBefore = (await su.unsafe(`select count(*)::int n from pg_trigger where tgname = 'other_app_on_signup'`))[0].n;

  const env = {
    ...process.env,
    MIGRATION_DATABASE_URL: `postgres://supa_admin:admin@127.0.0.1:${port}/postgres`,
    GREENLIGHT_DB_PASSWORD: "a-generated-secret-for-greenlight-app",
    NEXT_PUBLIC_SUPABASE_URL: "",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "",
  };
  const run = (script, ...args) => spawnSync("node", [join("scripts", script), ...args], { env, encoding: "utf8" });

  // ── Audit (read-only) ─────────────────────────────────────────────────────────────────────
  const audit = run("audit.mjs");
  check("audit reports compatible", /VERDICT: compatible/.test(audit.stdout), audit.status === 0 ? "" : audit.stdout + audit.stderr);
  check("audit warns about the other app's trigger on auth.users", /other_app_on_signup/.test(audit.stdout));
  check("audit changed nothing", (await su.unsafe(`select count(*)::int n from pg_namespace where nspname = 'greenlight'`))[0].n === 0);

  // ── Dry run ───────────────────────────────────────────────────────────────────────────────
  const dry = run("migrate.mjs", "--dry-run");
  check("dry run succeeds", dry.status === 0 && /Dry run complete/.test(dry.stdout), dry.status === 0 ? "" : dry.stdout + dry.stderr);
  check("dry run left no schema", (await su.unsafe(`select count(*)::int n from pg_namespace where nspname = 'greenlight'`))[0].n === 0);
  check("dry run left no role", (await su.unsafe(`select count(*)::int n from pg_roles where rolname = 'greenlight_app'`))[0].n === 0);

  // ── Real migration, then again ────────────────────────────────────────────────────────────
  const m1 = run("migrate.mjs");
  check("migration applies", m1.status === 0 && /Applied 1 migration/.test(m1.stdout), m1.status === 0 ? "" : m1.stdout + m1.stderr);
  const m2 = run("migrate.mjs");
  check("re-running is a no-op", m2.status === 0 && /up to date/.test(m2.stdout), m2.stdout.trim().split("\n").pop());

  // ── Nothing else changed ──────────────────────────────────────────────────────────────────
  check("other app's data is byte-identical", (await fingerprint()) === before);
  check("other app's trigger still present", (await su.unsafe(`select count(*)::int n from pg_trigger where tgname = 'other_app_on_signup'`))[0].n === trgBefore);
  const stray = await su.unsafe(`select schemaname || '.' || tablename as t from pg_tables where tableowner = 'greenlight_app' and schemaname <> 'greenlight'`);
  check("no Greenlight objects outside the greenlight schema", stray.length === 0, stray.map((r) => r.t).join(", "));
  const pubTables = (await su.unsafe(`select schemaname || '.' || tablename as t from pg_publication_tables where pubname = 'supabase_realtime' order by 1`)).map((r) => r.t);
  check("realtime publication gained only Greenlight's two tables", JSON.stringify(pubTables) === JSON.stringify(["greenlight.events", "greenlight.launches"]), pubTables.join(", "));

  // ── The app's own login ───────────────────────────────────────────────────────────────────
  const app = postgres(`postgres://greenlight_app:a-generated-secret-for-greenlight-app@127.0.0.1:${port}/postgres`, { max: 1, onnotice: () => {} });
  try {
    const [{ search_path: sp }] = await app`show search_path`;
    check("app role logs in with the SCRAM password and resolves names to greenlight", sp === "greenlight", sp);
    check("app role sees its own empty launches table, not the other app's", (await app`select count(*)::int n from launches`)[0].n === 0);
    let denied = false;
    try { await app.unsafe("select secret from public.launches"); } catch (e) { denied = /permission denied/.test(e.message); }
    check("app role cannot read the other app's table", denied);
    denied = false;
    try { await app.unsafe("select * from auth.users"); } catch (e) { denied = /permission denied/.test(e.message); }
    check("app role cannot read shared auth data", denied);
  } finally {
    await app.end();
  }
  // a Greenlight sign-up fires the other app's trigger (documented side effect), never Greenlight's schema
  await su.unsafe(`insert into auth.users (email) values ('x@example.test')`);
  check("shared-Auth side effect is the other app's alone (greenlight.profiles untouched)", (await su.unsafe(`select count(*)::int n from greenlight.profiles`))[0].n === 0);
} finally {
  await su.end();
  await pg.stop();
}
console.log(`\n${checks.filter(Boolean).length}/${checks.length} checks passed`);
process.exit(checks.every(Boolean) ? 0 : 1);

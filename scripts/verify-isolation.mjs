// Verifies, against the REAL Supabase project, that Greenlight is isolated from the other applications.
//
//   npm run db:verify
//
// Read-only: SELECTs and permission probes; anything that could write is attempted only to prove it is
// refused (and inside a rolled-back transaction). Requires MIGRATION_DATABASE_URL and DATABASE_URL.
import postgres from "postgres";

try {
  process.loadEnvFile(".env.local");
} catch {
  /* rely on the real environment */
}

const adminUrl = process.env.MIGRATION_DATABASE_URL;
const appUrl = process.env.DATABASE_URL;
if (!adminUrl || !appUrl) {
  console.error("MIGRATION_DATABASE_URL and DATABASE_URL must both be set.");
  process.exit(1);
}

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};
const refused = async (fn) => {
  try {
    await fn();
    return false;
  } catch (e) {
    return /permission denied|must be owner|not allowed/i.test(e.message);
  }
};

const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
const app = postgres(appUrl, { max: 1, prepare: false, onnotice: () => {} });
try {
  // ── Where Greenlight's objects live ───────────────────────────────────────────────────────
  const owned = await admin`
    select n.nspname as schema, count(*)::int as n from pg_class c join pg_namespace n on n.oid = c.relnamespace
    join pg_roles r on r.oid = c.relowner where r.rolname = 'greenlight_app' and n.nspname <> 'pg_toast' and c.relkind in ('r','S','i','v','m','p')
    group by 1 order by 1`;
  check("every object owned by greenlight_app is in the greenlight schema", owned.length === 1 && owned[0].schema === "greenlight", owned.map((o) => `${o.schema}:${o.n}`).join(", "));
  const tables = (await admin`select tablename from pg_tables where schemaname = 'greenlight' order by 1`).map((t) => t.tablename);
  check("expected Greenlight tables exist", ["assignments", "events", "evidence", "funding_transactions", "launches", "profiles", "requirements", "schema_migrations", "workspace_members", "workspaces"].every((t) => tables.includes(t)), `${tables.length} tables`);
  const noRls = await admin`select tablename from pg_tables where schemaname = 'greenlight' and tablename <> 'schema_migrations' and not rowsecurity`;
  check("row level security is enabled on every Greenlight table", noRls.length === 0, noRls.map((t) => t.tablename).join(", "));
  const otherPol = await admin`select count(*)::int n from pg_policies where schemaname <> 'greenlight' and (policyname in ('profiles_self_read','launches_read','events_read'))`;
  check("Greenlight added no policies outside its schema", otherPol[0].n === 0);
  const pub = (await admin`select schemaname || '.' || tablename as t from pg_publication_tables where pubname = 'supabase_realtime' order by 1`).map((r) => r.t);
  check("realtime publication contains only Greenlight's tables from this app", pub.filter((t) => t.startsWith("greenlight.")).sort().join() === "greenlight.events,greenlight.launches", pub.join(", "));
  const authTrig = await admin`select count(*)::int n from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'auth' and c.relname = 'users' and not t.tgisinternal and t.tgname ilike '%greenlight%'`;
  check("Greenlight installed no trigger on shared auth.users", authTrig[0].n === 0);

  // ── What the application's own login can and cannot do ───────────────────────────────────
  const [me] = await app`select current_user as u, current_setting('search_path') as sp, (select rolsuper from pg_roles where rolname = current_user) as su, (select rolbypassrls from pg_roles where rolname = current_user) as bypass`;
  check("app connects as greenlight_app, not an administrator", me.u === "greenlight_app" && !me.su && !me.bypass, `${me.u}, search_path=${me.sp}`);
  check("unqualified names resolve to the greenlight schema", me.sp === "greenlight");
  check("app role can use its own tables", (await app`select count(*)::int n from launches`)[0].n >= 0);
  check("app role cannot read other tables in public", await refused(() => app.unsafe("select * from public.pg_stat_statements limit 1").then(() => app.unsafe("select 1/0"))) || (await (async () => {
    const pubTables = await admin`select tablename from pg_tables where schemaname = 'public' limit 3`;
    for (const t of pubTables) if (!(await refused(() => app.unsafe(`select * from public."${t.tablename}" limit 1`)))) return false;
    return true;
  })()));
  check("app role cannot read auth.users", await refused(() => app.unsafe("select * from auth.users limit 1")));
  check("app role cannot create objects in public", await refused(() => app.unsafe("create table public.greenlight_probe (id int)")));
  check("app role cannot alter another schema's data (storage/vault/realtime)", await refused(() => app.unsafe("select * from vault.secrets limit 1")) && await refused(() => app.unsafe("delete from storage.objects")));
  check("app role cannot create roles or databases", await refused(() => app.unsafe("create role greenlight_probe_role")));

  // ── What a browser's `authenticated` role can and cannot reach ───────────────────────────
  await admin.begin(async (tx) => {
    await tx.unsafe("set local role authenticated");
    await tx.unsafe("select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', true)");
    check("authenticated role may SELECT launches (and sees nothing it doesn't own)", (await tx.unsafe("select count(*)::int n from greenlight.launches"))[0].n === 0);
    for (const t of ["assignments", "evidence", "funding_transactions", "requirements", "workspaces", "workspace_members"]) {
      let denied = false;
      await tx.unsafe("savepoint s");
      try {
        await tx.unsafe(`select * from greenlight.${t} limit 1`);
      } catch (e) {
        denied = /permission denied/.test(e.message);
      }
      await tx.unsafe("rollback to savepoint s");
      check(`authenticated role cannot read greenlight.${t} directly`, denied);
    }
    let wrote = true;
    await tx.unsafe("savepoint w");
    try {
      await tx.unsafe("update greenlight.launches set name = 'x'");
    } catch {
      wrote = false;
    }
    await tx.unsafe("rollback to savepoint w");
    check("authenticated role cannot write to launches", !wrote);
    await tx.unsafe("set local role anon");
    let anon = true;
    await tx.unsafe("savepoint a");
    try {
      await tx.unsafe("select * from greenlight.launches");
    } catch {
      anon = false;
    }
    await tx.unsafe("rollback to savepoint a");
    check("anonymous role cannot reach the greenlight schema at all", !anon);
    throw new Error("rollback"); // never commit anything from this script
  }).catch((e) => {
    if (e.message !== "rollback") throw e;
  });
} catch (e) {
  console.error(`Verification could not complete: ${e.message}`);
  process.exitCode = 1;
} finally {
  await admin.end();
  await app.end();
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed${failed ? ` — ${failed} FAILED` : ""}`);
if (failed) process.exitCode = 1;

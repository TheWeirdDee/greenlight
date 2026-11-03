// Read-only compatibility audit of the Supabase project Greenlight will share with other apps.
//
//   npm run db:audit
//
// Makes no changes: SELECTs against catalogs, plus (if the publishable key is set) one GET of the
// project's public Auth settings. Prints a verdict and the exact blockers, if any.
import postgres from "postgres";

try {
  process.loadEnvFile(".env.local");
} catch {
  /* rely on the real environment */
}

const url = process.env.MIGRATION_DATABASE_URL;
if (!url) {
  console.error("MIGRATION_DATABASE_URL is not set (the administrator connection string). See README → Supabase setup.");
  process.exit(1);
}

const sql = postgres(url, { max: 1, onnotice: () => {} });
const blockers = [];
const warnings = [];
const line = (k, v) => console.log(`${k.padEnd(34)} ${v}`);

try {
  const [{ version }] = await sql`select version()`;
  const [me] = await sql`select current_user as u, rolcreaterole, rolsuper from pg_roles where rolname = current_user`;
  line("server", version.split(",")[0]);
  line("connected as", `${me.u} (createrole=${me.rolcreaterole}, superuser=${me.rolsuper})`);
  if (!me.rolcreaterole && !me.rolsuper) blockers.push("The connected role cannot create roles. Connect as the `postgres` role (Project Settings → Database).");

  const [{ n: major }] = await sql`select current_setting('server_version_num')::int / 10000 as n`;
  if (major < 13) blockers.push(`PostgreSQL ${major} lacks gen_random_uuid(); 13+ is required.`);

  // Existing Greenlight objects (a previous partial run, or a name clash).
  const schema = await sql`select s.nspname, r.rolname as owner from pg_namespace s join pg_roles r on r.oid = s.nspowner where s.nspname = 'greenlight'`;
  const role = await sql`select rolname, rolcanlogin from pg_roles where rolname = 'greenlight_app'`;
  line("schema `greenlight`", schema.length ? `exists, owner ${schema[0].owner}` : "absent (will be created)");
  line("role `greenlight_app`", role.length ? `exists, login=${role[0].rolcanlogin}` : "absent (will be created)");
  if (schema.length && schema[0].owner !== "greenlight_app") {
    blockers.push(`Schema \`greenlight\` already exists and belongs to \`${schema[0].owner}\`, not Greenlight. Refusing to adopt it; choose another schema name.`);
  }
  if (schema.length) {
    const [{ n }] = await sql`select count(*)::int as n from information_schema.tables where table_schema = 'greenlight'`;
    line("tables already in greenlight", String(n));
  }

  // What is already here (informational: none of it is touched).
  const schemas = await sql`select nspname from pg_namespace where nspname !~ '^(pg_|information_schema$)' order by 1`;
  line("schemas present", schemas.map((s) => s.nspname).join(", "));
  const [{ n: publicTables }] = await sql`select count(*)::int as n from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'`;
  line("tables in public (untouched)", String(publicTables));

  // Shared Auth: triggers on auth.users run for *every* application's sign-ups, Greenlight's included.
  const triggers = await sql`
    select t.tgname, p.proname as fn, pn.nspname as fn_schema
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
    join pg_proc p on p.oid = t.tgfoid join pg_namespace pn on pn.oid = p.pronamespace
    where n.nspname = 'auth' and c.relname = 'users' and not t.tgisinternal`;
  line("triggers on auth.users", triggers.length ? triggers.map((t) => `${t.tgname}→${t.fn_schema}.${t.fn}`).join(", ") : "none");
  if (triggers.length) {
    warnings.push("Triggers on auth.users (above) belong to other applications and will also fire when someone signs up through Greenlight — for example creating a row in that app's own profile table. Greenlight does not modify them; review that this side effect is acceptable.");
  }

  const pub = await sql`select 1 from pg_publication where pubname = 'supabase_realtime'`;
  line("realtime publication", pub.length ? "present (Greenlight adds only its two tables)" : "absent (realtime push disabled; app polls)");

  // Public Auth settings, if the publishable key is available.
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (base && key) {
    try {
      const res = await fetch(`${base.replace(/\/$/, "")}/auth/v1/settings`, { headers: { apikey: key } });
      if (res.ok) {
        const s = await res.json();
        line("email sign-up enabled", String(!s.disable_signup && s.external?.email !== false));
        line("email confirmation required", String(!s.mailer_autoconfirm));
        if (s.disable_signup) blockers.push("Sign-ups are disabled project-wide, so no one can create a Greenlight account. This is a project setting; it needs your decision.");
        if (!s.mailer_autoconfirm) {
          warnings.push("Email confirmation is ON (project-wide). Greenlight supports it: sign-up shows 'check your inbox' and /auth/callback completes the session. The confirmation email uses the project's shared template and Site URL; add Greenlight's URL to Authentication → URL Configuration → Redirect URLs (additive) or confirmation links will land on another app's Site URL.");
        }
      } else {
        warnings.push(`Auth settings endpoint returned ${res.status}; check NEXT_PUBLIC_SUPABASE_URL / the publishable key.`);
      }
    } catch (e) {
      warnings.push(`Could not read Auth settings: ${e.message}`);
    }
  } else {
    line("auth settings", "skipped (set NEXT_PUBLIC_SUPABASE_URL and the publishable key to include them)");
  }
} catch (e) {
  console.error(`Audit failed: ${e.message}`);
  process.exitCode = 1;
} finally {
  await sql.end();
}

console.log("");
for (const w of warnings) console.log(`WARNING  ${w}\n`);
for (const b of blockers) console.log(`BLOCKER  ${b}\n`);
console.log(blockers.length ? "VERDICT: NOT SAFE to apply until the blockers above are resolved." : "VERDICT: compatible. Run `npm run db:migrate -- --dry-run` next, then `npm run db:migrate`.");
if (blockers.length) process.exitCode = 1;

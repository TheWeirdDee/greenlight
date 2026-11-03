// Applies Greenlight's database objects to a Supabase project, in isolation.
//
//   npm run db:migrate -- --dry-run   # applies everything inside a transaction, then ROLLS BACK
//   npm run db:migrate                # applies for real
//
// Reads (from the environment or .env.local):
//   MIGRATION_DATABASE_URL   administrator connection (the `postgres` role) — used only here, never by the app
//   GREENLIGHT_DB_PASSWORD   password for the `greenlight_app` role the deployed app logs in as
//
// What it does, in order: supabase/bootstrap.sql (creates the greenlight_app role and the greenlight
// schema), then every supabase/migrations/*.sql not yet recorded in greenlight.schema_migrations, each in
// its own transaction. Nothing outside the `greenlight` schema is created, altered or dropped; existing
// applications' tables, data, policies and Auth settings are not touched.
import { createHash, createHmac, pbkdf2Sync, randomBytes } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

try {
  process.loadEnvFile(".env.local");
} catch {
  /* no .env.local: rely on the real environment */
}

const dryRun = process.argv.includes("--dry-run");
const url = process.env.MIGRATION_DATABASE_URL;
if (!url) {
  console.error("MIGRATION_DATABASE_URL is not set (the administrator connection string). See README → Supabase setup.");
  process.exit(1);
}

/** PostgreSQL SCRAM-SHA-256 verifier, so the plaintext password never reaches the server or its logs. */
function scramVerifier(password) {
  const salt = randomBytes(16);
  const iterations = 4096;
  const salted = pbkdf2Sync(password, salt, iterations, 32, "sha256");
  const hmac = (key, msg) => createHmac("sha256", key).update(msg).digest();
  const storedKey = createHash("sha256").update(hmac(salted, "Client Key")).digest();
  const serverKey = hmac(salted, "Server Key");
  return `SCRAM-SHA-256$${iterations}:${salt.toString("base64")}$${storedKey.toString("base64")}:${serverKey.toString("base64")}`;
}

const sql = postgres(url, { max: 1, onnotice: (n) => console.log(`  notice: ${n.message}`) });
const root = process.cwd();
const migrationsDir = join(root, "supabase", "migrations");

class DryRunRollback extends Error {}

async function run(tx) {
  await tx.unsafe(readFileSync(join(root, "supabase", "bootstrap.sql"), "utf8"));
  console.log("bootstrap  role greenlight_app + schema greenlight ready");

  await tx.unsafe(`set local role greenlight_app; set local search_path = greenlight;
    create table if not exists greenlight.schema_migrations (name text primary key, applied_at timestamptz not null default now());
    reset role;`);
  const applied = new Set((await tx`select name from greenlight.schema_migrations`).map((r) => r.name));

  let ran = 0;
  for (const file of readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort()) {
    if (applied.has(file)) {
      console.log(`skip       ${file}`);
      continue;
    }
    await tx.unsafe(readFileSync(join(migrationsDir, file), "utf8"));
    await tx.unsafe(`set local role greenlight_app`);
    await tx`insert into greenlight.schema_migrations (name) values (${file})`;
    await tx.unsafe(`reset role`);
    console.log(`apply      ${file}`);
    ran += 1;
  }

  const password = process.env.GREENLIGHT_DB_PASSWORD;
  if (password) {
    await tx.unsafe(`alter role greenlight_app login password '${scramVerifier(password)}'`);
    console.log("role       greenlight_app can now log in (password set from GREENLIGHT_DB_PASSWORD)");
  } else {
    console.log("role       GREENLIGHT_DB_PASSWORD not set: greenlight_app cannot log in yet");
  }
  console.log(ran === 0 ? "Database is up to date." : `Applied ${ran} migration(s).`);
}

try {
  if (dryRun) {
    console.log("DRY RUN — everything below is rolled back at the end.\n");
    await sql
      .begin(async (tx) => {
        await run(tx);
        throw new DryRunRollback();
      })
      .catch((e) => {
        if (!(e instanceof DryRunRollback)) throw e;
      });
    console.log("\nDry run complete: the migration applies cleanly to this database. Nothing was changed.");
  } else {
    await sql.begin(run);
  }
} catch (e) {
  console.error(`Migration failed${dryRun ? " (dry run, nothing changed)" : " (rolled back)"}: ${e.message}`);
  process.exitCode = 1;
} finally {
  await sql.end();
}

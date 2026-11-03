// Applies supabase/migrations/*.sql to the database in DATABASE_URL, once each, in filename order.
//
//   DATABASE_URL="postgresql://postgres:<password>@db.<ref>.supabase.co:5432/postgres" npm run db:migrate
//
// Each migration runs in its own transaction and is recorded in public.schema_migrations, so the
// command is safe to re-run. Use Supabase's *direct* connection string (port 5432) or the session
// pooler for this step.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set. See README → Environment variables.");
  process.exit(1);
}

const sql = postgres(url, { max: 1, onnotice: () => {} });
const dir = join(process.cwd(), "supabase", "migrations");

try {
  await sql`create table if not exists public.schema_migrations (name text primary key, applied_at timestamptz not null default now())`;
  const applied = new Set((await sql`select name from public.schema_migrations`).map((r) => r.name));
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  let ran = 0;
  for (const file of files) {
    if (applied.has(file)) {
      console.log(`skip   ${file}`);
      continue;
    }
    await sql.begin(async (tx) => {
      await tx.unsafe(readFileSync(join(dir, file), "utf8"));
      await tx`insert into public.schema_migrations (name) values (${file})`;
    });
    console.log(`apply  ${file}`);
    ran += 1;
  }
  console.log(ran === 0 ? "Database is up to date." : `Applied ${ran} migration(s).`);
} catch (e) {
  console.error("Migration failed:", e.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}

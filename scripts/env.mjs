// Manages .env.local (git-ignored). Secrets are generated here and never printed.
//
//   node scripts/env.mjs init <project-ref>   create .env.local with the project URL and fresh secrets
//   node scripts/env.mjs compose              derive DATABASE_URL (the app's least-privilege login) from MIGRATION_DATABASE_URL
//   node scripts/env.mjs status               show which variables are set (values hidden)
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const FILE = ".env.local";
const [cmd, arg] = process.argv.slice(2);

const parse = (text) => Object.fromEntries(text.split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
const read = () => (existsSync(FILE) ? readFileSync(FILE, "utf8") : "");
const secret = () => randomBytes(32).toString("base64url");

function setVar(text, key, value) {
  const re = new RegExp(`^${key}=.*$`, "m");
  return re.test(text) ? text.replace(re, `${key}=${value}`) : `${text.replace(/\s*$/, "\n")}${key}=${value}\n`;
}

if (cmd === "init") {
  if (!arg || !/^[a-z0-9]{20}$/.test(arg)) {
    console.error("Usage: node scripts/env.mjs init <project-ref>   (the 20-character id in your Supabase dashboard URL)");
    process.exit(1);
  }
  if (existsSync(FILE)) {
    console.error(`${FILE} already exists; not overwriting. Use \`node scripts/env.mjs status\`.`);
    process.exit(1);
  }
  writeFileSync(
    FILE,
    `# Greenlight — local environment. Git-ignored. Never commit or share this file.
# Project: https://supabase.com/dashboard/project/${arg}

# 1) From Project Settings → API Keys: the PUBLISHABLE key (safe for browsers; starts with sb_publishable_).
NEXT_PUBLIC_SUPABASE_URL=https://${arg}.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=

# 2) From Connect → "Session pooler" (works on IPv4 networks): the connection string for the \`postgres\` role,
#    with your database password filled in. Used ONLY by \`npm run db:migrate\` / \`db:audit\`; the deployed app never gets it.
MIGRATION_DATABASE_URL=

# 3) Generated locally. Becomes the password of the dedicated \`greenlight_app\` role.
GREENLIGHT_DB_PASSWORD=${secret()}

# 4) Filled in by \`npm run env:compose\` — the app's own least-privilege connection (role greenlight_app).
DATABASE_URL=

# Generated locally. Authenticates the scheduled sweep.
CRON_SECRET=${secret()}
`,
  );
  console.log(`Created ${FILE} (project URL filled in; secrets generated, not shown).`);
  console.log("Next: add the publishable key and MIGRATION_DATABASE_URL, then run `npm run env:compose`.");
} else if (cmd === "compose") {
  const env = parse(read());
  if (!env.MIGRATION_DATABASE_URL || !env.GREENLIGHT_DB_PASSWORD) {
    console.error("Set MIGRATION_DATABASE_URL (and keep GREENLIGHT_DB_PASSWORD) in .env.local first.");
    process.exit(1);
  }
  let u;
  try {
    u = new URL(env.MIGRATION_DATABASE_URL);
  } catch {
    console.error("MIGRATION_DATABASE_URL is not a valid URL. Paste the full postgresql://… string (URL-encode special characters in the password).");
    process.exit(1);
  }
  if (!env.MIGRATION_DATABASE_URL.replace(/^postgres(ql)?:\/\//, "").split("@")[0].includes(":")) {
    console.error("MIGRATION_DATABASE_URL has no ':' between the username and password (expected postgresql://user:PASSWORD@host:port/db).");
    process.exit(1);
  }
  // Pooler usernames are `role.<project-ref>`; direct ones are just `role`.
  const ref = u.username.includes(".") ? u.username.split(".").slice(1).join(".") : "";
  u.username = ref ? `greenlight_app.${ref}` : "greenlight_app";
  u.password = env.GREENLIGHT_DB_PASSWORD;
  // The deployed app should use the transaction pooler (6543); the session pooler (5432) is for migrations.
  if (u.hostname.endsWith("pooler.supabase.com")) u.port = "6543";
  writeFileSync(FILE, setVar(read(), "DATABASE_URL", u.toString()));
  console.log(`DATABASE_URL set for role greenlight_app on ${u.hostname}:${u.port || "5432"} (password not shown).`);
} else if (cmd === "status") {
  const env = parse(read());
  for (const k of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "MIGRATION_DATABASE_URL", "GREENLIGHT_DB_PASSWORD", "DATABASE_URL", "CRON_SECRET"]) {
    const v = env[k];
    console.log(`${k.padEnd(40)} ${v ? (k === "NEXT_PUBLIC_SUPABASE_URL" ? v : "set") : "MISSING"}`);
  }
} else {
  console.error("Usage: node scripts/env.mjs init <project-ref> | compose | status");
  process.exit(1);
}

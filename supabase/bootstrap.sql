-- GREENLIGHT bootstrap: the only objects created outside the migrations. Idempotent.
--
-- Run by an administrator (the `postgres` role) before migrations — `npm run db:migrate` does it.
-- It creates exactly two things, both new and both Greenlight's own:
--   * the `greenlight_app` role (no login until `npm run db:migrate` sets a password for it), and
--   * the `greenlight` schema, owned by that role.
-- It reads, alters or deletes nothing that belongs to another application.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'greenlight_app') then
    create role greenlight_app nologin;
  end if;
end $$;

-- Lets the administrator create the migration's objects *as* greenlight_app (SET ROLE). PostgreSQL 16+
-- gives a role's creator ADMIN but not SET/INHERIT by default, so request them explicitly there.
do $$
begin
  if current_setting('server_version_num')::int >= 160000 then
    execute format('grant greenlight_app to %I with inherit true, set true', current_user);
  else
    execute format('grant greenlight_app to %I', current_user);
  end if;
end $$;

create schema if not exists greenlight authorization greenlight_app;

-- The role resolves unqualified names to its own schema only. Applies at login, so it also works
-- through Supabase's transaction pooler.
alter role greenlight_app set search_path = greenlight;

revoke all on schema greenlight from public;

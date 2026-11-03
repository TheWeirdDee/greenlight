-- GREENLIGHT core schema.
--
-- ISOLATION. Greenlight shares a Supabase project (and therefore Supabase Auth) with other
-- applications, so it never touches `public`. Everything lives in the `greenlight` schema, owned
-- by the dedicated `greenlight_app` role (both created by supabase/bootstrap.sql). The migration
-- creates objects *as* that role, so nothing here is owned by, or granted to, another application.
-- There is deliberately no foreign key into `auth.users`: that would require a privilege on the
-- shared auth schema, and profile rows are only ever created for a signature-verified session.
--
-- Access model: the Next.js server connects as `greenlight_app` (the table owner, so RLS does not
-- apply to it) and performs every write after verifying the caller's Supabase session. Row Level
-- Security is enabled on every table; the only policies grant *read* access to people who may see
-- a launch, so Supabase Realtime can push change notifications to the browser. There are no write
-- policies and no write grants: browsers cannot modify data directly.

set local role greenlight_app;
set local search_path = greenlight;

create table profiles (
  id uuid primary key,
  display_name text not null check (char_length(display_name) between 1 and 80),
  email text,
  created_at timestamptz not null default now()
);

create table workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  owner_id uuid not null references profiles (id),
  created_at timestamptz not null default now()
);

create type workspace_role as enum ('owner', 'contributor');

create table workspace_members (
  workspace_id uuid not null references workspaces (id) on delete cascade,
  user_id uuid not null references profiles (id) on delete cascade,
  role workspace_role not null,
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index workspace_members_user_idx on workspace_members (user_id);

create table launches (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  tagline text not null default '' check (char_length(tagline) <= 280),
  target_at timestamptz not null,
  -- Incremented by every mutation; lets readers detect a stale snapshot.
  rev bigint not null default 0,
  -- Last persisted readiness evaluation (derived, never edited by hand).
  readiness_state text not null default 'not_ready' check (readiness_state in ('ready', 'not_ready')),
  readiness_result jsonb,
  readiness_computed_at timestamptz,
  share_token text unique,
  decision text check (decision in ('proceed', 'proceed_override', 'hold')),
  decision_note text,
  decision_at timestamptz,
  decision_by uuid references profiles (id),
  decision_snapshot jsonb,
  created_by uuid not null references profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index launches_workspace_idx on launches (workspace_id);

create type requirement_kind as enum ('commitment', 'deliverable', 'url_check', 'funding');

create table requirements (
  id uuid primary key default gen_random_uuid(),
  launch_id uuid not null references launches (id) on delete cascade,
  position int not null default 0,
  title text not null check (char_length(title) between 1 and 140),
  description text not null default '' check (char_length(description) <= 1000),
  kind requirement_kind not null,
  mandatory boolean not null default true,
  deadline_at timestamptz,
  depends_on uuid[] not null default '{}',
  funding_chain_id int,
  funding_token text,
  funding_token_symbol text,
  funding_token_decimals int,
  funding_recipient text,
  funding_amount numeric(78, 0),
  funding_min_confirmations int,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint funding_fields_complete check (
    (kind = 'funding') = (funding_amount is not null and funding_token is not null
      and funding_recipient is not null and funding_chain_id is not null
      and funding_min_confirmations is not null and funding_token_decimals is not null)
  ),
  constraint funding_amount_positive check (funding_amount is null or funding_amount > 0)
);
create index requirements_launch_idx on requirements (launch_id);

create type assignment_state as enum ('standby', 'invited', 'accepted', 'confirmed', 'declined', 'released');

create table assignments (
  id uuid primary key default gen_random_uuid(),
  launch_id uuid not null references launches (id) on delete cascade,
  requirement_id uuid not null references requirements (id) on delete cascade,
  role text not null check (role in ('primary', 'backup')),
  label text not null check (char_length(label) between 1 and 120),
  user_id uuid references profiles (id),
  state assignment_state not null,
  -- SHA-256 of the invitation secret. The secret itself is only ever shown to the founder once.
  token_hash text unique,
  token_expires_at timestamptz,
  invited_at timestamptz,
  accepted_at timestamptz,
  confirmed_at timestamptz,
  declined_at timestamptz,
  decline_reason text,
  released_at timestamptz,
  released_reason text,
  created_by uuid not null references profiles (id),
  created_at timestamptz not null default now()
);
create index assignments_launch_idx on assignments (launch_id);
create index assignments_user_idx on assignments (user_id);
create unique index assignments_one_live_primary
  on assignments (requirement_id) where role = 'primary' and state <> 'released';
create unique index assignments_one_live_backup
  on assignments (requirement_id) where role = 'backup' and state <> 'released';

create table evidence (
  id uuid primary key default gen_random_uuid(),
  launch_id uuid not null references launches (id) on delete cascade,
  requirement_id uuid not null references requirements (id) on delete cascade,
  assignment_id uuid references assignments (id),
  submitted_by uuid not null references profiles (id),
  kind text not null check (kind in ('url', 'note')),
  value text not null check (char_length(value) between 1 and 2000),
  submitted_at timestamptz not null default now(),
  -- 'verified' is only ever set by a server-side check (e.g. fetching the URL), never by the submitter.
  verification text not null default 'unverified' check (verification in ('unverified', 'verified', 'failed')),
  verified_at timestamptz,
  verification_detail jsonb
);
create index evidence_requirement_idx on evidence (requirement_id);

create table funding_transactions (
  id uuid primary key default gen_random_uuid(),
  launch_id uuid not null references launches (id) on delete cascade,
  requirement_id uuid not null references requirements (id) on delete cascade,
  chain_id int not null,
  tx_hash text not null check (tx_hash ~ '^0x[0-9a-f]{64}$'),
  submitted_by uuid not null references profiles (id),
  status text not null check (status in ('pending', 'verified', 'rejected')),
  reason text,
  from_address text,
  to_address text,
  token_address text,
  amount numeric(78, 0),
  block_number bigint,
  -- On-chain block time: the moment the funds actually moved, used for deadline checks.
  block_timestamp timestamptz,
  confirmations int,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  -- A transaction can be credited at most once, ever: this is the duplicate-event guard.
  unique (chain_id, tx_hash)
);
create index funding_transactions_requirement_idx on funding_transactions (requirement_id);

create table events (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  launch_id uuid not null references launches (id) on delete cascade,
  type text not null,
  actor_id uuid references profiles (id),
  actor_label text not null,
  requirement_id uuid references requirements (id) on delete set null,
  payload jsonb not null default '{}',
  idempotency_key text,
  created_at timestamptz not null default now(),
  unique (launch_id, idempotency_key)
);
create index events_launch_seq_idx on events (launch_id, seq desc);

-- ── Row Level Security ──────────────────────────────────────────────────────────────────

alter table profiles enable row level security;
alter table workspaces enable row level security;
alter table workspace_members enable row level security;
alter table launches enable row level security;
alter table requirements enable row level security;
alter table assignments enable row level security;
alter table evidence enable row level security;
alter table funding_transactions enable row level security;
alter table events enable row level security;

-- A person may read a launch if they own its workspace or hold a live assignment on it.
-- The caller's id is passed in (policies evaluate auth.uid() as the querying role), so this
-- SECURITY DEFINER function needs no access to the shared `auth` schema.
create function gl_can_read_launch(p_launch uuid, p_user uuid) returns boolean
  language sql stable security definer set search_path = greenlight as $$
  select exists (
    select 1 from launches l
    join workspace_members m on m.workspace_id = l.workspace_id
    where l.id = p_launch and m.user_id = p_user and m.role = 'owner'
  ) or exists (
    select 1 from assignments a
    where a.launch_id = p_launch and a.user_id = p_user and a.state <> 'released'
  )
$$;
revoke all on function gl_can_read_launch(uuid, uuid) from public;
grant execute on function gl_can_read_launch(uuid, uuid) to authenticated;

-- The only browser-facing privileges: read access to the rows the policies below expose (Realtime
-- needs SELECT). No INSERT/UPDATE/DELETE is granted to any browser role, and the schema is not
-- exposed to PostgREST, so there is no REST path to this data at all.
grant usage on schema greenlight to authenticated;
grant select on profiles, launches, events to authenticated;

reset role;

-- Policies are created as the administrator, not as greenlight_app: a policy that mentions
-- auth.uid() is resolved with the creator's privileges, and greenlight_app deliberately has no
-- access to the shared `auth` schema. (The administrator is a member of greenlight_app, so it may
-- manage these tables.) At query time the policy runs as the calling role, which does have access.
create policy profiles_self_read on greenlight.profiles for select to authenticated using (id = auth.uid());
create policy launches_read on greenlight.launches for select to authenticated using (greenlight.gl_can_read_launch(id, auth.uid()));
create policy events_read on greenlight.events for select to authenticated using (greenlight.gl_can_read_launch(launch_id, auth.uid()));

-- Realtime: purely additive, scoped to Greenlight's own two tables. A failure here must not block the
-- migration — the app falls back to polling — but it is surfaced as a warning.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table greenlight.events, greenlight.launches;
    exception
      when duplicate_object then null;
      when others then raise warning 'Could not add Greenlight tables to supabase_realtime (%). Realtime pushes are disabled; the app will poll.', sqlerrm;
    end;
  end if;
end $$;

import type { Queryable } from "@/lib/db/types";
import { forbidden, notFound } from "@/lib/errors";

/**
 * Server-side authorization. Every service entry point calls one of these with the identity
 * taken from the verified Supabase session, never from request bodies.
 */

/** Founder access: the caller must be an owner of the launch's workspace. */
export async function requireLaunchOwner(q: Queryable, userId: string, launchId: string) {
  const rows = await q.query<{ role: string | null; workspace_id: string }>(
    `select l.workspace_id, m.role::text as role
     from launches l
     left join workspace_members m on m.workspace_id = l.workspace_id and m.user_id = $2
     where l.id = $1`,
    [launchId, userId],
  );
  if (rows.length === 0) throw notFound("Launch not found");
  if (rows[0].role === null) throw notFound("Launch not found"); // do not reveal existence to outsiders
  if (rows[0].role !== "owner") throw forbidden("Only the launch owner can do this");
  return { workspaceId: rows[0].workspace_id };
}

/** Read access to a launch's room: owners, or contributors with a live assignment on it. */
export async function requireLaunchParticipant(q: Queryable, userId: string, launchId: string) {
  const rows = await q.query<{ is_owner: boolean; is_assignee: boolean }>(
    `select
       exists (select 1 from launches l join workspace_members m on m.workspace_id = l.workspace_id
               where l.id = $1 and m.user_id = $2 and m.role = 'owner') as is_owner,
       exists (select 1 from assignments a
               where a.launch_id = $1 and a.user_id = $2 and a.state <> 'released') as is_assignee`,
    [launchId, userId],
  );
  const r = rows[0];
  if (!r.is_owner && !r.is_assignee) throw notFound("Launch not found");
  return { isOwner: r.is_owner };
}

export interface AssignmentRow {
  id: string;
  launch_id: string;
  requirement_id: string;
  role: "primary" | "backup";
  state: "standby" | "invited" | "accepted" | "confirmed" | "declined" | "released";
  user_id: string | null;
  label: string;
  token_expires_at: Date | null;
  [key: string]: unknown;
}

/** A contributor may only act on an assignment that is theirs. */
export async function requireOwnAssignment(q: Queryable, userId: string, assignmentId: string): Promise<AssignmentRow> {
  const rows = await q.query<AssignmentRow>(
    `select id, launch_id, requirement_id, role, state::text as state, user_id, label, token_expires_at
     from assignments where id = $1`,
    [assignmentId],
  );
  const a = rows[0];
  if (!a || a.user_id !== userId) throw notFound("Assignment not found");
  return a;
}

export async function ensureWorkspaceOwner(q: Queryable, userId: string, workspaceId: string) {
  const rows = await q.query(
    `select 1 from workspace_members where workspace_id = $1 and user_id = $2 and role = 'owner'`,
    [workspaceId, userId],
  );
  if (rows.length === 0) throw notFound("Workspace not found");
}

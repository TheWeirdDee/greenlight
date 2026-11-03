/**
 * Readiness engine types.
 *
 * The engine is a pure function: (recorded state, now) -> readiness. It performs no I/O and
 * holds no hidden state, so the same inputs always yield the same verdict. All token amounts
 * are decimal strings of base units so results stay JSON-safe.
 */

export type RequirementKind = "commitment" | "deliverable" | "url_check" | "funding";
export type AssignmentRole = "primary" | "backup";
export type AssignmentState =
  | "standby"
  | "invited"
  | "accepted"
  | "confirmed"
  | "declined"
  | "released";

export interface EngineRequirement {
  id: string;
  title: string;
  kind: RequirementKind;
  mandatory: boolean;
  deadlineAt: Date | null;
  dependsOn: string[];
  /** Funding target in token base units (decimal string). Required when kind === "funding". */
  fundingAmount: string | null;
  fundingDecimals: number | null;
  fundingSymbol: string | null;
}

export interface EngineAssignment {
  id: string;
  requirementId: string;
  role: AssignmentRole;
  state: AssignmentState;
  label: string;
  confirmedAt: Date | null;
  declineReason: string | null;
}

export interface EngineEvidence {
  id: string;
  requirementId: string;
  assignmentId: string | null;
  kind: "url" | "note";
  verification: "unverified" | "verified" | "failed";
  submittedAt: Date;
  verifiedAt: Date | null;
  detail: string | null;
}

export interface EngineFundingTx {
  id: string;
  requirementId: string;
  status: "pending" | "verified" | "rejected";
  /** Token base units, decimal string. Only meaningful for verified transactions. */
  amount: string | null;
  /** On-chain block timestamp; this is the moment funds actually moved. */
  blockTimestamp: Date | null;
}

export interface EngineInput {
  requirements: EngineRequirement[];
  assignments: EngineAssignment[];
  evidence: EngineEvidence[];
  fundingTxs: EngineFundingTx[];
  now: Date;
}

export type RequirementStatus = "satisfied" | "incomplete" | "blocked" | "expired";
export type EvidenceTier = "none" | "submitted" | "verified";

export type ReasonCode =
  | "unassigned"
  | "declined"
  | "awaiting_invite_response"
  | "awaiting_confirmation"
  | "awaiting_evidence"
  | "verification_failed"
  | "awaiting_funding"
  | "underfunded"
  | "funding_pending_confirmations"
  | "deadline_missed"
  | "waiting_on_dependency"
  | "dependency_blocked"
  | "dependency_cycle"
  | "dependency_missing"
  | "conflicting_owners";

export interface Reason {
  code: ReasonCode;
  message: string;
}

export type NextActionCode =
  | "assign_owner"
  | "activate_backup"
  | "replace_or_extend"
  | "extend_deadline"
  | "wait_for_invite_response"
  | "confirm_commitment"
  | "submit_evidence"
  | "fix_and_recheck"
  | "send_funds"
  | "wait_for_confirmations"
  | "resolve_dependency"
  | "fix_dependencies"
  | "resolve_owner_conflict"
  | "none";

export interface NextAction {
  code: NextActionCode;
  /** Who is expected to act. */
  actor: "founder" | "assignee" | "anyone" | "system" | "none";
  label: string;
}

export interface RequirementEvaluation {
  requirementId: string;
  title: string;
  kind: RequirementKind;
  mandatory: boolean;
  status: RequirementStatus;
  /**
   * True when the requirement has outstanding work of its own. False only when it is itself done
   * but gated behind an unsatisfied dependency. Root-cause items are what the headline counts.
   */
  rootCause: boolean;
  reasons: Reason[];
  next: NextAction;
  evidenceTier: EvidenceTier;
  satisfiedAt: string | null;
  deadlineAt: string | null;
  ownerLabel: string | null;
  progress: { current: string; required: string; decimals: number; symbol: string } | null;
}

export type BlockerSeverity = "expired" | "blocked" | "waiting";

export interface Blocker {
  requirementId: string;
  title: string;
  severity: BlockerSeverity;
  summary: string;
  ownerLabel: string | null;
  deadlineAt: string | null;
  next: NextAction;
  evidenceTier: EvidenceTier;
}

export interface Readiness {
  state: "ready" | "not_ready";
  headline: string;
  detail: string;
  blockers: Blocker[];
  counts: {
    total: number;
    mandatory: number;
    mandatorySatisfied: number;
    blockedOrExpired: number;
    waiting: number;
  };
  requirements: RequirementEvaluation[];
  /** Compact identity of the verdict; changes iff any requirement status changes. */
  fingerprint: string;
  evaluatedAt: string;
}

import type {
  Blocker,
  EngineAssignment,
  EngineEvidence,
  EngineFundingTx,
  EngineInput,
  EngineRequirement,
  EvidenceTier,
  NextAction,
  Reason,
  Readiness,
  RequirementEvaluation,
  RequirementStatus,
} from "./types";

/**
 * Deterministic readiness evaluation.
 *
 * Rules (see docs/readiness-rules.md for the prose version):
 *  - A requirement is `satisfied` only when recorded, attributable evidence meets its rule
 *    AND the evidence arrived on or before its deadline AND every dependency is satisfied.
 *  - `expired`: not satisfied and the deadline has passed.
 *  - `blocked`: cannot progress without intervention (declined, unassigned, failed check,
 *    blocked dependency, dependency cycle).
 *  - `incomplete`: progressing normally; waiting on a person or on chain confirmations.
 *  - The launch is `ready` iff at least one mandatory requirement exists and every mandatory
 *    requirement is satisfied. Nothing outside this function can set that verdict.
 */

type Own = {
  satisfied: boolean;
  satisfiedAt: Date | null;
  status: RequirementStatus;
  reasons: Reason[];
  next: NextAction;
  tier: EvidenceTier;
  progress: RequirementEvaluation["progress"];
  ownerLabel: string | null;
};

const NONE: NextAction = { code: "none", actor: "none", label: "No action needed" };

const fmt = (d: Date) => d.toISOString().replace(".000Z", "Z");

function activePrimary(assignments: EngineAssignment[], requirementId: string) {
  return assignments.find(
    (a) => a.requirementId === requirementId && a.role === "primary" && a.state !== "released",
  );
}

function standbyBackup(assignments: EngineAssignment[], requirementId: string) {
  return assignments.find(
    (a) => a.requirementId === requirementId && a.role === "backup" && a.state === "standby",
  );
}

function latest<T extends { id: string }>(items: T[], at: (t: T) => Date): T | undefined {
  return [...items].sort((a, b) => {
    const diff = at(b).getTime() - at(a).getTime();
    return diff !== 0 ? diff : a.id < b.id ? 1 : -1;
  })[0];
}

function recoveryAction(r: EngineRequirement, assignments: EngineAssignment[]): NextAction {
  const backup = standbyBackup(assignments, r.id);
  if (backup && (r.kind === "commitment" || r.kind === "deliverable")) {
    return {
      code: "activate_backup",
      actor: "founder",
      label: `Activate backup ${backup.label} and set a new deadline`,
    };
  }
  if (r.kind === "commitment" || r.kind === "deliverable") {
    return {
      code: "replace_or_extend",
      actor: "founder",
      label: "Replace the contributor or set a new deadline",
    };
  }
  return { code: "extend_deadline", actor: "founder", label: "Set a new deadline or complete the requirement" };
}

function evaluateOwn(
  r: EngineRequirement,
  input: EngineInput,
  evidenceByReq: Map<string, EngineEvidence[]>,
  fundingByReq: Map<string, EngineFundingTx[]>,
): Own {
  const { assignments, now } = input;
  const deadline = r.deadlineAt;
  const deadlinePassed = deadline !== null && now.getTime() > deadline.getTime();
  const owner = activePrimary(assignments, r.id) ?? null;
  const ownerLabel = owner?.label ?? null;

  const unsatisfied = (
    status: "blocked" | "incomplete",
    reasons: Reason[],
    next: NextAction,
    extra: Partial<Own> = {},
  ): Own => {
    if (deadlinePassed) {
      return {
        satisfied: false,
        satisfiedAt: null,
        status: "expired",
        reasons: [
          { code: "deadline_missed", message: `Deadline ${fmt(deadline!)} passed without completion` },
          ...reasons,
        ],
        next: recoveryAction(r, assignments),
        tier: "none",
        progress: null,
        ownerLabel,
        ...extra,
      };
    }
    return {
      satisfied: false,
      satisfiedAt: null,
      status,
      reasons,
      next,
      tier: "none",
      progress: null,
      ownerLabel,
      ...extra,
    };
  };

  const ownerBlocker = (): Own | null => {
    if (!owner) {
      return unsatisfied(
        "blocked",
        [{ code: "unassigned", message: "No responsible contributor assigned" }],
        { code: "assign_owner", actor: "founder", label: "Assign and invite a contributor" },
      );
    }
    if (owner.state === "declined") {
      const why = owner.declineReason ? `: "${owner.declineReason}"` : "";
      return unsatisfied(
        "blocked",
        [{ code: "declined", message: `${owner.label} declined${why}` }],
        recoveryAction(r, assignments),
      );
    }
    return null;
  };

  const ownerProgress = (): Own | null => {
    if (!owner) return null;
    if (owner.state === "invited") {
      return unsatisfied(
        "incomplete",
        [{ code: "awaiting_invite_response", message: `${owner.label} has not responded to the invitation` }],
        { code: "wait_for_invite_response", actor: "assignee", label: `${owner.label} accepts or declines` },
      );
    }
    if (owner.state === "accepted") {
      return unsatisfied(
        "incomplete",
        [{ code: "awaiting_confirmation", message: `${owner.label} accepted but has not confirmed` }],
        { code: "confirm_commitment", actor: "assignee", label: `${owner.label} confirms the commitment` },
      );
    }
    return null;
  };

  switch (r.kind) {
    case "commitment": {
      const blocked = ownerBlocker();
      if (blocked) return blocked;
      const progress = ownerProgress();
      if (progress) return progress;
      const confirmedAt = owner!.confirmedAt;
      if (owner!.state === "confirmed" && confirmedAt) {
        if (!deadline || confirmedAt.getTime() <= deadline.getTime()) {
          return {
            satisfied: true,
            satisfiedAt: confirmedAt,
            status: "satisfied",
            reasons: [],
            next: NONE,
            tier: "submitted",
            progress: null,
            ownerLabel,
          };
        }
        // Confirmed, but after the deadline: stays expired until the deadline is renegotiated.
        return unsatisfied(
          "blocked",
          [{ code: "awaiting_confirmation", message: `Confirmation arrived ${fmt(confirmedAt)}, after the deadline` }],
          recoveryAction(r, assignments),
        );
      }
      return unsatisfied(
        "incomplete",
        [{ code: "awaiting_confirmation", message: "Awaiting confirmation" }],
        { code: "confirm_commitment", actor: "assignee", label: "Contributor confirms the commitment" },
      );
    }

    case "deliverable": {
      const blocked = ownerBlocker();
      if (blocked) return blocked;
      const progress = ownerProgress();
      if (progress) return progress;
      const items = (evidenceByReq.get(r.id) ?? []).filter(
        (e) => e.assignmentId === owner!.id && e.verification !== "failed",
      );
      const timely = items.filter((e) => !deadline || e.submittedAt.getTime() <= deadline.getTime());
      if (owner!.state === "confirmed" && timely.length > 0) {
        const first = [...timely].sort((a, b) => a.submittedAt.getTime() - b.submittedAt.getTime())[0];
        const verified = timely.some((e) => e.verification === "verified");
        return {
          satisfied: true,
          satisfiedAt: first.submittedAt,
          status: "satisfied",
          reasons: [],
          next: NONE,
          tier: verified ? "verified" : "submitted",
          progress: null,
          ownerLabel,
        };
      }
      return unsatisfied(
        "incomplete",
        [{ code: "awaiting_evidence", message: `${owner!.label} has not submitted supporting evidence` }],
        { code: "submit_evidence", actor: "assignee", label: `${owner!.label} submits evidence` },
      );
    }

    case "url_check": {
      if (owner?.state === "declined") return ownerBlocker()!;
      const urls = (evidenceByReq.get(r.id) ?? []).filter((e) => e.kind === "url");
      const newest = latest(urls, (e) => e.submittedAt);
      if (!newest) {
        return unsatisfied(
          "incomplete",
          [{ code: "awaiting_evidence", message: "No URL has been checked yet" }],
          { code: "submit_evidence", actor: "assignee", label: "Submit the public URL for an availability check" },
        );
      }
      if (newest.verification === "failed") {
        return unsatisfied(
          "blocked",
          [{ code: "verification_failed", message: `Latest availability check failed${newest.detail ? `: ${newest.detail}` : ""}` }],
          { code: "fix_and_recheck", actor: "assignee", label: "Fix the site, then re-run the check" },
        );
      }
      if (newest.verification === "unverified") {
        return unsatisfied(
          "incomplete",
          [{ code: "awaiting_evidence", message: "URL submitted but not yet independently checked" }],
          { code: "fix_and_recheck", actor: "system", label: "Run the availability check" },
        );
      }
      const at = newest.verifiedAt ?? newest.submittedAt;
      if (deadline && at.getTime() > deadline.getTime()) {
        return unsatisfied(
          "blocked",
          [{ code: "deadline_missed", message: `Check passed ${fmt(at)}, after the deadline` }],
          recoveryAction(r, assignments),
        );
      }
      return {
        satisfied: true,
        satisfiedAt: at,
        status: "satisfied",
        reasons: [],
        next: NONE,
        tier: "verified",
        progress: null,
        ownerLabel,
      };
    }

    case "funding": {
      const required = BigInt(r.fundingAmount ?? "0");
      const decimals = r.fundingDecimals ?? 0;
      const symbol = r.fundingSymbol ?? "";
      const txs = fundingByReq.get(r.id) ?? [];
      const verified = txs
        .filter((t) => t.status === "verified" && t.amount !== null && t.blockTimestamp !== null)
        .sort((a, b) => a.blockTimestamp!.getTime() - b.blockTimestamp!.getTime());
      let total = 0n;
      let fundedAt: Date | null = null;
      for (const t of verified) {
        total += BigInt(t.amount!);
        if (fundedAt === null && total >= required) fundedAt = t.blockTimestamp;
      }
      const progress = { current: total.toString(), required: required.toString(), decimals, symbol };
      if (fundedAt && (!deadline || fundedAt.getTime() <= deadline.getTime())) {
        return {
          satisfied: true,
          satisfiedAt: fundedAt,
          status: "satisfied",
          reasons: [],
          next: NONE,
          tier: "verified",
          progress,
          ownerLabel,
        };
      }
      if (fundedAt) {
        return unsatisfied(
          "blocked",
          [{ code: "deadline_missed", message: `Funding completed ${fmt(fundedAt)}, after the deadline` }],
          recoveryAction(r, assignments),
          { progress },
        );
      }
      const pendingTx = txs.some((t) => t.status === "pending");
      if (pendingTx) {
        return unsatisfied(
          "incomplete",
          [{ code: "funding_pending_confirmations", message: "A funding transaction is awaiting confirmations" }],
          { code: "wait_for_confirmations", actor: "system", label: "Wait for the required block confirmations" },
          { progress },
        );
      }
      return unsatisfied(
        "incomplete",
        total > 0n
          ? [{ code: "underfunded", message: "Verified funding is below the required amount" }]
          : [{ code: "awaiting_funding", message: "No verified funding transaction yet" }],
        { code: "send_funds", actor: "anyone", label: "Send the required funds and submit the transaction" },
        { progress },
      );
    }
  }
}

function findCyclic(requirements: EngineRequirement[]): Set<string> {
  const deps = new Map(requirements.map((r) => [r.id, r.dependsOn]));
  const cyclic = new Set<string>();
  for (const r of requirements) {
    const seen = new Set<string>();
    const stack = [...r.dependsOn];
    while (stack.length > 0) {
      const id = stack.pop()!;
      if (id === r.id) {
        cyclic.add(r.id);
        break;
      }
      if (seen.has(id)) continue;
      seen.add(id);
      stack.push(...(deps.get(id) ?? []));
    }
  }
  return cyclic;
}

export function evaluateReadiness(input: EngineInput): Readiness {
  const { requirements, now } = input;
  const byId = new Map(requirements.map((r) => [r.id, r]));

  const evidenceByReq = new Map<string, EngineEvidence[]>();
  for (const e of input.evidence) {
    evidenceByReq.set(e.requirementId, [...(evidenceByReq.get(e.requirementId) ?? []), e]);
  }
  const fundingByReq = new Map<string, EngineFundingTx[]>();
  for (const t of input.fundingTxs) {
    fundingByReq.set(t.requirementId, [...(fundingByReq.get(t.requirementId) ?? []), t]);
  }

  const cyclic = findCyclic(requirements);
  const memo = new Map<string, RequirementEvaluation>();

  const resolve = (id: string): RequirementEvaluation => {
    const cached = memo.get(id);
    if (cached) return cached;
    const r = byId.get(id)!;

    if (cyclic.has(id)) {
      const evaluation: RequirementEvaluation = {
        requirementId: r.id,
        title: r.title,
        kind: r.kind,
        mandatory: r.mandatory,
        status: "blocked",
        rootCause: true,
        reasons: [{ code: "dependency_cycle", message: "Dependencies form a cycle and can never be satisfied" }],
        next: { code: "fix_dependencies", actor: "founder", label: "Remove the circular dependency" },
        evidenceTier: "none",
        satisfiedAt: null,
        deadlineAt: r.deadlineAt ? r.deadlineAt.toISOString() : null,
        ownerLabel: null,
        progress: null,
      };
      memo.set(id, evaluation);
      return evaluation;
    }

    const own = evaluateOwn(r, input, evidenceByReq, fundingByReq);
    const unsatisfiedDeps: Array<{ title: string; status: RequirementStatus }> = [];
    const missing: string[] = [];
    for (const depId of r.dependsOn) {
      if (!byId.has(depId)) {
        missing.push(depId);
        continue;
      }
      const dep = resolve(depId);
      if (dep.status !== "satisfied") unsatisfiedDeps.push({ title: dep.title, status: dep.status });
    }

    let status = own.status;
    let reasons = own.reasons;
    let next = own.next;
    let satisfied = own.satisfied;
    if (unsatisfiedDeps.length > 0 || missing.length > 0) {
      const hard = unsatisfiedDeps.some((d) => d.status === "blocked" || d.status === "expired") || missing.length > 0;
      const depReasons: Reason[] = [
        ...unsatisfiedDeps.map((d): Reason => ({
          code: d.status === "blocked" || d.status === "expired" ? "dependency_blocked" : "waiting_on_dependency",
          message: `Depends on "${d.title}", which is ${d.status}`,
        })),
        ...missing.map((): Reason => ({ code: "dependency_missing", message: "Depends on a requirement that no longer exists" })),
      ];
      reasons = [...own.reasons, ...depReasons];
      if (own.satisfied || own.status === "incomplete") status = hard ? "blocked" : "incomplete";
      if (own.satisfied) {
        satisfied = false;
        next = {
          code: "resolve_dependency",
          actor: "none",
          label: `Resolve ${unsatisfiedDeps[0] ? `"${unsatisfiedDeps[0].title}"` : "its dependency"} first`,
        };
      }
    }

    const evaluation: RequirementEvaluation = {
      requirementId: r.id,
      title: r.title,
      kind: r.kind,
      mandatory: r.mandatory,
      status: satisfied ? "satisfied" : status,
      // Root cause = has outstanding work of its own, not merely gated behind a dependency.
      rootCause: !satisfied && !own.satisfied,
      reasons,
      next,
      evidenceTier: own.tier,
      satisfiedAt: own.satisfiedAt ? own.satisfiedAt.toISOString() : null,
      deadlineAt: r.deadlineAt ? r.deadlineAt.toISOString() : null,
      ownerLabel: own.ownerLabel,
      progress: own.progress,
    };
    memo.set(id, evaluation);
    return evaluation;
  };

  const evaluations = requirements.map((r) => resolve(r.id));

  const mandatory = evaluations.filter((e) => e.mandatory);
  const unsatisfiedMandatory = mandatory.filter((e) => e.status !== "satisfied");
  const rootBlockers = unsatisfiedMandatory.filter((e) => e.rootCause);

  const severityOf = (e: RequirementEvaluation): Blocker["severity"] =>
    e.status === "expired" ? "expired" : e.status === "blocked" ? "blocked" : "waiting";
  const severityRank = { expired: 0, blocked: 1, waiting: 2 } as const;

  const blockers: Blocker[] = rootBlockers
    .map((e) => ({
      requirementId: e.requirementId,
      title: e.title,
      severity: severityOf(e),
      summary: e.reasons[0]?.message ?? "Requirement not satisfied",
      ownerLabel: e.ownerLabel,
      deadlineAt: e.deadlineAt,
      next: e.next,
      evidenceTier: e.evidenceTier,
    }))
    .sort((a, b) => severityRank[a.severity] - severityRank[b.severity]);

  const counts = {
    total: evaluations.length,
    mandatory: mandatory.length,
    mandatorySatisfied: mandatory.length - unsatisfiedMandatory.length,
    blockedOrExpired: unsatisfiedMandatory.filter((e) => e.status === "blocked" || e.status === "expired").length,
    waiting: unsatisfiedMandatory.filter((e) => e.status === "incomplete").length,
  };

  const ready = mandatory.length > 0 && unsatisfiedMandatory.length === 0;
  let headline: string;
  let detail: string;
  if (ready) {
    headline = "READY TO LAUNCH";
    detail = `All ${mandatory.length} mandatory requirement${mandatory.length === 1 ? "" : "s"} satisfied.`;
  } else if (mandatory.length === 0) {
    headline = "NOT READY — NO REQUIREMENTS DEFINED";
    detail = "Add at least one mandatory requirement. A launch with nothing required cannot be ready.";
  } else {
    const n = blockers.length;
    headline = `NOT READY — ${n} ${n === 1 ? "BLOCKER" : "BLOCKERS"}`;
    detail =
      `${counts.mandatorySatisfied} of ${mandatory.length} mandatory requirements satisfied` +
      (counts.blockedOrExpired > 0 ? `; ${counts.blockedOrExpired} blocked or expired` : "") +
      (counts.waiting > 0 ? `; ${counts.waiting} waiting on a response` : "") +
      ".";
  }

  return {
    state: ready ? "ready" : "not_ready",
    headline,
    detail,
    blockers,
    counts,
    requirements: evaluations,
    fingerprint: evaluations.map((e) => `${e.requirementId}:${e.status}:${e.rootCause ? 1 : 0}`).join("|"),
    evaluatedAt: now.toISOString(),
  };
}

import type { Queryable } from "@/lib/db/types";
import { conflict, invalid, notFound } from "@/lib/errors";
import { txHashInput } from "@/lib/validation";
import { requireLaunchOwner, requireLaunchParticipant } from "./access";
import type { Actor, Ctx, FundingVerification } from "./context";
import { SYSTEM_ACTOR, TxNotFoundError } from "./context";
import { appendEvent, asEventActor, assertNotLaunched, withLaunch } from "./core";

interface FundingReq {
  id: string;
  launch_id: string;
  title: string;
  funding_chain_id: number;
  funding_token: string;
  funding_recipient: string;
  funding_min_confirmations: number;
}

async function loadFundingRequirement(q: Queryable, requirementId: string): Promise<FundingReq> {
  const [r] = await q.query<FundingReq>(
    `select id, launch_id, title, funding_chain_id, funding_token, funding_recipient, funding_min_confirmations
     from requirements where id = $1 and kind = 'funding'`,
    [requirementId],
  );
  if (!r) throw notFound("Funding requirement not found");
  return r;
}

/**
 * Credits a funding transaction to a requirement — but only what the chain itself confirms.
 *
 * The submitted hash is a claim. The verifier independently checks chain ID, receipt success,
 * that the transfer was emitted by the configured token contract, the recipient, the amount and
 * the confirmation depth. Transactions that fail verification at submission are not stored, so a
 * wrong or hostile hash can never reserve a real transaction. Each (chain, hash) can be credited
 * once, ever.
 */
export async function submitFundingTx(
  ctx: Ctx,
  actor: Actor,
  requirementId: string,
  rawHash: string,
  idempotencyKey?: string,
) {
  const parsed = txHashInput.safeParse(rawHash);
  if (!parsed.success) throw invalid(parsed.error.issues[0]?.message ?? "Invalid transaction hash");
  const txHash = parsed.data as `0x${string}`;

  const req = await loadFundingRequirement(ctx.db, requirementId);
  await requireLaunchParticipant(ctx.db, actor.id, req.launch_id);

  const existing = await ctx.db.query(`select 1 from funding_transactions where chain_id = $1 and tx_hash = $2`, [
    req.funding_chain_id,
    txHash,
  ]);
  if (existing.length > 0) throw conflict("This transaction has already been recorded and cannot be credited twice");

  let result: FundingVerification;
  try {
    result = await ctx.chain.verifyTransfer({
      chainId: req.funding_chain_id,
      txHash,
      token: req.funding_token,
      recipient: req.funding_recipient,
      minConfirmations: req.funding_min_confirmations,
    });
  } catch (e) {
    if (e instanceof TxNotFoundError) {
      throw invalid("Transaction not found on Base Sepolia. Wait until it has been mined, then try again.");
    }
    throw e;
  }

  if (result.status === "rejected") {
    // Audit the failed attempt without consuming the hash.
    await withLaunch(ctx, req.launch_id, { cause: "funding.rejected" }, async (tx, _l, now) => {
      await appendEvent(tx, req.launch_id, now, {
        type: "funding.rejected",
        actor: asEventActor(actor),
        requirementId,
        payload: { txHash, reason: result.reason },
      });
    });
    throw invalid(`Transaction rejected: ${result.reason ?? "verification failed"}`);
  }

  const outcome = await withLaunch(ctx, req.launch_id, { idempotencyKey, cause: "funding.submitted" }, async (tx, launch, now) => {
    assertNotLaunched(launch);
    await requireLaunchParticipant(tx, actor.id, req.launch_id);
    const rows = await tx.query<{ id: string }>(
      `insert into funding_transactions
         (launch_id, requirement_id, chain_id, tx_hash, submitted_by, status, reason, from_address, to_address,
          token_address, amount, block_number, block_timestamp, confirmations, verified_at, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
       on conflict (chain_id, tx_hash) do nothing returning id`,
      [
        req.launch_id,
        requirementId,
        req.funding_chain_id,
        txHash,
        actor.id,
        result.status,
        result.reason,
        result.from,
        result.to,
        result.token,
        result.amount,
        result.blockNumber,
        result.blockTimestamp,
        result.confirmations,
        result.status === "verified" ? now : null,
        now,
      ],
    );
    // Lost a race with another submission of the same hash: the unique key guarantees single credit.
    if (rows.length === 0) throw conflict("This transaction has already been recorded and cannot be credited twice");
    await appendEvent(tx, req.launch_id, now, {
      type: result.status === "verified" ? "funding.verified" : "funding.pending",
      actor: asEventActor(actor),
      requirementId,
      payload: { txHash, amount: result.amount, from: result.from, confirmations: result.confirmations, requirement: req.title },
      idempotencyKey,
    });
    return { id: rows[0].id, status: result.status };
  });

  return outcome.duplicate ? { duplicate: true as const } : { duplicate: false as const, ...outcome.value };
}

type StoredTx = {
  id: string;
  requirement_id: string;
  tx_hash: `0x${string}`;
  status: "pending" | "verified" | "rejected";
  amount: string | null;
};

/**
 * Re-checks every non-rejected funding transaction against the chain. Pending transactions are
 * promoted once they reach the required depth; verified ones are demoted if the chain no longer
 * supports them (for example after a reorg), which immediately re-blocks readiness.
 */
export async function reverifyFunding(ctx: Ctx, launchId: string, actor: Actor | null) {
  if (actor) await requireLaunchOwner(ctx.db, actor.id, launchId);

  const txs = await ctx.db.query<StoredTx>(
    `select id, requirement_id, tx_hash, status, amount::text as amount from funding_transactions
     where launch_id = $1 and status <> 'rejected'`,
    [launchId],
  );
  if (txs.length === 0) return { checked: 0, changed: 0 };

  const reqs = new Map<string, FundingReq>();
  const checks: Array<{ tx: StoredTx; result: FundingVerification | null }> = [];
  for (const tx of txs) {
    let req = reqs.get(tx.requirement_id);
    if (!req) {
      req = await loadFundingRequirement(ctx.db, tx.requirement_id);
      reqs.set(tx.requirement_id, req);
    }
    try {
      const result = await ctx.chain.verifyTransfer({
        chainId: req.funding_chain_id,
        txHash: tx.tx_hash,
        token: req.funding_token,
        recipient: req.funding_recipient,
        minConfirmations: req.funding_min_confirmations,
      });
      checks.push({ tx, result });
    } catch (e) {
      if (e instanceof TxNotFoundError) {
        // A transaction we previously accepted no longer exists on chain (e.g. reorg): withdraw the credit.
        checks.push({
          tx,
          result: {
            status: "rejected",
            reason: "Transaction no longer found on chain (possible reorg)",
            from: null, to: null, token: null, amount: null, blockNumber: null, blockTimestamp: null, confirmations: 0,
          },
        });
      } else {
        // RPC unreachable: leave the stored state alone rather than guess.
        checks.push({ tx, result: null });
      }
    }
  }

  let changed = 0;
  await withLaunch(ctx, launchId, { cause: "funding.reverified" }, async (q, _launch, now) => {
    for (const { tx, result } of checks) {
      if (!result || result.status === tx.status) continue;
      changed += 1;
      await q.query(
        `update funding_transactions set status = $2, reason = $3, confirmations = $4,
                verified_at = case when $2 = 'verified' then $5::timestamptz else verified_at end,
                amount = coalesce($6::numeric, amount), block_timestamp = coalesce($7::timestamptz, block_timestamp)
         where id = $1`,
        [tx.id, result.status, result.reason, result.confirmations, now, result.amount, result.blockTimestamp],
      );
      await appendEvent(q, launchId, now, {
        type: `funding.${result.status}`,
        actor: actor ? asEventActor(actor) : SYSTEM_ACTOR,
        requirementId: tx.requirement_id,
        payload: { txHash: tx.tx_hash, from: tx.status, reason: result.reason, recheck: true },
      });
    }
  });
  return { checked: txs.length, changed };
}

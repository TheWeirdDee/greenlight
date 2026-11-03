// Independent audit of funding transactions credited by Greenlight, against the REAL database and chain.
//
//   npm run verify:funding                 # transactions credited in the last 24 hours
//   npm run verify:funding -- <launch-id>  # every transaction credited to one launch
//
// For each credited transaction it re-derives the facts from Base Sepolia itself (it does not trust what
// Greenlight stored) and checks that: the chain is 84532; the receipt succeeded; the token contract emitted
// a Transfer to the configured recipient for the stored amount; the transaction was mined AFTER the
// requirement was created (so it cannot be a pre-existing transfer); it was credited exactly once; and the
// launch's stored readiness reflects it. Read-only.
import { createPublicClient, erc20Abi, http, isAddressEqual, parseEventLogs } from "viem";
import { baseSepolia } from "viem/chains";
import postgres from "postgres";

try {
  process.loadEnvFile(".env.local");
} catch {
  /* rely on the real environment */
}
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL (the greenlight_app login) is not set.");
  process.exit(1);
}
const launchId = process.argv[2];
const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
const client = createPublicClient({ chain: baseSepolia, transport: http(process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org") });

const results = [];
const check = (name, ok, detail = "") => {
  results.push(ok);
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

try {
  const rows = launchId
    ? await sql`select f.*, r.title as req_title, r.created_at as req_created, r.funding_recipient, r.funding_token, r.funding_amount::text as target, r.funding_token_decimals as decimals,
                       l.name as launch_name, l.created_at as launch_created, l.readiness_result, p.display_name as submitter
                from funding_transactions f join requirements r on r.id = f.requirement_id join launches l on l.id = f.launch_id join profiles p on p.id = f.submitted_by
                where f.launch_id = ${launchId} order by f.created_at`
    : await sql`select f.*, r.title as req_title, r.created_at as req_created, r.funding_recipient, r.funding_token, r.funding_amount::text as target, r.funding_token_decimals as decimals,
                       l.name as launch_name, l.created_at as launch_created, l.readiness_result, p.display_name as submitter
                from funding_transactions f join requirements r on r.id = f.requirement_id join launches l on l.id = f.launch_id join profiles p on p.id = f.submitted_by
                where f.created_at > now() - interval '24 hours' order by f.created_at`;
  if (rows.length === 0) {
    console.log("No funding transactions found" + (launchId ? " for that launch." : " in the last 24 hours."));
    process.exit(0);
  }
  const chainId = await client.getChainId();
  const head = await client.getBlockNumber();

  for (const t of rows) {
    console.log(`\n${t.launch_name} · ${t.req_title}`);
    console.log(`  tx        ${t.tx_hash}`);
    console.log(`  explorer  https://sepolia.basescan.org/tx/${t.tx_hash}`);
    console.log(`  stored    status=${t.status} amount=${t.amount} (base units) from=${t.from_address} block=${t.block_number} credited-by=${t.submitter} at ${new Date(t.created_at).toISOString()}`);

    check("RPC reports Base Sepolia (84532) and the stored chain id matches", chainId === 84532 && t.chain_id === 84532);
    let receipt;
    try {
      receipt = await client.getTransactionReceipt({ hash: t.tx_hash });
    } catch (e) {
      check("receipt exists on chain", false, e.message.split("\n")[0]);
      continue;
    }
    check("receipt status is success", receipt.status === "success");
    const logs = parseEventLogs({ abi: erc20Abi, eventName: "Transfer", logs: receipt.logs }).filter((l) => isAddressEqual(l.address, t.funding_token) && isAddressEqual(l.args.to, t.funding_recipient));
    const onChain = logs.reduce((s, l) => s + l.args.value, 0n);
    check("token contract emitted Transfer(s) to the configured recipient", logs.length > 0, logs.length ? `${onChain} base units` : "none found");
    check("on-chain amount equals the amount Greenlight credited", onChain.toString() === String(t.amount), `chain=${onChain} stored=${t.amount}`);
    check("stored sender matches the on-chain sender", logs.length > 0 && logs[0].args.from.toLowerCase() === String(t.from_address).toLowerCase());
    const block = await client.getBlock({ blockNumber: receipt.blockNumber });
    const minedAt = new Date(Number(block.timestamp) * 1000);
    check("mined AFTER the requirement was created (not a pre-existing transfer)", minedAt.getTime() >= new Date(t.req_created).getTime(), `mined ${minedAt.toISOString()} · requirement created ${new Date(t.req_created).toISOString()}`);
    check("block timestamp stored matches the chain", t.block_timestamp && Math.abs(new Date(t.block_timestamp).getTime() - minedAt.getTime()) < 1000);
    const confs = Number(head - receipt.blockNumber) + 1;
    check("confirmation depth meets the requirement's threshold", confs >= (await sql`select funding_min_confirmations as n from requirements where id = ${t.requirement_id}`)[0].n, `${confs} confirmations now`);

    const same = await sql`select count(*)::int n from funding_transactions where chain_id = ${t.chain_id} and tx_hash = ${t.tx_hash}`;
    check("credited exactly once (unique per chain+hash)", same[0].n === 1);

    const reqEval = (t.readiness_result?.requirements ?? []).find((r) => r.requirementId === t.requirement_id);
    check("stored readiness shows the funding requirement satisfied", reqEval?.status === "satisfied" || BigInt(t.amount) < BigInt(t.target), reqEval ? `requirement status=${reqEval.status}, verified ${reqEval.progress?.current}/${reqEval.progress?.required}` : "no evaluation stored");
    const ev = await sql`select type, actor_label, created_at from events where launch_id = ${t.launch_id} and (type = 'funding.verified' or type = 'readiness.changed') and created_at >= ${t.created_at}::timestamptz - interval '2 seconds' order by seq limit 4`;
    check("activity log recorded funding.verified followed by a readiness recalculation", ev.some((e) => e.type === "funding.verified") && ev.some((e) => e.type === "readiness.changed"), ev.map((e) => e.type).join(" → "));
  }
} catch (e) {
  console.error(`Verification could not complete: ${e.message}`);
  process.exitCode = 1;
} finally {
  await sql.end();
}
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed${failed ? ` — ${failed} FAILED` : ""}`);
if (failed) process.exitCode = 1;

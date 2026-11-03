# Demo script — target 2:30

## Before recording (all must be true — otherwise it isn't a production demo)

1. The app is deployed (currently <https://greenlight-gold-eight.vercel.app>) and `npm run test:e2e:real` has passed against it.
2. Four **confirmed** accounts exist (Founder, Ada, Grace + one spare). Use three separate browser profiles so the contributor sessions are visibly independent.
3. The founder's browser wallet is on **Base Sepolia** with test ETH (gas) and test USDC (<https://faucet.circle.com>).
4. After recording the funding beat, run `npm run verify:funding -- <launch-id>` and keep its output: it re-checks the transaction against the chain and fails if the transfer pre-dates the requirement.
5. Brand-new launch for the take: never reuse one created before the camera was rolling.

Record **real product footage only**: the deployed app, a real browser, real sign-ups. Disclose on
screen that funding is **Base Sepolia testnet**. Pre-create three browser profiles (Founder, Ada, Grace)
so the contributor sessions are visibly independent. Set the short-fuse deadline to ~90 seconds from the
moment you create it so the expiry happens on camera.

Use a funded Base Sepolia wallet (test ETH for gas + test USDC from <https://faucet.circle.com>) and the
real transaction you send as the on-screen evidence. Never show a seed phrase or private key.

| Time | Beat | On screen | Voice-over |
| --- | --- | --- | --- |
| 0:00–0:15 | **01 Person** | Founder at a desk (or a title card): "Launch in 72 hours." | "I'm launching in three days. I think everything's ready. I can't prove it." |
| 0:15–0:30 | **02 Problem** | Scroll a real Telegram thread / sheet with “yes I'm in”, “funds coming”. | "A partner said yes in a chat. The budget is 'on its way'. Nothing here is evidence." |
| 0:30–0:40 | **03 Gap** | A plain checklist with everything ticked. | "A checklist would say done. It can't tell me whether anyone actually confirmed." |
| 0:40–0:50 | **04 Turn** | Landing page hero. | "Greenlight. Know when you're actually ready to launch." |
| 0:50–1:10 | **05 Mechanism** | Open the live launch room: countdown, **NOT READY — 4 BLOCKERS**, each blocker with owner and next action. | "Four blockers, each with an owner, a deadline and the next action. The status isn't a number I typed — it's computed." |
| 1:10–1:40 | **06 Live proof** | Split screen: Ada's profile accepts and **confirms**; the founder's room flips to 3 blockers on its own. Then paste the real tx hash: **On-chain verified**, USDC, block, explorer link. Site check passes. | "Ada confirms from her own account. The room recalculates. Funding isn't a screenshot — Greenlight checked the chain: network, token, recipient, amount, confirmations." |
| 1:40–2:05 | **07 Surprising moment** | The 90-second deadline passes on camera: **Expired**. Click **Activate backup Grace**. Grace's profile accepts and confirms. | "A deadline passed and nobody touched anything — the requirement expired and the launch is blocked. I activate my backup. She has to genuinely confirm before it changes." |
| 2:05–2:15 | **08 Why live / why Base** | Basescan transaction page next to the app. | "The funding evidence is a Base transaction anyone can inspect — that's why it lives onchain. This is testnet." |
| 2:15–2:30 | **09 Payoff** | **READY TO LAUNCH** → *Proceed with launch* → Readiness Brief (verified vs submitted claim) → public share link. | "Ready — because the evidence says so. The decision stays mine, recorded with a timestamp, in a brief I can share." |

## Rules for the cut

- Every state change you show must be caused by an action you also show.
- Keep the **"Submitted claim"** / **"Verified"** badges visible in the brief — it's the honesty beat.
- No performance claims, no invented customers, no "AI-powered" language: no AI is in the readiness path.
- Label testnet funding on screen. Show the explorer link, not just the app's rendering of it.

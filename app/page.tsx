import Link from "next/link";
import { Wordmark } from "@/components/brand";
import { RecoveryFlow, Reveal } from "@/components/landing/reveal";
import { Simulator } from "@/components/landing/simulator";
import { ThemeToggle } from "@/components/theme-toggle";
import { buttonClass } from "@/components/button-class";

const failures = [
  { who: "The promo partner", what: "said “yes, we’re in” in a group chat — and never confirmed an actual slot." },
  { who: "The campaign budget", what: "was promised, screenshotted, and never reached the wallet." },
  { who: "The announcement", what: "went out referencing a date and a number that changed two days ago." },
  { who: "The deliverable", what: "was “basically done” — according to a verbal assurance." },
  { who: "The founder", what: "found the blocker after the launch was already public." },
];

const steps = [
  { n: "01", title: "Define what “ready” means", body: "Add mandatory requirements — commitments, deliverables, site checks, funding — each with a deadline, an owner, and the things it depends on." },
  { n: "02", title: "Collect commitments you can trust", body: "Each owner gets a private, single-use invitation. They accept, then confirm separately, from their own account. Every step is stamped with who and when." },
  { n: "03", title: "Verify what can be verified", body: "Funding is checked on Base Sepolia: network, token, recipient, amount, success, confirmations. Websites are fetched by our server. A pasted hash proves nothing by itself." },
  { n: "04", title: "Recalculate, then decide", body: "A deterministic engine re-evaluates on every event — and when a deadline silently passes. It says READY only when every mandatory requirement is satisfied. The call stays yours." },
];

export default function Home() {
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 border-b border-line bg-paper/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
          <Wordmark />
          <nav aria-label="Primary" className="hidden items-center gap-6 text-sm text-ink-2 md:flex">
            <a href="#sample" className="hover:text-ink">Live sample</a>
            <a href="#how" className="hover:text-ink">How it works</a>
            <a href="#evidence" className="hover:text-ink">Evidence</a>
            <a href="#limits" className="hover:text-ink">Limits</a>
          </nav>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Link href="/login" className={`${buttonClass("ghost", "sm")} max-sm:hidden`}>Sign in</Link>
            <Link href="/login?mode=signup" className={`${buttonClass("primary", "sm")} max-sm:hidden`}>Open a launch room</Link>
          </div>
        </div>
      </header>

      <main id="main">
        {/* Hero */}
        <section className="mx-auto grid max-w-6xl items-center gap-12 px-4 pb-16 pt-12 sm:px-6 sm:pb-24 sm:pt-16 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:gap-10">
          <div>
            <p className="font-mono text-[12px] uppercase tracking-[0.14em] text-ink-3">Launch readiness for Web3 teams · built on Base</p>
            <h1 className="mt-4 font-display text-[clamp(2.5rem,8.5vw,4.6rem)] font-semibold leading-[1] text-balance">
              Know when you&apos;re <em className="not-italic text-ready">actually</em> ready to launch.
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-ink-2">
              Greenlight replaces “I think everyone’s confirmed” with recorded evidence. Contributors confirm under their own accounts, funding is verified on-chain, and your launch status recalculates the moment anything changes — including when a deadline quietly passes.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/login?mode=signup" className={buttonClass("primary")}>Open a launch room</Link>
              <a href="#how" className={buttonClass("secondary")}>How it works</a>
            </div>
            <p className="mt-4 text-[13px] text-ink-3">Free to try · Base Sepolia testnet only · no real funds are ever held or moved</p>
          </div>

          <div id="sample" className="min-w-0 scroll-mt-20">
            <Reveal>
              <Simulator />
            </Reveal>
            <p className="mt-3 text-[13px] text-ink-3">
              Made-up people and amounts — but the verdict comes from the same readiness function the product runs on the server. Try making Ada unavailable, then recover.
            </p>
          </div>
        </section>

        {/* Problem */}
        <section className="border-y border-line bg-sunken">
          <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 sm:px-6 sm:py-24 lg:grid-cols-[1fr_1.2fr]">
            <Reveal>
              <p className="font-mono text-[12px] uppercase tracking-[0.14em] text-ink-3">The problem</p>
              <h2 className="mt-3 font-display text-4xl leading-tight sm:text-5xl">The last 72 hours run on Telegram and hope.</h2>
              <p className="mt-5 max-w-md text-[17px] leading-relaxed text-ink-2">
                Founders don’t lack task lists. They lack a reliable way to know whether the critical commitments behind those tasks are real — and which one will break the launch.
              </p>
            </Reveal>
            <Reveal delay={0.1}>
              <ul className="divide-y divide-line-strong border-y border-line-strong">
                {failures.map((f) => (
                  <li key={f.who} className="py-4 text-[17px] leading-snug">
                    <span className="font-semibold">{f.who}</span> <span className="text-ink-2">{f.what}</span>
                  </li>
                ))}
              </ul>
            </Reveal>
          </div>
        </section>

        {/* How it works */}
        <section id="how" className="mx-auto max-w-6xl scroll-mt-16 px-4 py-16 sm:px-6 sm:py-24">
          <Reveal>
            <p className="font-mono text-[12px] uppercase tracking-[0.14em] text-ink-3">How it works</p>
            <h2 className="mt-3 max-w-2xl font-display text-4xl leading-tight sm:text-5xl">Dependency-driven readiness, from real events.</h2>
          </Reveal>
          <ol className="mt-12 grid gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-2">
            {steps.map((s, i) => (
              <li key={s.n} className="bg-surface p-6 sm:p-8">
                <Reveal delay={i * 0.06}>
                  <p className="font-mono text-sm text-ink-3">{s.n}</p>
                  <h3 className="mt-2 font-display text-2xl leading-snug">{s.title}</h3>
                  <p className="mt-3 text-[15px] leading-relaxed text-ink-2">{s.body}</p>
                </Reveal>
              </li>
            ))}
          </ol>

          <div className="mt-20">
            <Reveal>
              <h3 className="font-display text-3xl leading-tight sm:text-4xl">When someone goes quiet, nothing is edited by hand.</h3>
              <p className="mt-3 max-w-2xl text-[17px] text-ink-2">The deadline passes, so the requirement expires and the launch is blocked. The founder takes an authorised recovery action; the replacement has to genuinely confirm before anything turns green.</p>
            </Reveal>
            <div className="mt-10">
              <RecoveryFlow
                steps={[
                  { label: "Deadline passes", tone: "expired", note: "No confirmation arrived in time." },
                  { label: "Requirement expires", tone: "expired", note: "Logged automatically, once." },
                  { label: "Launch is blocked", tone: "block", note: "NOT READY — the blocker names its owner." },
                  { label: "Backup invited", tone: "wait", note: "One click by the founder; old confirmation stops counting." },
                  { label: "Replacement confirms", tone: "wait", note: "From their own account, with a timestamp." },
                  { label: "Readiness recalculated", tone: "ready", note: "READY only if everything else holds too." },
                ]}
              />
            </div>
          </div>
        </section>

        {/* Evidence */}
        <section id="evidence" className="scroll-mt-16 border-y border-line bg-sunken">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
            <Reveal>
              <p className="font-mono text-[12px] uppercase tracking-[0.14em] text-ink-3">Evidence, honestly labelled</p>
              <h2 className="mt-3 max-w-3xl font-display text-4xl leading-tight sm:text-5xl">Verified is not the same as claimed — and the brief says which is which.</h2>
            </Reveal>
            <div className="mt-10 grid gap-6 md:grid-cols-2">
              <Reveal>
                <div className="h-full rounded-2xl border border-ready/40 bg-surface p-6">
                  <p className="font-mono text-[12px] uppercase tracking-wider text-ready">Verified by Greenlight</p>
                  <ul className="mt-4 space-y-3 text-[15px] leading-snug">
                    <li><strong>USDC funding on Base Sepolia.</strong> Chain ID, token contract, recipient, amount, receipt status and confirmation depth are re-derived from the chain. We don’t trust a pasted hash — or client-supplied amounts.</li>
                    <li><strong>Public site availability.</strong> Our server fetches the URL itself, with protections against probing internal networks.</li>
                  </ul>
                </div>
              </Reveal>
              <Reveal delay={0.08}>
                <div className="h-full rounded-2xl border border-line-strong bg-surface p-6">
                  <p className="font-mono text-[12px] uppercase tracking-wider text-ink-2">Submitted claims</p>
                  <ul className="mt-4 space-y-3 text-[15px] leading-snug">
                    <li><strong>Confirmations.</strong> An authenticated person said they will do it. We record who and when — it proves the account confirmed, not that the work will happen.</li>
                    <li><strong>Deliverable evidence.</strong> Links and notes from the confirmed contributor. Only the contributor can submit it; the founder can’t fill it in for them.</li>
                  </ul>
                </div>
              </Reveal>
            </div>
          </div>
        </section>

        {/* Who */}
        <section className="mx-auto grid max-w-6xl gap-10 px-4 py-16 sm:px-6 sm:py-24 lg:grid-cols-2">
          <Reveal>
            <p className="font-mono text-[12px] uppercase tracking-[0.14em] text-ink-3">Who it&apos;s for</p>
            <h2 className="mt-3 font-display text-4xl leading-tight">Founders and launch operators in the final 24–72 hours.</h2>
            <p className="mt-5 max-w-lg text-[17px] leading-relaxed text-ink-2">
              You’ve committed to a date. You need one answer: <em>can we safely proceed?</em> Greenlight shows what’s ready, what’s missing, who is responsible and what to do next — then produces a shareable <strong>Launch Readiness Brief</strong> with your decision and its timestamp.
            </p>
          </Reveal>
          <Reveal delay={0.08}>
            <dl className="grid gap-4 sm:grid-cols-2">
              {[
                ["Founders & operators", "Create the room, set requirements, make the call."],
                ["Marketing contributors", "Accept, confirm and attach evidence from a focused portal."],
                ["Launch partners", "See exactly what you’ve committed to and by when."],
                ["Technical operators", "Own site checks and infrastructure requirements."],
              ].map(([t, d]) => (
                <div key={t} className="rounded-xl border border-line bg-surface p-4">
                  <dt className="font-medium">{t}</dt>
                  <dd className="mt-1 text-sm text-ink-2">{d}</dd>
                </div>
              ))}
            </dl>
          </Reveal>
        </section>

        {/* Limits */}
        <section id="limits" className="scroll-mt-16 border-t border-line bg-ink text-paper">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
            <Reveal>
              <p className="font-mono text-[12px] uppercase tracking-[0.14em] opacity-60">Boundaries</p>
              <h2 className="mt-3 max-w-3xl font-display text-4xl leading-tight sm:text-5xl">What Greenlight will never do.</h2>
            </Reveal>
            <ul className="mt-10 grid gap-x-10 gap-y-5 text-[16px] leading-snug sm:grid-cols-2">
              {[
                "Mark a launch READY while any mandatory requirement is unsatisfied.",
                "Let AI invent a confirmation, approve a payment, or override a condition.",
                "Hold your funds. There is no custody contract — it only verifies transfers.",
                "Touch mainnet. This MVP verifies Base Sepolia test tokens only.",
                "Promise that contributors will deliver, that promotion will work, or that your launch will succeed.",
                "Mean investment safety, legal approval or a market prediction. Ready means the conditions you set are met.",
              ].map((t) => (
                <li key={t} className="flex gap-3 border-t border-paper/20 pt-4">
                  <span aria-hidden="true" className="mt-1 text-[var(--block-lamp)]">✕</span>
                  {t}
                </li>
              ))}
            </ul>
            <div className="mt-14 flex flex-wrap items-center justify-between gap-6 border-t border-paper/20 pt-10">
              <p className="max-w-md font-display text-3xl leading-tight">Open a launch room and find out what&apos;s really blocking you.</p>
              <Link href="/login?mode=signup" className="inline-flex min-h-11 items-center rounded-lg bg-paper px-5 text-[15px] font-medium text-ink hover:opacity-90">
                Open a launch room
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-6 text-[13px] text-ink-3 sm:px-6">
          <p>Greenlight · built for Vibestarter Vibeathon 02 · funding verified on Base Sepolia (testnet)</p>
          <p>Readiness is an operational record, not a guarantee.</p>
        </div>
      </footer>
    </div>
  );
}

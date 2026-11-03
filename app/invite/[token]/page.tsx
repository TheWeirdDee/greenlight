import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Wordmark } from "@/components/brand";
import { InviteActions } from "@/components/invite-actions";
import { ThemeToggle } from "@/components/theme-toggle";
import { Card } from "@/components/ui";
import { buttonClass } from "@/components/button-class";
import { fmtDateTime } from "@/lib/format";
import { getCtx } from "@/lib/server/ctx";
import { getSessionUser } from "@/lib/server/session";
import { previewInvitation } from "@/lib/services/assignments";

export const metadata: Metadata = { title: "Invitation", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^gl_[A-Za-z0-9_-]{30,64}$/.test(token)) return <Shell><Problem title="This link isn't valid" body="Check that you copied the whole link, or ask the founder for a new one." /></Shell>;

  const user = await getSessionUser();
  if (!user) redirect(`/login?mode=signup&next=${encodeURIComponent(`/invite/${token}`)}`);

  const inv = await previewInvitation(getCtx(), token, user.id);
  if (!inv) {
    return <Shell><Problem title="This invitation was already used or doesn't exist" body="Invitation links work once. If you already accepted, your commitments are in your portal." cta /></Shell>;
  }
  if (inv.expired) return <Shell><Problem title="This invitation has expired" body={`Ask ${inv.invitedBy} to send you a new link.`} /></Shell>;
  if (inv.claimedByOther) return <Shell><Problem title="Someone else already responded" body="This link was claimed by a different account." /></Shell>;

  return (
    <Shell>
      <Card className="p-6 sm:p-8">
        <p className="font-mono text-[12px] uppercase tracking-[0.14em] text-ink-3">Invitation from {inv.invitedBy}</p>
        <h1 className="mt-2 font-display text-3xl leading-tight sm:text-4xl">{inv.requirementTitle}</h1>
        <p className="mt-1 text-ink-2">for <strong>{inv.launchName}</strong></p>
        {inv.requirementDescription ? <p className="mt-4 text-[15px]">{inv.requirementDescription}</p> : null}
        <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-2">
          <div><dt className="text-ink-3">You&apos;re named as</dt><dd className="font-medium">{inv.label}</dd></div>
          <div><dt className="text-ink-3">Deadline</dt><dd className="font-medium">{inv.deadlineAt ? fmtDateTime(inv.deadlineAt.toISOString()) : "None set"}</dd></div>
        </dl>
        <p className="mt-4 text-sm text-ink-2">Signed in as <strong>{user.email ?? user.name}</strong>.</p>
        <InviteActions token={token} />
      </Card>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh">
      <header className="border-b border-line">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between px-4 sm:px-6">
          <Wordmark />
          <ThemeToggle />
        </div>
      </header>
      <main id="main" className="mx-auto max-w-xl px-4 py-10 sm:py-16">{children}</main>
    </div>
  );
}

function Problem({ title, body, cta }: { title: string; body: string; cta?: boolean }) {
  return (
    <Card className="p-6 text-center sm:p-8">
      <h1 className="font-display text-3xl">{title}</h1>
      <p className="mt-3 text-ink-2">{body}</p>
      {cta ? <div className="mt-5"><Link href="/portal" className={buttonClass("primary")}>Go to my portal</Link></div> : null}
    </Card>
  );
}

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BriefDocument } from "@/components/brief-document";
import { Wordmark } from "@/components/brand";
import { ThemeToggle } from "@/components/theme-toggle";
import { getCtx } from "@/lib/server/ctx";
import { getSharedBrief } from "@/lib/services/brief";

export const metadata: Metadata = {
  title: "Launch Readiness Brief",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

export default async function PublicBrief({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^br_[A-Za-z0-9_-]{20,64}$/.test(token)) notFound();
  const brief = await getSharedBrief(getCtx(), token);
  if (!brief) notFound();

  return (
    <div className="min-h-dvh">
      <header className="border-b border-line">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4 sm:px-6">
          <Wordmark />
          <ThemeToggle />
        </div>
      </header>
      <main id="main" className="px-4 py-8 sm:px-6 sm:py-12">
        <BriefDocument brief={brief} />
      </main>
    </div>
  );
}

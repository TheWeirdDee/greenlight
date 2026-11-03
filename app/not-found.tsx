import Link from "next/link";
import { Wordmark } from "@/components/brand";
import { buttonClass } from "@/components/button-class";

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-6 text-center">
      <Wordmark />
      <h1 className="mt-10 font-display text-5xl">Nothing here.</h1>
      <p className="mt-3 max-w-md text-ink-2">This page doesn&apos;t exist, or you don&apos;t have access to it. We don&apos;t say which, on purpose.</p>
      <Link href="/" className={`${buttonClass("primary")} mt-8`}>Back to Greenlight</Link>
    </div>
  );
}

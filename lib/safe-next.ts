/** Only same-site relative paths are honoured, so `next` can never become an open redirect. */
export function safeNext(next: string | undefined | null): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return "/app";
  return next;
}

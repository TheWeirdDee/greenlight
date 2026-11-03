/** Only http(s) links may ever be rendered as clickable hrefs or accepted as URL evidence. */
export function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

/** Returns the URL if it is a safe http(s) link, otherwise undefined (render as plain text). */
export const safeHref = (value: string): string | undefined => (isHttpUrl(value) ? value : undefined);

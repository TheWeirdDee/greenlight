import dns from "node:dns";
import net from "node:net";
import { Agent, fetch as undiciFetch } from "undici";
import type { UrlChecker, UrlCheckResult } from "@/lib/services/context";

/** True for loopback, private, link-local, CGNAT, metadata and other non-public addresses. */
export function isNonPublicIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    if (lower === "::" || lower === "::1") return true;
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isNonPublicIp(mapped[1]);
    return /^f[cd]/.test(lower) || /^fe[89ab]/.test(lower) || lower.startsWith("ff");
  }
  return true; // not an IP: treat as unsafe when called with garbage
}

/** Validates the URL shape before any network activity. Throws a user-presentable message. */
export function assertCheckableUrl(raw: string, opts: { allowHttp?: boolean; allowAnyPort?: boolean } = {}): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Not a valid URL");
  }
  if (url.protocol !== "https:" && !(opts.allowHttp && url.protocol === "http:")) throw new Error("Only https:// URLs can be checked");
  if (url.username || url.password) throw new Error("URLs with embedded credentials are not allowed");
  if (net.isIP(url.hostname.replace(/^\[|\]$/g, ""))) throw new Error("Use a domain name, not an IP address");
  if (!opts.allowAnyPort && url.port && url.port !== "443" && url.port !== "80") throw new Error("Only standard web ports are allowed");
  return url;
}

// Resolves DNS ourselves and refuses non-public answers, at connect time — so a hostname that
// resolves to an internal address (or rebinds between check and connect) can never be reached.
function guardedLookup(
  hostname: string,
  options: dns.LookupOptions,
  cb: (err: NodeJS.ErrnoException | null, address?: string | dns.LookupAddress[], family?: number) => void,
) {
  dns.lookup(hostname, { all: true, verbatim: true }, (err, addresses) => {
    if (err) return cb(err);
    const blocked = addresses.find((a) => isNonPublicIp(a.address));
    if (blocked || addresses.length === 0) {
      return cb(Object.assign(new Error("Host resolves to a non-public address"), { code: "EBLOCKED" }));
    }
    if (options.all) return cb(null, addresses);
    return cb(null, addresses[0].address, addresses[0].family);
  });
}

const MAX_REDIRECTS = 3;
const TIMEOUT_MS = 8_000;

/** `allowHttp` / `allowAnyPort` exist only so tests can aim at a local server; production uses the defaults. */
export function createUrlChecker(opts: { allowHttp?: boolean; allowAnyPort?: boolean } = {}): UrlChecker {
  const agent = new Agent({ connect: { lookup: guardedLookup as never } });

  return {
    async check(raw: string): Promise<UrlCheckResult> {
      let current: URL;
      try {
        current = assertCheckableUrl(raw, opts);
      } catch (e) {
        return { ok: false, status: null, summary: (e as Error).message, finalUrl: null };
      }

      try {
        for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
          const res = await undiciFetch(current, {
            method: "GET",
            redirect: "manual",
            dispatcher: agent,
            signal: AbortSignal.timeout(TIMEOUT_MS),
            headers: { "user-agent": "GreenlightCheck/1.0 (+launch readiness availability check)" },
          });
          void res.body?.cancel();

          if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
            try {
              current = assertCheckableUrl(new URL(res.headers.get("location")!, current).toString(), opts);
            } catch (e) {
              return { ok: false, status: res.status, summary: `Redirect refused: ${(e as Error).message}`, finalUrl: null };
            }
            continue;
          }
          if (res.status >= 200 && res.status < 300) {
            return { ok: true, status: res.status, summary: `HTTP ${res.status} from ${current.hostname}`, finalUrl: current.toString() };
          }
          return { ok: false, status: res.status, summary: `HTTP ${res.status} from ${current.hostname}`, finalUrl: current.toString() };
        }
        return { ok: false, status: null, summary: "Too many redirects", finalUrl: null };
      } catch (e) {
        const err = e as Error & { cause?: { code?: string } };
        if (err.cause?.code === "EBLOCKED" || /non-public/.test(err.cause?.toString() ?? "")) {
          return { ok: false, status: null, summary: "The host resolves to a non-public address and cannot be checked", finalUrl: null };
        }
        if (err.name === "TimeoutError") return { ok: false, status: null, summary: "Timed out after 8 seconds", finalUrl: null };
        return { ok: false, status: null, summary: "Could not connect to the site", finalUrl: null };
      }
    },
  };
}

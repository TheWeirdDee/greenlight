import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

// Origins the browser is allowed to talk to: our own, the Supabase project (REST/Auth/Realtime) and the
// Base Sepolia RPC that wagmi reads balances through.
const supabase = (() => {
  try {
    const u = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "");
    return [u.origin, `${u.protocol === "https:" ? "wss" : "ws"}://${u.host}`];
  } catch {
    return [];
  }
})();

const csp = [
  "default-src 'self'",
  // Next.js emits inline bootstrap scripts and the theme script is inline; there is no third-party script.
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self' ${supabase.join(" ")} https://sepolia.base.org${isDev ? " ws://localhost:* ws://127.0.0.1:*" : ""}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  ...(isDev ? [] : ["upgrade-insecure-requests"]),
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), interest-cohort=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  // Pages are per-user and read live state, so they render dynamically per request.
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  // `undici` ships native-ish Node internals that must not be bundled into the server build.
  serverExternalPackages: ["undici", "postgres"],
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;

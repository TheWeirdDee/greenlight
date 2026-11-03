import type { NextConfig } from "next";

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
};

export default nextConfig;

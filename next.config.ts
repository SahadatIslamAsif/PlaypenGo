import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Every route under app/(app) is dynamic (the layout reads cookies() via
    // Supabase auth). Without this, the client cache TTL for dynamic routes
    // defaults to 0s, so every nav re-runs the layout's auth+profile lookup
    // instead of reusing the just-prefetched shell.
    staleTimes: {
      dynamic: 30,
    },
  },
};

export default nextConfig;

// The service-role client. CLAUDE.md: "Service-role key is used only inside
// the cron route. Never reaches the client" - this module exists so that
// rule has exactly one caller (app/api/cron/evening-digest/route.ts) rather
// than each route hand-rolling its own createClient call. No cookies, no
// request context: @supabase/supabase-js directly, the same shape
// scripts/seed-subjects-catalog.ts already uses for the same key, here
// wrapped for reuse by code that actually ships.

import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

export function createServiceClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must both be set.");
  }

  return createSupabaseClient<Database>(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

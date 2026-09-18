import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { cache } from "react";
import type { Database } from "./database.types";

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Called from a Server Component render — middleware refreshes
            // the session on the next request instead.
          }
        },
      },
    },
  );
}

// auth.getUser() is a real network round trip to Supabase's auth server, not
// a local cookie read — and the layout plus every page under it each used to
// call it independently, paying that round trip 2-3 times over for a single
// navigation (confirmed via the local Kong access log). React's cache() dedupes
// calls with no arguments to one shared promise per request, so this still
// verifies the session for real, just once per request instead of once per
// component that happens to check who's signed in.
export const getUser = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});

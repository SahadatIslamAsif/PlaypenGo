// Allowlists one tutor email so handle_new_user() (0002) will accept a tutor
// signup for it. §1: the tutor is the app owner and there is exactly one in
// v1 - but which address that is varies by deployment, so it does not belong
// baked into the migration that creates the table (0002's own comment there
// explains why). Run by hand once per environment, the same way
// scripts/seed-subjects-catalog.ts seeds subjects_catalog - both tables have
// "no client-writable policy", so both need the service-role key:
//
//   TUTOR_ALLOWLIST_EMAIL=you@example.com npm run db:seed-tutor
//
// Idempotent: re-running with the same email just upserts the same row.

import { createClient } from "@supabase/supabase-js";

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const email = process.env.TUTOR_ALLOWLIST_EMAIL;

  if (!supabaseUrl || !serviceRoleKey || !email) {
    console.error(
      "Set NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and " +
        "TUTOR_ALLOWLIST_EMAIL (e.g. `TUTOR_ALLOWLIST_EMAIL=you@example.com npm run db:seed-tutor`).",
    );
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const { error } = await supabase
    .from("tutor_allowlist")
    .upsert({ email, note: "App owner — the single tutor in v1 (docs/ARCHITECTURE.md §1)." }, { onConflict: "email" });

  if (error) {
    console.error("Seeding tutor_allowlist failed:", error.message);
    process.exit(1);
  }

  console.log(`Allowlisted ${email} as a tutor.`);
}

main();

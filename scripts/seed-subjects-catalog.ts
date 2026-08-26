// Loads seed/subjects.json into public.subjects_catalog (SPEC.md §4.1).
//
// Not part of `supabase db reset` — the catalogue changes once a year at most
// and is edited as JSON, not as SQL migration literals. Run by hand (locally
// or against a hosted project) whenever seed/subjects.json changes:
//
//   npm run db:seed-catalog
//
// Uses the service-role key because subjects_catalog has no client-writable
// policy (§3.3: "readable by all authenticated users, writable by nobody").
// This never runs in the deployed app — it's a one-off setup script invoked
// from a terminal, not shipped code, so it doesn't touch the "service role
// only in the cron route" rule in CLAUDE.md, which is about what reaches the
// browser.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

type CatalogEntry = {
  name: string;
  code: string | null;
  level: "o_level" | "lower_secondary";
  common_aliases: string[];
};

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    console.error(
      "Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY " +
        "(e.g. `npm run db:seed-catalog`, which loads .env.local).",
    );
    process.exit(1);
  }

  const dataPath = fileURLToPath(new URL("../seed/subjects.json", import.meta.url));
  const entries: CatalogEntry[] = JSON.parse(readFileSync(dataPath, "utf-8"));

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const { data, error } = await supabase
    .from("subjects_catalog")
    .upsert(entries, { onConflict: "name,level" })
    .select("id");

  if (error) {
    console.error("Seeding subjects_catalog failed:", error.message);
    process.exit(1);
  }

  console.log(`Seeded ${data?.length ?? 0} subjects_catalog rows from seed/subjects.json.`);
}

main();

-- 0001 — extensions
--
-- PlaypenGo, Phase 1 (ARCHITECTURE.md §9). gen_random_uuid() is core since PG13; pgcrypto
-- is here for gen_random_bytes(), which issues family/tutor codes (§1) and the
-- confirmation tokens of §7.6. Codes gate a minor's grades, so they are drawn
-- from a CSPRNG, never random().

create extension if not exists pgcrypto with schema extensions;

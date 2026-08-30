import Link from "next/link";
import { Check, CircleAlert, X } from "lucide-react";
import { createClient } from "@/lib/supabase/server";

// §7.6's one-tap confirmation, and §8's instruction about what this page is:
// "Email deep links land on a standalone full-screen page with no nav chrome
// and no login - /c/<token> shows one clear confirmation state and nothing
// else. That page is the guardian's most common entry point; treat it as a real
// screen, not a redirect."
//
// So: outside the (app) group, so it inherits no sidebar, no bottom tab bar and
// no shell. One card, one state, and a way back that is a plain link rather than
// an assumption that the reader has an account at all.
//
// -----------------------------------------------------------------------------
// Why the answer is in the query string
//
// The email carries two links - ?a=yes and ?a=no - and landing on one records
// it. That is what makes this one tap rather than two, which is the entire
// feature: §7.6 is called "One-tap confirmation", and its job is to absorb false
// positives from public holidays cheaply enough that nobody resents answering.
// A page that landed on a question and then asked for a second tap would be the
// same number of interactions as opening the app.
//
// The cost is that a link-prefetching mail client could spend the token before a
// person ever sees it. It is a real risk and it is tracked as
// docs/ARCHITECTURE.md §10 item 8 rather than silently designed around, because every fix for it costs the
// second tap. A token with no `a` at all renders the question with both buttons,
// which is also what a client that strips query strings will produce.
//
// The write happens during render, so this must never be prerendered or served
// from a cache.
export const dynamic = "force-dynamic";

type ConfirmResponse = {
  status: "recorded" | "already_answered" | "expired" | "unknown";
  answer?: "yes" | "no";
  subject?: string;
  type?: string;
  target_date?: string;
  window_closed?: string | null;
};

export default async function ConfirmPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ a?: string }>;
}) {
  const { token } = await params;
  const { a } = await searchParams;

  if (a !== "yes" && a !== "no") {
    return <AskState token={token} />;
  }

  // The anon client, deliberately. answer_confirm_token is the one function in
  // the schema `anon` may execute (0026), and the token is what authorises the
  // write - there is no session here to carry any other authority, and
  // CLAUDE.md keeps the service-role key in the cron route alone.
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("answer_confirm_token", {
    p_token: token,
    p_answer: a,
  });

  if (error) {
    return (
      <Shell>
        <StateIcon tone="warn">
          <CircleAlert size={24} strokeWidth={1.5} aria-hidden />
        </StateIcon>
        <h1 className="mt-4 text-xl font-semibold text-ink">Something went wrong</h1>
        <p className="mt-2 text-sm text-body">
          Your answer wasn&apos;t recorded. Open the link again in a moment.
        </p>
      </Shell>
    );
  }

  const response = data as unknown as ConfirmResponse;

  switch (response.status) {
    case "recorded":
      return <RecordedState response={response} />;

    case "already_answered":
      return (
        <Shell>
          <StateIcon tone="quiet">
            <Check size={24} strokeWidth={1.5} aria-hidden />
          </StateIcon>
          <h1 className="mt-4 text-xl font-semibold text-ink">Already answered</h1>
          <p className="mt-2 text-sm text-body">
            You answered {response.answer === "yes" ? "yes" : "no"} to this one. Nothing
            more to do.
          </p>
        </Shell>
      );

    case "expired":
      return (
        <Shell>
          <StateIcon tone="warn">
            <CircleAlert size={24} strokeWidth={1.5} aria-hidden />
          </StateIcon>
          <h1 className="mt-4 text-xl font-semibold text-ink">This link has expired</h1>
          <p className="mt-2 text-sm text-body">
            Links stay open for a week. If the paper came back, log the result in
            PlaypenGo instead.
          </p>
        </Shell>
      );

    default:
      return (
        <Shell>
          <StateIcon tone="warn">
            <CircleAlert size={24} strokeWidth={1.5} aria-hidden />
          </StateIcon>
          <h1 className="mt-4 text-xl font-semibold text-ink">We don&apos;t know this link</h1>
          <p className="mt-2 text-sm text-body">
            Check that you opened the whole link from the email — some apps cut it
            short.
          </p>
        </Shell>
      );
  }
}

function RecordedState({ response }: { response: ConfirmResponse }) {
  const yes = response.answer === "yes";
  const subject = response.subject ?? "that assessment";

  return (
    <Shell>
      <StateIcon tone={yes ? "accent" : "quiet"}>
        {yes ? (
          <Check size={24} strokeWidth={1.5} aria-hidden />
        ) : (
          <X size={24} strokeWidth={1.5} aria-hidden />
        )}
      </StateIcon>

      <h1 className="mt-4 text-xl font-semibold text-ink">Thanks — noted</h1>

      <p className="mt-2 text-sm text-body">
        {yes ? (
          <>
            We&apos;ve marked the {subject} {response.type ?? "CWM"} as having happened
            {response.target_date ? ` on ${formatDate(response.target_date)}` : ""}. It
            will show up as waiting for a mark until the paper is logged.
          </>
        ) : (
          <>
            We&apos;ll stop expecting the {subject} {response.type ?? "CWM"}{" "}
            {response.target_date ? `on ${formatDate(response.target_date)}` : "that day"}
            {response.window_closed === "two_no_in_a_row"
              ? " — and we'll stop asking about this one altogether."
              : " and watch the next class instead."}
          </>
        )}
      </p>

      <p className="mt-6 text-xs text-muted">You can close this page.</p>
    </Shell>
  );
}

/**
 * No answer in the link. Either someone opened the bare URL, or a mail client
 * stripped the query string on the way — either way the question still needs
 * putting, so it is put here rather than shown as an error.
 */
function AskState({ token }: { token: string }) {
  return (
    <Shell>
      <h1 className="text-xl font-semibold text-ink">Did this assessment happen?</h1>
      <p className="mt-2 text-sm text-body">
        Tap the answer that matches. It takes one tap and no sign-in.
      </p>

      <div className="mt-6 flex gap-3">
        <Link
          href={`/c/${token}?a=yes`}
          className="inline-flex h-11 flex-1 items-center justify-center rounded-button bg-ink px-4 text-sm font-semibold text-shell transition-colors hover:bg-ink/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          Yes, it happened
        </Link>
        <Link
          href={`/c/${token}?a=no`}
          className="inline-flex h-11 flex-1 items-center justify-center rounded-button border border-hairline bg-surface px-4 text-sm font-semibold text-body transition-colors hover:bg-surface-sunk focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          No, it didn&apos;t
        </Link>
      </div>
    </Shell>
  );
}

/**
 * §8's "standalone full-screen page with no nav chrome". Centred on the wash,
 * one card, nothing else on screen — and a 12px gutter on a phone, per the
 * design system's mobile rule that the shell dissolves.
 */
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center px-3 py-12">
      <div className="w-full max-w-sm rounded-shell border border-hairline bg-shell p-8 text-center shadow-elevated">
        {children}
      </div>
    </main>
  );
}

function StateIcon({
  tone,
  children,
}: {
  tone: "accent" | "quiet" | "warn";
  children: React.ReactNode;
}) {
  const tones = {
    accent: "bg-accent/12 text-accent",
    quiet: "bg-surface-sunk text-muted",
    warn: "bg-danger-tint text-danger",
  } as const;

  return (
    <div
      className={`mx-auto flex h-12 w-12 items-center justify-center rounded-full ${tones[tone]}`}
    >
      {children}
    </div>
  );
}

/** `2026-08-31` -> `Monday 31 August`. The reader is checking a memory, not parsing an ID. */
function formatDate(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString("en-GB", {
    timeZone: "UTC",
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

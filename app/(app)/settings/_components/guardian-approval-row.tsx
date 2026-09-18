"use client";

import { Check, X } from "lucide-react";
import { useState, useTransition } from "react";
import { approveGuardianLink, revokeGuardianLink } from "@/lib/linking/actions";

type Decision = "pending" | "approved" | "denied";

export function GuardianApprovalRow({
  linkId,
  guardianName,
  studentName,
}: {
  linkId: string;
  guardianName: string;
  studentName: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Plain state, not useOptimistic: there's no server-confirmed prop for
  // this row to converge back to once the transition settles - the row
  // just disappears from the parent's pending list on the next revalidate.
  // useOptimistic would revert to its hardcoded base ("pending") the
  // instant the transition finishes, flashing the buttons back before
  // that removal lands.
  const [decision, setDecision] = useState<Decision>("pending");

  function approve() {
    setDecision("approved");
    startTransition(async () => {
      const result = await approveGuardianLink(linkId);
      if (result.error) {
        setError(result.error);
        setDecision("pending");
      }
    });
  }

  function deny() {
    setDecision("denied");
    startTransition(async () => {
      const result = await revokeGuardianLink(linkId);
      if (result.error) {
        setError(result.error);
        setDecision("pending");
      }
    });
  }

  if (decision !== "pending") {
    return (
      <div className="flex items-center justify-between rounded-tint bg-tint-sage px-3 py-2 opacity-60">
        <div>
          <p className="text-sm text-tint-ink">{guardianName}</p>
          <p className="text-xs text-tint-ink/60">wants to follow {studentName}</p>
        </div>
        <p className="text-xs font-medium text-tint-ink">
          {decision === "approved" ? "Approved" : "Denied"}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between rounded-tint bg-tint-sage px-3 py-2">
        <div>
          <p className="text-sm text-tint-ink">{guardianName}</p>
          <p className="text-xs text-tint-ink/60">wants to follow {studentName}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={approve}
            aria-label="Approve"
            className="flex h-9 w-9 items-center justify-center rounded-button bg-ink text-shell transition-colors hover:bg-ink/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60"
          >
            <Check className="h-4 w-4" strokeWidth={2} />
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={deny}
            aria-label="Deny"
            className="flex h-9 w-9 items-center justify-center rounded-button bg-white text-tint-ink transition-colors hover:bg-white/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60"
          >
            <X className="h-4 w-4" strokeWidth={2} />
          </button>
        </div>
      </div>
      {error ? <p className="text-xs text-danger">{error}</p> : null}
    </div>
  );
}

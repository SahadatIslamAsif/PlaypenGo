"use client";

import { Check, X } from "lucide-react";
import { useState, useTransition } from "react";
import { approveGuardianLink, revokeGuardianLink } from "@/lib/linking/actions";

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

  function approve() {
    startTransition(async () => {
      const result = await approveGuardianLink(linkId);
      setError(result.error);
    });
  }

  function deny() {
    startTransition(async () => {
      const result = await revokeGuardianLink(linkId);
      setError(result.error);
    });
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

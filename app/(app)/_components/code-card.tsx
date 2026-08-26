"use client";

import { useState, useTransition } from "react";
import { Copy, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { issueLinkCode } from "@/lib/linking/actions";

function formatExpiry(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function CodeCard({
  title,
  description,
  initialCode,
  initialExpiresAt,
}: {
  title: string;
  description: string;
  initialCode: string | null;
  initialExpiresAt: string | null;
}) {
  const [code, setCode] = useState(initialCode);
  const [expiresAt, setExpiresAt] = useState(initialExpiresAt);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();

  function handleGenerate() {
    setCopied(false);
    startTransition(async () => {
      const result = await issueLinkCode();
      if (result.error) {
        setError(result.error);
        return;
      }
      setError(null);
      setCode(result.code);
      setExpiresAt(result.expiresAt);
    });
  }

  async function handleCopy() {
    if (!code) return;
    await navigator.clipboard.writeText(code);
    setCopied(true);
  }

  return (
    <Card>
      <p className="text-sm font-semibold text-ink">{title}</p>
      <p className="mt-0.5 text-xs text-muted">{description}</p>

      {code ? (
        <div className="mt-4 flex items-center justify-between rounded-tint bg-tint-mint px-4 py-3">
          <div>
            <p className="font-display text-lg font-semibold tracking-[0.2em] text-tint-ink">
              {code}
            </p>
            {expiresAt ? (
              <p className="text-xs text-tint-ink/60">Valid until {formatExpiry(expiresAt)}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={handleCopy}
            aria-label="Copy code"
            className="flex h-11 w-11 items-center justify-center rounded-button bg-white text-tint-ink transition-colors hover:bg-white/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <Copy className="h-[18px] w-[18px]" strokeWidth={1.5} />
          </button>
        </div>
      ) : null}
      {copied ? <p className="mt-1 text-xs text-accent">Copied.</p> : null}
      {error ? <p className="mt-1 text-xs text-red-600">{error}</p> : null}

      <Button
        type="button"
        variant="secondary"
        onClick={handleGenerate}
        disabled={pending}
        className="mt-4 w-full"
      >
        <RefreshCw className="h-4 w-4" strokeWidth={1.5} />
        {code ? "Generate a new code" : pending ? "Generating…" : "Generate code"}
      </Button>
    </Card>
  );
}

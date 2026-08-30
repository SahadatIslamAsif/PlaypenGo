// CLAUDE.md: "skeleton-load cards rather than blocking the screen." Every
// route.tsx here is a Server Component doing a multi-query Promise.all, so
// without a loading.tsx Next renders nothing until it all resolves - a
// blank flash on the exact connections this line is about. app/globals.css's
// `@media (prefers-reduced-motion: reduce)` rule already collapses
// animation-duration globally, so animate-pulse here needs no extra guard.
export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-card bg-surface-sunk ${className}`} />;
}

import { Skeleton } from "@/components/ui/skeleton";

// Default skeleton for every route under the (app) shell that doesn't
// define its own more specific loading.tsx - a generic "cards are coming"
// shape rather than a blank screen while the page's Promise.all resolves.
export default function AppLoading() {
  return (
    <div className="flex flex-col gap-5">
      <Skeleton className="h-7 w-40" />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
      </div>
      <Skeleton className="h-40" />
      <Skeleton className="h-40" />
    </div>
  );
}

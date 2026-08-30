import { Skeleton } from "@/components/ui/skeleton";

// The roster is the N+1-per-student fetch the audit flagged as the
// slowest page in the app - shaped like RosterList's cards so the layout
// doesn't jump once real rows arrive.
export default function TutorRosterLoading() {
  return (
    <div className="flex flex-col gap-5">
      <Skeleton className="h-7 w-28" />
      <div className="flex flex-col gap-3">
        <Skeleton className="h-16" />
        <Skeleton className="h-16" />
        <Skeleton className="h-16" />
      </div>
    </div>
  );
}

import { Skeleton } from "@/components/ui/skeleton";

// Shaped like the drill-down's header + Tomorrow/Unlogged/Weak
// chapters/This week cards + the results list beneath them.
export default function TutorStudentLoading() {
  return (
    <div className="flex flex-col gap-5">
      <div>
        <Skeleton className="h-4 w-16" />
        <Skeleton className="mt-2 h-7 w-48" />
      </div>
      <Skeleton className="h-24" />
      <Skeleton className="h-24" />
      <Skeleton className="h-24" />
      <div className="flex flex-col gap-3">
        <Skeleton className="h-20" />
        <Skeleton className="h-20" />
      </div>
    </div>
  );
}

import { Skeleton } from "@/components/ui/skeleton";

export default function ReconciliationLoading() {
  return (
    <div className="flex flex-col gap-5">
      <div>
        <Skeleton className="h-4 w-24" />
        <Skeleton className="mt-2 h-7 w-56" />
      </div>
      <div className="flex flex-col gap-3">
        <Skeleton className="h-20" />
        <Skeleton className="h-20" />
        <Skeleton className="h-20" />
        <Skeleton className="h-20" />
      </div>
    </div>
  );
}

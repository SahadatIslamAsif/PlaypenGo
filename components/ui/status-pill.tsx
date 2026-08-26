type Status = "pending" | "approved" | "revoked";

const styles: Record<Status, string> = {
  pending: "bg-tint-sage text-tint-ink",
  approved: "bg-accent text-shell",
  revoked: "bg-surface-sunk text-muted",
};

const labels: Record<Status, string> = {
  pending: "Pending",
  approved: "Approved",
  revoked: "Revoked",
};

export function StatusPill({ status }: { status: Status }) {
  return (
    <span
      className={`inline-flex items-center rounded-pill px-2.5 py-1 text-xs font-medium ${styles[status]}`}
    >
      {labels[status]}
    </span>
  );
}

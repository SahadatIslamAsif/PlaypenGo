import type { HTMLAttributes } from "react";

export function Card({
  className = "",
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`rounded-card border border-hairline bg-surface p-5 shadow-soft ${className}`}
      {...props}
    />
  );
}

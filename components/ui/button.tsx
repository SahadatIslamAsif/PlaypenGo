import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "destructive";

const base =
  "inline-flex h-10 items-center justify-center gap-2 rounded-button px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-60";

const variants: Record<Variant, string> = {
  primary: "bg-ink text-shell hover:bg-ink/90",
  secondary: "border border-hairline bg-surface text-ink hover:bg-surface-sunk",
  destructive: "bg-white text-red-600 border border-red-200 hover:bg-red-50",
};

export function Button({
  variant = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      className={`${base} ${variants[variant]} ${className}`}
      {...props}
    />
  );
}

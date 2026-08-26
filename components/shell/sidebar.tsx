"use client";

import { LogOut } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOutAction } from "@/lib/auth/actions";
import { SIDEBAR_NAV, type Role } from "./nav-items";

// ≥1024px only. Design system: "56px avatar, name 16/600, email 12 muted. Nav
// rows 44px, icon 18 at stroke 1.5 plus label. Active row is a filled --ink
// pill, white icon and label. Inactive is --muted. Log out pinned to the
// bottom above a hairline."

export function Sidebar({
  fullName,
  email,
  role,
}: {
  fullName: string | null;
  email: string | null;
  role: Role;
}) {
  const pathname = usePathname();
  const items = SIDEBAR_NAV[role];

  return (
    <aside className="flex h-full w-[232px] shrink-0 flex-col border-r border-hairline p-4">
      <div className="flex items-center gap-3 px-2 pb-6">
        <div
          aria-hidden="true"
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-tint-mint text-sm font-semibold text-tint-ink"
        >
          {initialsOf(fullName)}
        </div>
        <div className="min-w-0">
          <p className="truncate text-base font-semibold text-ink">
            {fullName ?? "Your account"}
          </p>
          <p className="truncate text-xs text-muted">{email ?? role}</p>
        </div>
      </div>

      <nav className="flex flex-1 flex-col gap-1">
        {items.map((item) => {
          const active = pathname === item.href;
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`flex h-11 items-center gap-3 rounded-button px-3 text-sm font-medium transition-colors ${
                active ? "bg-ink text-shell" : "text-muted hover:text-ink"
              }`}
            >
              <Icon className="h-[18px] w-[18px] shrink-0" strokeWidth={1.5} />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <form action={signOutAction} className="border-t border-hairline pt-3">
        <button
          type="submit"
          className="flex h-11 w-full items-center gap-3 rounded-button px-3 text-sm font-medium text-muted transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <LogOut className="h-[18px] w-[18px]" strokeWidth={1.5} />
          Log out
        </button>
      </form>
    </aside>
  );
}

function initialsOf(name: string | null): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  return (parts[0]?.[0] ?? "").concat(parts[1]?.[0] ?? "").toUpperCase() || "?";
}

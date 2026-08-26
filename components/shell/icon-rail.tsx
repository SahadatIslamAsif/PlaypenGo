"use client";

import { LogOut } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOutAction } from "@/lib/auth/actions";
import { SIDEBAR_NAV, type Role } from "./nav-items";

// 640-1023px: the sidebar collapsed to a 72px icon rail (design system).
// Same nav, same active/inactive treatment, label dropped and carried by
// `title` + `aria-label` instead.

export function IconRail({ role }: { role: Role }) {
  const pathname = usePathname();
  const items = SIDEBAR_NAV[role];

  return (
    <aside className="flex h-full w-[72px] shrink-0 flex-col items-center border-r border-hairline py-4">
      <nav className="flex flex-1 flex-col items-center gap-1">
        {items.map((item) => {
          const active = pathname === item.href;
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              title={item.label}
              aria-label={item.label}
              aria-current={active ? "page" : undefined}
              className={`flex h-11 w-11 items-center justify-center rounded-button transition-colors ${
                active ? "bg-ink text-shell" : "text-muted hover:text-ink"
              }`}
            >
              <Icon className="h-[18px] w-[18px]" strokeWidth={1.5} />
            </Link>
          );
        })}
      </nav>

      <form action={signOutAction} className="border-t border-hairline pt-3">
        <button
          type="submit"
          aria-label="Log out"
          className="flex h-11 w-11 items-center justify-center rounded-button text-muted transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <LogOut className="h-[18px] w-[18px]" strokeWidth={1.5} />
        </button>
      </form>
    </aside>
  );
}

// One nav model, rendered three ways (sidebar, icon rail, bottom tabs) plus a
// fourth shape for the guardian's segmented control. Keeping the item list in
// one place means a route never goes missing from one breakpoint because it
// was only added to another.
//
// Settings is a real nav row here, not a header icon — reachable from the
// sidebar/icon-rail on ≥640, from the bottom tab bar's "More" slot on mobile
// for student/tutor, and it is the one item guardian's segmented control
// still needs a path to (see bottom-tabs.tsx and segmented-nav.tsx).

import {
  BookOpen,
  CalendarClock,
  Home,
  LineChart,
  type LucideIcon,
  Settings,
} from "lucide-react";

export type Role = "student" | "guardian" | "tutor";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
};

const HOME: NavItem = { href: "/", label: "Home", icon: Home };
const SUBJECTS: NavItem = { href: "/subjects", label: "Subjects", icon: BookOpen };
const RESULTS: NavItem = { href: "/results", label: "Results", icon: LineChart };
const ROUTINE: NavItem = { href: "/routine", label: "Routine", icon: CalendarClock };
const SETTINGS: NavItem = { href: "/settings", label: "Settings", icon: Settings };

// The full nav for the sidebar (≥1024) and icon rail (640-1023) — every
// destination a role can reach, Settings included.
export const SIDEBAR_NAV: Record<Role, NavItem[]> = {
  student: [HOME, SUBJECTS, RESULTS, ROUTINE, SETTINGS],
  // CLAUDE.md's target for the tutor is "Students · Results · More", but the
  // roster is Phase 7 and nothing may point at a page that does not exist.
  // Until it does, Home stands in for it: the routes below already accept a
  // `?student=` param and default to the first linked student. Routine is
  // read-only for a tutor since 0019, but reading it is most of why they open
  // it — knowing what the student has tomorrow.
  tutor: [HOME, RESULTS, ROUTINE, SETTINGS],
  guardian: [HOME, SUBJECTS, RESULTS, ROUTINE, SETTINGS],
};

// The bottom tab bar (<640) for student and tutor. CLAUDE.md puts a raised
// Scan circle in the middle of the STUDENT's bar only — "The tutor has no
// scan affordance anywhere" — so it is not an item in either list here;
// bottom-tabs.tsx renders it over the bar for the student and nothing for the
// tutor. "More" points at Settings for now; once a second secondary
// destination exists it becomes a sheet instead of a direct link, but there
// is nothing else to put in a sheet today.
export const BOTTOM_TABS: Record<"student" | "tutor", NavItem[]> = {
  student: [HOME, SUBJECTS, RESULTS, ROUTINE],
  tutor: [HOME, RESULTS, ROUTINE],
};

export const MORE_ITEM = SETTINGS;

// The guardian's mobile segmented control (<640): "no tab bar — three views".
// Subjects (syllabus coverage) is folded into the Home dashboard's content
// rather than being a fourth destination, keeping this at exactly three.
export const GUARDIAN_SEGMENTS: NavItem[] = [HOME, RESULTS, ROUTINE];

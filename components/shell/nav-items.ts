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
  MoreHorizontal,
  ScanLine,
  Settings,
  Users,
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
// Phase 7's roster - CLAUDE.md's tutor bar is literally "Students · Results
// · More", and this is that first item. Distinct from HOME: a tutor has no
// personal dashboard, so their first destination is the student list, not a
// stand-in for one.
const STUDENTS: NavItem = { href: "/tutor", label: "Students", icon: Users };

// A normal list entry in SIDEBAR_NAV (≥640, every role reachable there gets
// every destination) - but never in BOTTOM_TABS below, where it's instead
// rendered as the raised --ink circle overlapping the bar, student only.
export const SCAN: NavItem = { href: "/scan", label: "Scan", icon: ScanLine };

// The full nav for the sidebar (≥1024) and icon rail (640-1023) — every
// destination a role can reach, Settings included. Scan included too: the
// mobile bottom bar's raised circle is a phone-specific affordance, not the
// only way in — a laptop student with the khata beside them needs a way to
// reach /scan without typing the URL, and capture="environment" just
// degrades to a normal file picker there (CLAUDE.md's rule is "camera, not
// a file picker" for the phone flow specifically; a desktop file picker is
// the ordinary, expected control).
export const SIDEBAR_NAV: Record<Role, NavItem[]> = {
  student: [HOME, SUBJECTS, SCAN, RESULTS, ROUTINE, SETTINGS],
  // CLAUDE.md's target: "Students · Results · More". /tutor (Phase 7) is now
  // that first destination - the roster, sorted by unlogged count, with a
  // per-student drill-down. Results/Routine still take the same `?student=`
  // param the roster's drill-down links through; Routine is read-only for a
  // tutor since 0019, but reading it is most of why they open it — knowing
  // what the student has tomorrow.
  tutor: [STUDENTS, RESULTS, ROUTINE, SETTINGS],
  guardian: [HOME, SUBJECTS, RESULTS, ROUTINE, SETTINGS],
};

// The bottom tab bar (<640) for student and tutor. CLAUDE.md puts a raised
// Scan circle "centre" over the STUDENT's bar, overlapping no tab, with the
// bar itself capped at five items total (four tabs plus the circle) — "Home
// · Subjects · Scan · Results · More". That only centres cleanly with an
// EVEN number of real tabs either side of the gap the circle sits in, so
// Routine drops out of the student's own four tabs here and moves behind
// "More" alongside Settings (see MORE_SHEET_ITEMS) — bottom-tabs.tsx turns
// "More" into a sheet trigger for the student for exactly this reason, now
// that there are two destinations behind it rather than one.
//
// The tutor has no Scan circle to centre around ("the tutor has no scan
// affordance anywhere"), so their bar keeps Routine as its own tab and
// "More" stays a direct link to Settings, same as before.
export const BOTTOM_TABS: Record<"student" | "tutor", NavItem[]> = {
  student: [HOME, SUBJECTS, RESULTS],
  tutor: [STUDENTS, RESULTS, ROUTINE],
};

// The bottom bar's last slot. Its href only matters for the tutor, who
// still gets a direct link to Settings; for the student, bottom-tabs.tsx
// renders this slot as a sheet trigger instead and ignores the href,
// opening MORE_SHEET_ITEMS.
export const MORE_ITEM: NavItem = { href: "/settings", label: "More", icon: MoreHorizontal };

// What's behind the student's "More" sheet - Routine (dropped from
// BOTTOM_TABS.student above) plus Settings, the same pair SIDEBAR_NAV
// already reaches at ≥640.
export const MORE_SHEET_ITEMS: NavItem[] = [ROUTINE, SETTINGS];

// The guardian's mobile segmented control (<640): "no tab bar — three views".
// Subjects (syllabus coverage) is folded into the Home dashboard's content
// rather than being a fourth destination, keeping this at exactly three.
export const GUARDIAN_SEGMENTS: NavItem[] = [HOME, RESULTS, ROUTINE];

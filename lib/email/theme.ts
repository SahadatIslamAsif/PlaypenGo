// The design system, as inline styles.
//
// CLAUDE.md, twice: "Rendered with `react-email` — inline styles only, Tailwind
// classes do not survive email clients", and "No emoji anywhere. Not in
// headings, empty states, buttons, or email templates. Icons only." There are
// no icons here either — an <img> in email is blocked by default in most
// clients and a broken-image box is worse than the word it replaced — so the
// digest carries its meaning in type and colour alone.
//
// Light palette only. The app's dark mode is a `prefers-color-scheme` media
// query on a stylesheet, and a stylesheet is exactly what does not survive the
// trip: Gmail strips <style> in several of its clients, and Outlook's Word
// rendering engine ignores most of it. A single palette that is legible
// everywhere beats a clever one that inverts in two clients out of nine.
//
// The values are the design system's own, unchanged.

export const color = {
  wash: "#EDF8F1",
  washEnd: "#DCF0E4",
  surface: "#FFFFFF",
  surfaceSunk: "#F5F8F6",
  ink: "#0E1A14",
  body: "#3B4A42",
  muted: "#8A9A92",
  hairline: "#E6EFE9",
  accent: "#1B7A50",
  tintMint: "#DCF0E2",
  tintSage: "#E6F1D9",
  tintTeal: "#D6EDEA",
} as const;

// next/font gives the app Outfit and Inter. Neither is loadable in most email
// clients, so each stack names the intended face first and then degrades
// through what is actually installed on a phone.
export const font = {
  display: "'Outfit', 'Segoe UI', Roboto, -apple-system, BlinkMacSystemFont, sans-serif",
  body: "'Inter', 'Segoe UI', Roboto, -apple-system, BlinkMacSystemFont, sans-serif",
} as const;

export const style = {
  body: {
    margin: 0,
    padding: 0,
    backgroundColor: color.wash,
    fontFamily: font.body,
    // §7 is read on a phone in Dhaka, usually in bed. 15px, not 14 — email has
    // no zoom affordance the way a web page does.
    fontSize: "15px",
    lineHeight: "1.55",
    color: color.body,
  },

  container: {
    maxWidth: "600px",
    margin: "0 auto",
    padding: "24px 12px 40px",
  },

  card: {
    backgroundColor: color.surface,
    borderRadius: "20px",
    padding: "20px",
    marginBottom: "16px",
    // "Separation comes from the wash behind white cards, never from heavy
    // borders" — so a hairline, and no shadow at all. Email clients that
    // support box-shadow are a minority and the ones that do not render
    // nothing, which would leave the card floating on the wash unaided.
    border: `1px solid ${color.hairline}`,
  },

  greeting: {
    fontFamily: font.display,
    fontSize: "22px",
    fontWeight: 600,
    color: color.ink,
    margin: "0 0 4px",
  },

  sectionTitle: {
    fontFamily: font.display,
    fontSize: "17px",
    fontWeight: 600,
    color: color.ink,
    margin: "0 0 12px",
  },

  caption: {
    fontSize: "12px",
    color: color.muted,
    margin: 0,
  },

  paragraph: {
    fontSize: "15px",
    color: color.body,
    margin: "0 0 12px",
  },

  // The timeline shape from the design system: a tinted card with a 3px
  // full-height accent bar on its left edge. Built as a left border, which is
  // the one border style every email client renders.
  entry: {
    backgroundColor: color.tintMint,
    borderLeft: `3px solid ${color.accent}`,
    borderRadius: "0 16px 16px 0",
    padding: "12px 14px",
    marginBottom: "8px",
  },

  entryTitle: {
    fontSize: "15px",
    fontWeight: 600,
    color: color.ink,
    margin: 0,
  },

  entryMeta: {
    fontSize: "12px",
    color: color.muted,
    margin: "2px 0 0",
  },

  // Marks and percentages "use font-variant-numeric: tabular-nums so columns
  // align". Most email clients ignore the property; the monospace fallback in
  // the stack is what actually delivers the alignment in a table of marks.
  numeric: {
    fontVariantNumeric: "tabular-nums",
    fontFeatureSettings: "'tnum'",
  },

  table: {
    width: "100%",
    borderCollapse: "collapse" as const,
    fontSize: "14px",
  },

  th: {
    textAlign: "left" as const,
    fontSize: "12px",
    fontWeight: 500,
    color: color.muted,
    padding: "0 8px 8px 0",
    borderBottom: `1px solid ${color.hairline}`,
  },

  td: {
    padding: "10px 8px 10px 0",
    borderBottom: `1px solid ${color.hairline}`,
    color: color.body,
    verticalAlign: "top" as const,
  },

  // The near-black pill is the signature; in email it is the one button.
  buttonPrimary: {
    display: "inline-block",
    backgroundColor: color.ink,
    color: color.surface,
    fontSize: "14px",
    fontWeight: 600,
    textDecoration: "none",
    padding: "11px 18px",
    borderRadius: "12px",
  },

  buttonSecondary: {
    display: "inline-block",
    backgroundColor: color.surface,
    color: color.body,
    fontSize: "14px",
    fontWeight: 600,
    textDecoration: "none",
    padding: "10px 17px",
    borderRadius: "12px",
    border: `1px solid ${color.hairline}`,
  },

  footer: {
    fontSize: "12px",
    color: color.muted,
    textAlign: "center" as const,
    margin: "24px 0 0",
  },
} as const;

/** The three tint fills, in the rotation the design system specifies. */
export const tints = [color.tintMint, color.tintSage, color.tintTeal] as const;

export function tintAt(index: number): string {
  return tints[index % tints.length];
}

/** `2026-08-31` -> `Mon 31 Aug`. Short: these sit in tight rows. */
export function shortDate(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString("en-GB", {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

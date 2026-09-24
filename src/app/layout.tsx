import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { getDb } from "@/lib/db";
import { getCenter } from "@/lib/repo/center";
import { centerDisplayName } from "@/lib/types";
import { deriveTheme } from "@/lib/theme";

// The center's brand color is read on the server, so the accent is correct on
// first paint — no client flash. Requires a live DB read per request.
export const dynamic = "force-dynamic";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/**
 * Front Desk is a multi-tenant Brightwheel component: the tab title reflects the
 * center that's configured, with a generic fallback when none is seeded.
 */
export function generateMetadata(): Metadata {
  const center = getCenter(getDb());
  const title = center ? centerDisplayName(center) : "Front Desk";
  return {
    title,
    description:
      "Front Desk by Brightwheel — fast, grounded answers about hours, tuition, sick-day policy, meals, and tours, straight from your center.",
  };
}

export default function RootLayout({ children }: LayoutProps<"/">) {
  // Layer B (analysis/10 §5): inject only the accent tokens from the tenant's
  // brand color, once at the root so both surfaces share the accent. The neutral
  // structure tokens come from :root in globals.css and are never overridden.
  const center = getCenter(getDb());
  const t = deriveTheme(center?.brand_color ?? "");
  const darkAccent = `@media (prefers-color-scheme: dark){body{--brand:${t.brandDark};--brand-strong:${t.brandDarkStrong};--brand-fg:${t.brandDarkFg};}}`;

  return (
    <html
      lang="en"
      // The accent tokens live on <body> and browser extensions (Grammarly,
      // Dark Reader, …) commonly inject attributes onto <html>/<body> before
      // React hydrates. suppressHydrationWarning is shallow — it only silences a
      // mismatch on these two elements' own attributes, not anything the app
      // renders inside them, so real hydration bugs still surface.
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body
        suppressHydrationWarning
        className="min-h-full flex flex-col"
        style={
          {
            "--brand": t.brand,
            "--brand-strong": t.brandStrong,
            "--brand-fg": t.brandFg,
          } as React.CSSProperties
        }
      >
        <style>{darkAccent}</style>
        {children}
      </body>
    </html>
  );
}

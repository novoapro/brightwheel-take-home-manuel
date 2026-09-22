/**
 * "Powered by Brightwheel" footer (analysis/10 §3.2). Front Desk is a component
 * a center turns on inside the Brightwheel platform, so the platform is
 * attributed on every surface — parent (`/`, `/handbook`) and admin alike.
 *
 * Text-only attribution: the app now carries its own logo (the service bell —
 * see FrontDeskLogo), so the platform is credited by name here rather than with
 * its logo graphic. Always Layer A — it reads none of the --brand* tokens, so it
 * stays neutral even on a color-themed parent surface.
 */
export default function PoweredByBrightwheel() {
  return (
    <footer className="flex items-center justify-center gap-1.5 py-4 text-xs text-muted">
      <span>Powered by</span>
      <span
        className="font-semibold tracking-tight text-foreground/80"
        style={{ fontFamily: "var(--font-brand-wordmark)" }}
      >
        Brightwheel
      </span>
    </footer>
  );
}

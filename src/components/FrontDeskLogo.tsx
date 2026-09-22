/**
 * Front Desk's own logo — a service/call bell, the universal front-desk mark:
 * warm, instantly legible, and rounded to match the product's soft geometry.
 * Drawn in `currentColor`, so it inherits whatever color it's placed on (it
 * picks up the tenant accent in the console). This is the *app's* identity —
 * distinct from the tenant's BrandMark that parents see on their own surface.
 */
export default function FrontDeskLogo({
  className = "h-6 w-6",
  style,
}: {
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      style={style}
      role="img"
      aria-label="Front Desk"
    >
      {/* dome */}
      <path d="M4.7 16.5a7.3 7.3 0 0 1 14.6 0z" />
      {/* stalk + top button */}
      <rect x="11.1" y="7.4" width="1.8" height="2.4" rx="0.9" />
      <circle cx="12" cy="6.2" r="1.7" />
      {/* base tray */}
      <rect x="3" y="16.4" width="18" height="2.7" rx="1.35" />
      {/* little foot / clapper hint */}
      <circle cx="12" cy="21" r="1.15" />
    </svg>
  );
}

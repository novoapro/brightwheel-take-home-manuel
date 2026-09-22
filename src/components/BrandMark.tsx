import FrontDeskLogo from "@/components/FrontDeskLogo";

/**
 * The tenant's brand mark (analysis/10 §4): an uploaded institution logo if the
 * center has one, otherwise the app's own icon (the Front Desk bell). One place
 * resolves the precedence so every surface renders the mark identically.
 */
export default function BrandMark({
  logo,
  className = "",
  imgSize = 28,
}: {
  logo?: string | null;
  /** Extra classes for the wrapper. */
  className?: string;
  /** Rendered pixel size for the logo image / fallback icon. */
  imgSize?: number;
}) {
  if (logo) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={logo}
        alt=""
        aria-hidden
        width={imgSize}
        height={imgSize}
        className={`inline-block rounded-md object-contain ${className}`}
        style={{ width: imgSize, height: imgSize }}
      />
    );
  }
  return (
    <FrontDeskLogo
      className={`shrink-0 text-brand-strong ${className}`}
      style={{ width: imgSize, height: imgSize }}
    />
  );
}

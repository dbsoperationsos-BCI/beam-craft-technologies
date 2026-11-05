import Link from "next/link";

/** The BeamCraft wordmark with its red play mark, linking to the top of the home page. */
export default function MarketingLogo({ size = 32 }) {
  return (
    <Link href="/" className="flex items-center gap-2">
      <svg viewBox="0 0 32 32" width={size} height={size} fill="none" aria-hidden="true" className="shrink-0">
        <path d="M7 5.5C7 4.7 7.9 4.2 8.6 4.6L25 15.1C25.7 15.5 25.7 16.5 25 16.9L8.6 27.4C7.9 27.8 7 27.3 7 26.5V5.5Z" fill="hsl(var(--mk-primary))" />
      </svg>
      <span className={`font-mk-display ${size >= 36 ? "text-xl" : "text-lg"} font-bold tracking-tight text-mk-foreground`}>BeamCraft</span>
    </Link>
  );
}

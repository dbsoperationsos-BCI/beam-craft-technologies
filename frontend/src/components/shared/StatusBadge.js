import { statusToneClass } from "@/lib/statusTones.mjs";

/**
 * A short state in a pill - "Finalized", "Unfinalized" - in one of the shared tones
 * (`lib/statusTones.mjs`): `success` or `neutral`. The words carry the state;
 * the colour only repeats it.
 */
export default function StatusBadge({ tone = "neutral", className = "", children }) {
  return <span className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-semibold leading-4 ${statusToneClass(tone)} ${className}`}>{children}</span>;
}

import { STAGE_LABEL, STAGE_TONE } from "@/lib/project-figures";

/** A project's stage in its colour: active blue, completed amber, settled green, closed grey. */
export function StageBadge({ stage }: { stage: string }) {
  const tone = STAGE_TONE[stage]?.badge ?? STAGE_TONE.closed.badge;
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${tone}`}>
      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />
      {STAGE_LABEL[stage] ?? stage}
    </span>
  );
}

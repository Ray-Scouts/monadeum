import { REALLOCATION_OFF_REASON } from "@monadeum/reallocation/switch";

/** What the sample's reallocation moves stand for. The sample illustrates the design; a deployment runs with it off. */
export const SAMPLE_REALLOCATION_NOTE = `This sample shows the reallocation mechanism as designed, with sample policies and moves. It does not describe a running deployment. ${REALLOCATION_OFF_REASON}`;

export function SampleReallocationNote() {
  return (
    <p role="note" className="rounded-xl border border-line-soft bg-surface-2 px-4 py-3 text-[13px] text-muted">
      {SAMPLE_REALLOCATION_NOTE}
    </p>
  );
}

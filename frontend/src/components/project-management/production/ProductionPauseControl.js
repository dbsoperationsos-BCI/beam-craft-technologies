"use client";

import { useState } from "react";
import Button from "@/components/shared/Button";
import InlineAlert from "@/components/shared/InlineAlert";
import TextAreaField from "@/components/shared/TextAreaField";
import useFormErrors from "@/components/shared/useFormErrors";
import useSubmitOnce from "@/components/shared/useSubmitOnce";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { pauseProductionShoot } from "@/services/project-management/production.service";

/**
 * Pausing the shoot, and resuming it.
 *
 * A shoot really does stop - a power cut, rain, the family not ready - and everybody looking at the
 * board needs to see that rather than a step that has sat there for two hours. It is **not a step**:
 * the shoot stops where it stands and carries on from the same place, so this sits in the step's own
 * title bar beside the rail rather than taking a place in the order, and the server writes the
 * status across whichever step the shoot is on (`steps.pauseRefusal`).
 *
 * Both directions say **why**, in one box: a pause is read by whoever is waiting on the shoot, and a
 * resume is the same fact the other way round. The reason shows under the title while the shoot is
 * stopped, so nobody has to open the log to find out what happened.
 *
 * `part` draws one of the two, because they belong in different places: `"action"` is the button,
 * which sits on the step's own title line opposite the step name, and `"notice"` is the amber line
 * under it carrying the reason. Drawn together the button would be buried in a block of text, and
 * the reason would be squeezed onto a heading.
 *
 * The control is there only from Shoot started (Ready, indoors) being done until Happy clients ends
 * the shoot - `execution.canPause`, the server's own answer - and for somebody who may run the
 * steps. A viewer who may not still sees that the shoot is paused and why.
 */
export default function ProductionPauseControl({ shootId, execution, canRunSteps, part = "action", onDetail, onError }) {
  const paused = Boolean(execution.paused);
  const [asking, setAsking] = useState(false);
  const [remarks, setRemarks] = useState("");
  const fields = useFormErrors();
  const { busy, run } = useSubmitOnce();
  const mayPause = canRunSteps && Boolean(execution.canPause);

  function close() {
    setAsking(false);
    setRemarks("");
    fields.clear("remarks");
  }

  function save() {
    if (!fields.check({ remarks: remarks.trim() ? "" : paused ? "Write why the shoot is resuming." : "Write why the shoot is paused." })) return;
    run(async () => {
      try {
        const response = await pauseProductionShoot(shootId, { paused: !paused, remarks: remarks.trim() });
        close();
        onDetail(response?.data, paused ? "Shoot resumed." : "Shoot paused.");
      } catch (error) {
        if (!fields.fromServer(error)) onError(error.message);
      }
    });
  }

  // The reason the shoot stopped, for anybody on the step - including somebody who may not start it.
  if (part === "notice") {
    return paused
      ? <InlineAlert tone="warning">Paused{execution.shootStatusRemarks ? `: ${execution.shootStatusRemarks}` : ""}. The steps carry on from here once it resumes.</InlineAlert>
      : null;
  }
  if (!mayPause) return null;

  /*
   * `shrink-0` and a width of its own: the button shares the step's title line, so it keeps its size
   * while a long step name wraps beside it rather than being squeezed or stretched to the pane.
   */
  return <>
    <Button size="sm" variant="primary" className="min-w-36 shrink-0" onClick={() => setAsking(true)}>{paused ? "Resume the shoot" : "Pause the shoot"}</Button>

    <ConfirmDialog
      open={asking}
      title={paused ? "Resume the shoot?" : "Pause the shoot?"}
      message={paused
        ? "The shoot goes back to Shoot in progress and its steps can be completed again."
        : "The shoot stays on this step and shows as Paused on the board and the Schedule until it starts again. Its steps cannot be completed while it is paused."}
      confirmLabel={paused ? "Resume the shoot" : "Pause the shoot"}
      busyLabel="Saving..."
      tone={paused ? "primary" : "danger"}
      loading={busy}
      onCancel={close}
      onConfirm={() => void save()}
    >
      <TextAreaField
        label={paused ? "Why the shoot is resuming" : "Why the shoot is paused"}
        required
        value={remarks}
        error={fields.errors.remarks}
        onChange={(event) => { fields.clear("remarks"); setRemarks(event.target.value); }}
      />
    </ConfirmDialog>
  </>;
}

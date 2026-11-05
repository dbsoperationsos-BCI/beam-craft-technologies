"use client";

import { useState } from "react";
import ImportDialog from "./ImportDialog";
import OptionsMenu from "@/components/ui/OptionsMenu";
import { importTableRows } from "@/services/api/tableImport.service";

/**
 * The ⋮ at the end of a module header's actions, holding Import.
 *
 * Leads & Followups has had one of these beside Add Lead for a while, and it is where people look
 * for Import - by the button that adds one record, because importing is adding many. The table's
 * own ⋮ carries it too, but that one lives in the column header among Export CSV and Compact view,
 * which is where somebody looks for a *view* setting rather than for a way in.
 *
 * It goes **last** in `actions`, after the module's buttons. Every header in the application puts
 * its ⋮ at the right-hand end, so the quiet trigger is always in the same place and the primary
 * button keeps the position the eye goes to. A header that already has a ⋮ of its own should gain
 * an Import entry in that menu instead of standing a second identical trigger beside it - which is
 * what Accounts and the Employee Repository do.
 *
 * So both offer it, and this is the one that is found. A module wires it with the same
 * `importConfig` the table takes, so the two can never open different dialogs.
 *
 * Rendered only where the viewer may write: an Import that opens and is then refused by the API is
 * worse than one that was never offered.
 *
 * A table with more than one template - Pre Production has one per vertical - passes `importConfigs`
 * instead, and each becomes its own entry named by its `menuLabel`.
 */
export default function ImportMenuButton({ importConfig, importConfigs, ariaLabel = "More actions" }) {
  const [open, setOpen] = useState(null);
  const configs = importConfigs?.length ? importConfigs : importConfig ? [importConfig] : [];
  if (!configs.length) return null;

  return <>
    <OptionsMenu
      ariaLabel={ariaLabel}
      // The quiet trigger, so the icon reads as an icon rather than as a second button competing
      // with the primary one beside it.
      menuClassName={configs.length > 1 ? "w-48" : "w-40"}
      items={configs.map((config) => ({ label: config.menuLabel || "Import", onSelect: () => setOpen(config) }))}
    />
    {/* Rendered only while open, so a reopened dialog is a fresh mount and the last file's verdict
        does not greet the next import. */}
    {open && <ImportDialog
      onClose={() => setOpen(null)}
      title={open.title || "Import"}
      columns={open.columns || []}
      templateName={open.templateName || "import-template"}
      hints={open.hints || []}
      replaceOption={open.replaceOption}
      restoreOption={open.restoreOption}
      onImportChunk={(chunk, options) => importTableRows(open.prefix, chunk, options).then((answer) => answer?.data || answer)}
      onImported={open.onImported}
    />}
  </>;
}

"use client";

import InfoPanelShell from "./InfoPanelShell";
import RecordDetails from "./RecordDetails";

/**
 * The panel beside a table, showing whichever row is selected.
 *
 * The fields themselves are `RecordDetails`, which the double-click dialog draws with too — the
 * panel owns the shell, the empty state and the collapse, not how a value is rendered.
 *
 * `header` and `headerActions` are passed straight through to the shell — the CRM panel puts its
 * tabs in the header band rather than a heading that only repeats the tab beneath it.
 */
export default function DataTableInfoPanel({ title, entity, state, onToggle, sections = [], emptyText, formatters, children, header, headerActions }) {
  return <InfoPanelShell title={title} state={state} onToggle={onToggle} header={header} headerActions={headerActions}>
    {entity ? <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3 text-xs sm:text-sm">
      {children}
      <RecordDetails entity={entity} sections={sections} formatters={formatters} />
    </div> : <div className="flex min-h-0 flex-1 items-center justify-center px-5 text-center text-xs text-slate-500 sm:text-sm">{emptyText}</div>}
  </InfoPanelShell>;
}

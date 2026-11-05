"use client";

import { useMemo } from "react";
import DataTable from "@/components/data-table/DataTable";
import DataTableShell from "@/components/data-table/DataTableShell";
import KanbanBoard from "@/components/data-table/KanbanBoard";
import { buildTableColumns, defaultVisibilityFor } from "@/components/data-table/tableCells";
import OptionsMenu from "@/components/ui/OptionsMenu";
import useCompactView from "@/components/shared/useCompactView";
import { layers } from "@/constants/layers";
import { columnCount, expiresSoon } from "@/lib/kanbanSummary.mjs";

/**
 * The list of onboarding invites, as the Employee Repository draws its own register.
 *
 * It was a `SimpleTable` with rows drawn by hand: no sorting, no filter row, a fixed width, and
 * the actions as a run of links in a last column. The repository beside it is the shared
 * `DataTable`, and a reader moving from one to the other met two tables that answered the same
 * questions differently. So this is the same component with the same conventions - the sortable
 * headers, the filter row, the ⋮ on every row, the remembered column arrangement - and only the
 * columns are the invite's own.
 *
 * ── One row per candidate ──────────────────────────────────────────────────────────────────────
 *
 * `invites` arrive grouped: each entry is the candidate's current invite with their `earlier`
 * attempts hanging off it. The table shows the current one and folds the earlier ones under it as
 * sub-rows behind the chevron, which is the table's own disclosure rather than a count drawn into
 * the name cell. An earlier attempt is read-only: whatever is to be done about a candidate is done
 * to the invite above, which is the live one, so a sub-row's ⋮ says so rather than offering
 * anything - and rather than being absent, which left the row shorter than its neighbours and
 * reading as one the table had forgotten.
 *
 * ── Filters ────────────────────────────────────────────────────────────────────────────────────
 *
 * Designation and Status are picked from a list - they are a closed set of a few values. Name,
 * email and phone are typed into, which is how anybody looks for one person in a list of them.
 */

const INVITE_FIELDS = [
  ["candidateName", "Candidate Name", undefined, 220, 180],
  ["candidateEmail", "Email", undefined, 260, 200],
  ["candidatePhone", "Phone", undefined, 170, 150],
  ["intendedDesignation", "Intended Designation", undefined, 230, 180],
  ["status", "Status", "status", 150, 130],
  ["expiresAt", "Expires At", "date", 150, 130],
  ["createdAt", "Created At", "date", 150, 130],
];

// The dot beside the status, in the colours the repository's own status column uses for the same
// words: a live invite is blue, one the candidate has answered is amber until it is verified.
const STATUS_STYLES = {
  Created: "bg-blue-500",
  Submitted: "bg-amber-500",
  Verified: "bg-emerald-500",
  Cancelled: "bg-slate-500",
  Expired: "bg-orange-400",
};

const LIST_FILTERS = ["intendedDesignation", "status"];

/*
 * The Board: one column per status, in an invite's own order - raised, opened, answered, then the
 * two ways one ends unanswered - in the colours above. It shows each candidate's current invite;
 * earlier attempts are the table's disclosure and stay there.
 */
const BOARD_COLUMNS = ["Created", "Verified", "Submitted", "Expired", "Cancelled"].map((value) => ({ value, className: `${STATUS_STYLES[value]} text-white` }));
const boardStatusOf = (invite) => invite.status;
// Under a column still waiting on the candidate (Created, Verified), how many links run out within two
// days - from the start of today to the end of the day after tomorrow - each of them tagged with its date.
const BOARD_OPEN_STATUSES = ["Created", "Verified"];
const boardCardFlag = (invite, column) => {
  if (!BOARD_OPEN_STATUSES.includes(column.value)) return "";
  return expiresSoon(invite.expiresAt);
};
const boardColumnAmount = (rows, column) => (BOARD_OPEN_STATUSES.includes(column.value) ? columnCount(rows, (invite) => Boolean(boardCardFlag(invite, column)), "Expiring soon", "Expiring soon: within 2 days") : null);
const BOARD_CARD = {
  title: (invite) => invite.candidateName,
  subtitle: (invite) => [invite.intendedDesignation, invite.candidateEmail || invite.candidatePhone].filter(Boolean).join(" · "),
  meta: (invite) => (invite.expiresAt ? `Expires ${String(invite.expiresAt).slice(0, 10)}` : ""),
};

/** `layout` is the dialog's Table / Board choice; on the Board, `canDropAt` / `onDrop` / `onOpen` / `canOpen` are the dialog's. */
export default function OnboardingInviteTable({ invites, loading, menuItemsFor, layer = "dialog", layout = "table", canDropAt, onDrop, onOpen, canOpen }) {
  const { density } = useCompactView();
  /*
   * Above the dialog the table sits in, or the menu opens behind the card that opened it. A dialog
   * stacked over a panel sits higher still, and so must its menus; see `constants/layers`.
   */
  const menuZIndexClassName = layer === "dialogOverPanel" ? layers.popover : layers.menuOverPanel;

  const rows = useMemo(() => invites.map((group) => ({
    ...group.current,
    earlier: group.earlier.map((invite) => ({ ...invite, earlierAttempt: true })),
  })), [invites]);

  /*
   * Rebuilt whenever the dialog renders, because `menuItemsFor` is declared there each time and
   * reads the dialog's in-flight state - which is exactly what a row's "Cancelling..." waits on.
   * The same shape as the other registers whose row menus close over page state.
   */
  const columns = useMemo(() => buildTableColumns({
    fields: INVITE_FIELDS,
    statusStyles: STATUS_STYLES,
    listFilters: LIST_FILTERS,
    renderActions: (invite) => {
      const items = invite.earlierAttempt
        ? [{ description: "Earlier attempt. Act on the current invite above." }]
        : menuItemsFor(invite);
      return items.length ? <OptionsMenu ariaLabel={`Actions for ${invite.candidateName}`} menuZIndexClassName={menuZIndexClassName} items={items} /> : null;
    },
  }), [menuItemsFor, menuZIndexClassName]);
  const defaultVisibility = useMemo(() => defaultVisibilityFor(INVITE_FIELDS), []);

  if (layout === "board") return <KanbanBoard
    rows={rows}
    columns={BOARD_COLUMNS}
    statusOf={boardStatusOf}
    columnAmount={boardColumnAmount}
    cardFlag={boardCardFlag}
    card={BOARD_CARD}
    getRowId={(invite) => invite.id}
    onOpen={onOpen}
    canOpen={canOpen}
    // The card's ⋮ is the row's ⋮; the board shows only current invites, never an earlier attempt.
    cardActions={menuItemsFor}
    cardMenuProps={{ menuZIndexClassName }}
    canDropAt={canDropAt}
    onDrop={onDrop}
    loading={loading}
    noun="invites"
    ariaLabel="Onboarding invites board"
  />;

  return <DataTableShell className="min-h-0 flex-1">
    <DataTable
      columns={columns}
      data={rows}
      getRowId={(invite) => invite.id}
      density={density}
      loading={loading}
      loadingMessage="Loading invites..."
      emptyMessage="No onboarding invites created yet."
      noMatchMessage="No matching invites found."
      defaultColumnVisibility={defaultVisibility}
      menuZIndexClassName={menuZIndexClassName}
      ariaLabel="Onboarding invites table"
      features={{
        infiniteScroll: { pageSize: 50 },
        expandable: {
          label: "earlier attempts for this candidate",
          canExpand: (invite) => !invite.earlierAttempt && invite.earlier?.length > 0,
          getSubRows: (invite) => (invite.earlierAttempt ? undefined : invite.earlier),
        },
      }}
    />
  </DataTableShell>;
}

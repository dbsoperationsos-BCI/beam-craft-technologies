# Approved Global UI Standards

**Status:** Frozen global standard as of 2026-07-28.

All current and future modules must reuse these standards unless an explicit product decision replaces them. Reference screenshots are visual references for density and alignment only; their labels, data, actions, and options must never be copied into DBS.

## Header and Action Bar

- The global topbar is compact and vertically centered: hamburger, DBS - CRM title, global search, notification control, user identity, and sign-out remain functionally unchanged.
- The navigation drawer opens **below** the topbar, never over it: the panel and its backdrop both start at `--app-topbar-h`, so the bar stays whole, visible and usable while the nav is open. The two animate together on the same 200ms `ease-out`. Because the bar is no longer under the backdrop, a press anywhere outside the drawer closes it — the bar included — with the hamburger the one exception, since it toggles.
- Module pages use a compact page header: title on the left; status tabs directly below the title where present; current module actions on the right.
- Actions remain module-specific. Do not introduce actions from unrelated reference products.
- Breadcrumbs are omitted unless explicitly required. When used, they sit beneath the page title and never float above it.
- Page title, tabs, action bar, and table begin with minimal readable separation; avoid whitespace-heavy layouts.

## Schema Form Standard

Applies to Employee Add/Edit/Review, Sales Create/Edit Project, Start/Edit Project, and future large Create/Edit/Review workflows.

- Full-screen form/panel with an X-only close control in the top-right.
- Desktop left section rail, right scrollable content, readable max-width field area, and sticky footer.
- Compact but readable header, section, field-grid, card, and footer spacing.
- Full-width section heading/divider rows while the field body remains constrained.
- Sticky grouped section headings: a heading remains current until the next section pushes it out.
- Left-rail selection performs controlled scroll inside the form content; the selected heading lands at the sticky position.
- Scrollspy updates the rail while manually scrolling; final-section bottom spacing allows the last heading to become current.
- Create/Add primary action is disabled until existing required-field validation passes.
- Edit/Review Save is disabled until persisted values actually change, and disables when reverted. Workflow buttons such as Approve & Onboard retain their independent logic.
- Disabled primary actions are grey, muted, non-clickable, and use the not-allowed cursor.

## Data Table Standard

Employee Repository is the master table behavior reference. Applies to Employee Repository, Sales Manager, Project Management Projects, Pre Production, Production, Post Production, and future list modules.

- Framed operational table card with compact header, compact column heading row, compact filter row, compact body rows, and compact footer.
- Headers are **bold title case**, never forced uppercase.
- Per-column filters, sortable columns, column resize/freeze where available, row action menu, and table-level 3-dot menu remain inside the table frame.
- The table 3-dot menu includes Export CSV, deferred Export Excel, Freeze Columns, Manage Columns, and Compact view. Every `DataTable` shows it by default, adding a structural Actions column when the table declares none; a table opts a part out through `features` rather than opting in.
- Compact view is one application-wide setting (`useCompactView`), remembered in the browser: ticking it in any table's menu tightens every table, so the application reads at one density.
- Employee Repository Freeze Columns lives only in the table 3-dot menu and defaults to First 3. It supports None and First 1 through First 5.
- Manage Columns includes search. Hidden columns disappear from table, filter row, applicable sorting, and CSV export. Actions is structural, fixed, not hideable, and never exported.
- CSV exports all currently filtered/sorted rows with visible exportable columns, not only the rows currently rendered by infinite scroll.
- Tables use client-side infinite scroll currently: initial batch 50, then 50 more near the table-body bottom. Pagination controls, page size, Previous/Next, and Page x of y are not shown.
- Footer shows `Total rows`, `Showing X of Y`, and `Last updated` — a date, since most boards are
  re-read when they are opened. **Leads & Followups says `Last sync` and carries the time with it**:
  that board is re-read on a timer and after every write, so the footer is answering "is what I am
  looking at current?", and a date alone answered it with "today" on every sync a reader will ever
  see. A board that refreshes itself follows Leads & Followups rather than the line above it.
- Empty/loading states are clean and notifications use existing closable inline/snackbar patterns; browser alerts are not used.
- Project Management Projects supports Row View and Tree View. Row View uses the full table standard; Tree View preserves its own expandable hierarchy while respecting project tabs.

## Info Panel Standard

- The right-side Info Panel is always present as a collapsed rail by default.
- It has only collapsed/expanded states—never a full close state.
- A centered circular chevron controls collapse/expand.
- Row click selects the record and auto-expands the panel. Row action clicks must not trigger row selection.
- The expanded panel has a fixed compact header and independently scrollable compact content.
- The panel must not prevent horizontal table scrolling or awkwardly cover the table.
- Collapsing and expanding are animated, 200ms: from `lg` up the panel's width moves between the
  rail and its open width so the table widens in step; below that it slides off the right edge,
  since an overlay has nothing to give room to. The body fades rather than unmounting, so what is
  being closed stays on screen for as long as the close takes. Both are dropped under
  `prefers-reduced-motion`.

## Row Interaction Standard

- Single click selects the row and expands the Info Panel.
- **Double click opens the record read only**, in the full-screen `RecordViewPanel`. It never opens
  an editable form: a double click is too easily triggered by a slow second click on a row somebody
  only meant to select.
- **Editing is the row's ⋮ menu**, asked for by name. That menu is also where the rules about who
  may edit what already live, so a row nobody may change simply does not offer the entry.
- The reading view draws the same `entity` and `sections` the module's Info Panel is given, with
  empty fields dropped — the panel keeps them because it is scanned to a known position, the
  reading view is read once, top to bottom.

## Compact Density Standard

- Use practical ERP/operations density: no oversized page gaps, table-card blank areas, form section gaps, or dialog padding.
- Keep labels, controls, phone fields, confirmation dialogs, and action menus comfortably usable.
- Keep form sticky headers/footers, Info Panels, infinite scroll, filters, sorting, export, Manage Columns, and row actions intact when compacting layout.

## Tabs remember where you were

A page with status tabs keeps the tab across a reload, through `useStickyTab(key, fallback, valid)`
in `frontend/src/components/shared/`. It reads storage on the first render rather than in an effect,
so the page is drawn on the right tab instead of showing the default and switching under the reader —
the same pattern `useCompactView` beside it uses.

Give it the page's own key and the list of tabs the page actually has: a remembered tab that has been
renamed or removed falls back to the default rather than filtering the table by a label nothing
matches, which reads as an empty screen with no explanation.

A screen that already keeps its tab in the URL — Asset Management does — should stay that way. A URL
is better than storage where it exists: it survives a reload too, and it can be shared and linked.

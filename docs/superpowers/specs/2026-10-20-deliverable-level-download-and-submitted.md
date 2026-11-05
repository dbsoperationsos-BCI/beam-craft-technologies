# Image Selection: deliverable-level submission, download and Client Submitted — audit and fix

Date: 2026-10-20.

## Root causes

1. **One download stamp per project.** `image_selection_project.selected_downloaded_at` was the only record of a download. The desktop copy (`originals/service.js` `copySelected`) can copy one deliverable's originals, and the browser's Download Selected copies one folder's; either, when complete, stamped the whole project - so downloading Retouches cleared Frames from Yet to Download and counted the project as Downloaded.
2. **Client Submitted meant "every item submitted".** The card read the `submitted` stage (`selectionProgress === "completed"`), so a project with Retouches submitted and Frames still being picked sat under Client In Progress.
3. (Already fixed on 2026-10-20.) The submission notification hook selected a field the sales project does not have and threw on every submission, so nothing was ever queued; that made it look as though notifications waited for the whole shoot.

Not a cause: submissions were already per item (`selection_submitted_at` on each item, the shoot-level stamp set only when none is open), Yet to Download already listed items by their own submission, and the notification already fires once per submit call (one per individual Submit, one consolidated for Submit All, which the gallery sends only for the items not yet submitted and the server refuses for any already sent).

## Fix

- `image_selection_deliverable_config.selected_downloaded_at` (nullable), backfilled from the project's stamp for every item submitted on or before it. A run stamps **only the items it covered**: the desktop copy its one deliverable (or all); the browser run the submitted items whose every pick lies in the folder it downloaded. The project's stamp moves only when every submitted item is then up to date, so it still serves galleries without items.
- Dashboard: an item is pending when submitted with picks and its own stamp (or, for a row from before the stamps, the project's) is older than its submission; Yet to Download lists exactly those; Downloaded means every submitted item is up to date; `clientSubmitted` is a new attention flag - any item submitted (the gallery's own stamp for an itemless gallery) - which the Client Submitted card and its list now read, the stage pill unchanged. Each row carries `submittedItems` (name, count, submitted at, downloaded at) and the Selected cell lists them.
- Template `PHOTO_SELECTION_SUBMITTED` reworded to the spec, with `{deliverables}` naming each submitted item with its count.

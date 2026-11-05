import { boardJumpItems } from "./boardJumps.mjs";

/**
 * The ⋮ on a shoot card in the calendar - the shoot window and a day's "Shoots · 6" pop-up.
 *
 *   - **Navigate to ›** - the boards its project is on (`boards`, from the server's `projectBoards.js`)
 *     that the viewer may open, each opening on **this shoot** (`shootBoardHref`): Projects on the
 *     project's row for it, Pre Production and Production on its form, the others on the project.
 *   - **Update ›** - the forms this shoot is changed in, each for that board's Read / Write:
 *       - **Project** - the project's own form on Projects (`&edit=1`), `PROJECT / Projects`;
 *       - **Pre Production** - this shoot's Pre Production form, once it has one
 *         (`hasPreProduction`), `PROJECT / Pre Production`;
 *       - **Production** - this shoot's Production form, once production is raised for it
 *         (`productionShootId`), `PROJECT / Production`;
 *       - **Payment** - the project's form on its Payments tab (`&view=payments`), Projects and
 *         `ACCOUNTS / Cash Management`, which recording a payment there answers to.
 *
 * `can(module, feature, level)` is the viewer's `hasPermission`; `onGo(href)` does the navigating.
 * Nothing is offered for a shoot with no project to name, and a submenu with nothing in it is left out.
 */
export function calendarShootMenuItems({ shoot, can, onGo }) {
  const eventId = String(shoot?.eventId || "").trim();
  if (!eventId) return [];
  const project = `/project-management/projects?project=${encodeURIComponent(eventId)}&edit=1`;
  const id = encodeURIComponent(shoot.shootRecordId || "");
  const writes = (feature, module = "PROJECT") => can?.(module, feature, "READ_WRITE");
  const updates = [
    writes("Projects") && { label: "Project", onSelect: () => onGo(project) },
    id && shoot.hasPreProduction && writes("Pre Production") && { label: "Pre Production", onSelect: () => onGo(`/project-management/pre-production?shoot=${id}`) },
    id && shoot.productionShootId && writes("Production") && { label: "Production", onSelect: () => onGo(`/project-management/production?shoot=${id}`) },
    writes("Projects") && writes("Cash Management", "ACCOUNTS") && { label: "Payment", onSelect: () => onGo(`${project}&view=payments`) },
  ].filter(Boolean);
  return [
    ...boardJumpItems({ from: "calendar", boards: shoot.boards || [], eventId, shoot: { shootId: shoot.shootId, shootRecordId: shoot.shootRecordId }, can, onJump: onGo }),
    ...(updates.length ? [{ label: "Update", submenu: updates }] : []),
  ];
}

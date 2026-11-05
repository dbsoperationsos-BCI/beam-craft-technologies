// Relative, like `modulePermissions`' own import of the registry: it is what lets a plain
// `node --test` read this file without the bundler's alias.
import { permissionForRoute } from "./modulePermissions.js";

/**
 * The screens reached from the control beside the Employee Repository heading.
 *
 * Five screens, one heading: the repository itself, the referral register, the activity log, and
 * the two RBAC screens. None of the last four is in the sidebar — Administration is deliberately
 * absent from `navigation.mjs`, Employee Referral was taken off the menu, and User Activity Logs
 * never had an entry — so this control is the only way between them, and it is also what says which
 * of them you are on.
 *
 * Grouped rather than listed flat. The first group is the registers about the studio's people - who
 * they are, what the studio owes them, and what they have done in the application; the second is the
 * access those people hold, which is a different question and reads as one under its own heading.
 */
const SECTIONS = [
  {
    items: [
      { label: "Administration", value: "/employees" },
      /*
       * The referral register, which used to be an HRM sidebar entry of its own. It belongs with
       * the repository rather than beside Tasks and Interview: it is read about the same people,
       * from the same screen, and what a referral pays is already set from the repository's own
       * Settings. See `hidden` on its row in `navigation.mjs`.
       */
      { label: "Employee Referral", value: "/hrm/employee-referrals" },
      /*
       * Who did what, and when: every request a signed-in person made, as the server logged it.
       * Read-only, and answering to `ADMIN / User Activity Logs` rather than to User Management -
       * reading what somebody did is not the same grant as editing their account.
       */
      { label: "User Activity Logs", value: "/admin/activity-logs" },
    ],
  },
  {
    heading: "RBAC Action",
    items: [
      { label: "Users", value: "/admin/users" },
      { label: "Roles", value: "/admin/roles" },
    ],
  },
];

/**
 * The family's screens in the order a reader falls through them, which is the order above.
 *
 * The sidebar carries one row for the whole family - Employee Repository - and it is the only door
 * to any of them. A role granted the referral register and not the repository would have found that
 * door shut on a screen it was allowed to read, so the row opens the first of these the reader may
 * open rather than always `/employees`. See `useSidebarLayout`.
 */
export const DESTINATIONS = SECTIONS.flatMap((section) => section.items.map((item) => item.value));

/** The registry id of that one row, so the hook and this file cannot disagree about which it is. */
export const FAMILY_SIDEBAR_ITEM_ID = "employee-repository";

/** Where the sidebar's Employee Repository row leads for one reader, or null if nowhere. */
export function familyEntryFor(hasPermission) {
  return DESTINATIONS.find((href) => mayOpen(hasPermission, href)) || null;
}

/**
 * Whether the switch is worth drawing at all.
 *
 * One destination is not a choice: a control that opens onto the screen already being read says
 * there is somewhere else to go and then does not offer it. Counted in destinations rather than in
 * rows, because a lone survivor can still arrive carrying its group's heading.
 */
export const hasChoice = (rows) => rows.filter((row) => row.label).length > 1;

/** Whether a role may open a destination at all, asked of the route rather than of a second table. */
function mayOpen(hasPermission, href) {
  const permission = permissionForRoute(href);
  // A route no permission names is open to anybody signed in; the route map is the authority on
  // which those are, exactly as it is for `RouteGuard` and the sidebar.
  return !permission || hasPermission(permission.module, permission.feature, "READ");
}

/**
 * The rows to draw, for one reader on one of the five screens.
 *
 * A destination the reader's roles cannot open is **absent**, not listed and then refused by the
 * route guard a click later — the same rule the sidebar follows, asked of the same route map, so
 * the menu and the drawer can never disagree about what a role reaches. A group whose every row
 * has gone takes its heading and its separator with it, leaving no rule across an empty menu.
 *
 * `current` is the screen being read. It is kept whatever the permissions say: it is where the
 * reader already is, and a switch whose own value is missing from its menu shows an empty trigger.
 */
export function rbacSectionsFor(hasPermission, current) {
  const rows = [];
  for (const section of SECTIONS) {
    const items = section.items.filter((item) => item.value === current || mayOpen(hasPermission, item.value));
    if (!items.length) continue;
    if (rows.length) rows.push({ separator: true });
    if (section.heading) rows.push({ heading: section.heading });
    rows.push(...items);
  }
  return rows;
}

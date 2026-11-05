import { DESTINATIONS as EMPLOYEE_FAMILY } from "../constants/rbacSections.js";

/**
 * The page a module was last left on, per login.
 *
 * Several sidebar rows open a family of screens switched between from a control on the page: User
 * Management (Administration, Employee Referral, User Activity Logs, Users, Roles), Pre Production
 * (All, Dum Dum, Qua Qua, Corp), Production (Table, Schedule), AI Feature and Image Selection
 * (Dashboard, Events / Projects) and Album Proofing (Dashboard, Projects). Leaving one for another
 * module and coming back through the sidebar used to land on the family's first screen every time,
 * so a reader working in Employee Referral or Corp was sent back to Administration or All. The row
 * now opens the screen they left.
 *
 * Kept as a preference (`tab:page.<row id>`), so it travels with the login like the remembered tabs
 * do. Only a screen of that family is ever used, and only one the reader may still open - a stored
 * value is a hint, never a way in.
 */
export const PRE_PRODUCTION_DESTINATIONS = [
  { label: "All", href: "/project-management/pre-production" },
  { label: "Dum Dum", href: "/project-management/pre-production/dum-dum" },
  { label: "Qua Qua", href: "/project-management/pre-production/qua-qua" },
  { label: "Corp", href: "/project-management/pre-production/corp" },
];

/** Sidebar row id → the screens its page switches between. Exact routes; a record under one is not one. */
export const PAGE_FAMILIES = {
  "employee-repository": EMPLOYEE_FAMILY,
  "pre-production": PRE_PRODUCTION_DESTINATIONS.map((destination) => destination.href),
  production: ["/project-management/production", "/project-management/production/schedule"],
  "ai-feature": ["/visual-curation/ai/overview", "/visual-curation/ai/events"],
  "image-selection": ["/image-selection/dashboard", "/image-selection/projects"],
  "album-proofing": ["/image-selection/album-proofing/dashboard", "/image-selection/album-proofing"],
  // AI Culling, AI Editing and Signature Album: Dashboard and Projects, as Photo Selection.
  "ai-culling": ["/image-selection/ai-culling/dashboard", "/image-selection/ai-culling/projects"],
  "ai-editing": ["/image-selection/ai-editing/dashboard", "/image-selection/ai-editing/projects"],
  "signature-album": ["/image-selection/signature-album/dashboard", "/image-selection/signature-album/projects"],
};

/** Every family's key, in one list - what the sidebar and the recorder read together. */
export const LAST_PAGE_KEYS = Object.keys(PAGE_FAMILIES).map((id) => `tab:page.${id}`);

/** Where one family's last page is kept. */
export const lastPageKey = (familyId) => `tab:page.${familyId}`;

/** The family a path belongs to, or null - an exact screen of it, not anything under it. */
export function familyOf(pathname) {
  const path = String(pathname || "").replace(/\/+$/, "");
  return Object.keys(PAGE_FAMILIES).find((id) => PAGE_FAMILIES[id].includes(path)) || null;
}

/** The remembered page to open, or null: one of the family's own screens the reader may open. */
export function rememberedPage(familyId, stored, mayOpen = () => true) {
  const screens = PAGE_FAMILIES[familyId] || [];
  return typeof stored === "string" && screens.includes(stored) && mayOpen(stored) ? stored : null;
}

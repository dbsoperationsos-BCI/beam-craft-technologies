"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import DropdownMenu from "@/components/ui/DropdownMenu";
import { usePermissions } from "@/components/auth/PermissionsProvider";
import { hasChoice, rbacSectionsFor } from "@/constants/rbacSections";

/**
 * The control beside the heading on the four screens about the studio's people and their access:
 * the Employee Repository, the Employee Referral register, Users and Roles.
 *
 * One component rather than the same twenty lines on each of them, because what it draws depends on
 * the reader and all four have to answer that question the same way:
 *
 *   * **more than one** of the four within reach — a switch listing them, which is also what says
 *     which one is open;
 *   * **exactly one** — its name, as plain text. There is nowhere to go, and a menu of one offers a
 *     choice it does not have; but the name still has to be there, because three of the four screens
 *     take their heading from the registry and Users and Roles both read *Employee Repository*
 *     under it.
 *
 * A destination the reader's roles cannot open is never listed — see `rbacSections.js`, which asks
 * the route map the same question `RouteGuard` asks when the page is opened directly.
 */
export default function AdministrationSwitch({ current }) {
  const router = useRouter();
  const { hasPermission } = usePermissions();
  const sections = useMemo(() => rbacSectionsFor(hasPermission, current), [hasPermission, current]);

  // The screen being read is always in the list, so this is the name to fall back to.
  const here = sections.find((row) => row.value === current) || sections.find((row) => row.label);
  if (!here) return null;

  return <div className="min-w-0 border-l border-slate-200 pl-3">
    {hasChoice(sections)
      ? <DropdownMenu ariaLabel="Administration section" items={sections} value={current} onChange={(href) => router.push(href)} />
      // Sized and weighted like the switch's own resting state, so a reader holding one screen and
      // a reader holding four see the same heading with the same thing beside it.
      // Padded to the switch's own height rather than flexed to it: `truncate` needs a block to
      // work on, and on a 360px header a long name has to end in an ellipsis rather than push the
      // heading sideways.
      : <p className="truncate py-2 text-xs font-medium leading-5 text-slate-700 sm:text-sm">{here.label}</p>}
  </div>;
}

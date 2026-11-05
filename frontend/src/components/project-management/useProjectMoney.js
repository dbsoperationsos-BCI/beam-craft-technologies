"use client";

import { useEffect, useMemo, useState } from "react";
import { usePermissions } from "@/components/auth/PermissionsProvider";
import { getProjectsPaymentsSummary } from "@/services/project-management/project-workflow.service";

// The server's `MAX_IDS`: 200 ids keep the request well inside the proxy's header limit.
const CHUNK = 200;

/*
 * The money of the projects a Board is showing (`lib/projectMoney.mjs` reads it), or null.
 *
 * Asked only of somebody the server would answer - Accounts / Cash Management Read and a board
 * that lists projects, the guards of a project's Payments tab - so nobody else makes the request
 * or sees a figure. Asked only while the Board is open (`rows` empty otherwise), once per set of
 * projects. A refusal or failure leaves the board on its other figures rather than reporting an
 * error over it.
 */
export default function useProjectMoney(rows) {
  const { hasPermission } = usePermissions();
  const allowed = hasPermission("ACCOUNTS", "Cash Management", "READ")
    && ["Projects", "Production", "Pre Production"].some((feature) => hasPermission("PROJECT", feature, "READ"));
  const key = useMemo(() => [...new Set((rows || []).map((row) => row?.projectId || row?.id).filter(Boolean))].sort().join(","), [rows]);
  const [money, setMoney] = useState(null);

  useEffect(() => {
    if (!allowed || !key) return undefined;
    let current = true;
    const ids = key.split(",");
    const chunks = Array.from({ length: Math.ceil(ids.length / CHUNK) }, (_, index) => ids.slice(index * CHUNK, (index + 1) * CHUNK));
    Promise.all(chunks.map((chunk) => getProjectsPaymentsSummary(chunk)))
      .then((answers) => { if (current) setMoney(Object.assign({}, ...answers.map((answer) => answer?.data || {}))); })
      .catch(() => { if (current) setMoney(null); });
    return () => { current = false; };
  }, [allowed, key]);

  return allowed && key ? money : null;
}

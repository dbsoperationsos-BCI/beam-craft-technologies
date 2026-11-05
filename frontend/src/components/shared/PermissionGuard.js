"use client";

import { usePermissions } from "@/components/auth/PermissionsProvider";

// Renders children only when the signed-in user holds the permission, and `fallback` otherwise.
// Pass either a single module/feature/level, or a `permissions` array with requireAll to combine
// several. While the permission set is still loading nothing is rendered - showing the children
// first and pulling them away a moment later is worse than a beat of nothing.
export default function PermissionGuard({ module, feature, level = "READ", permissions, requireAll = true, fallback = null, children }) {
  const { loading, hasPermission, hasAllPermissions, hasAnyPermission } = usePermissions();

  if (loading) return null;

  const allowed = permissions?.length
    ? (requireAll ? hasAllPermissions(permissions) : hasAnyPermission(permissions))
    : hasPermission(module, feature, level);

  return allowed ? children : fallback;
}

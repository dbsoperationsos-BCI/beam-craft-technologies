# Cross-Branch Permissions Feature

## Problem
Currently, Branch Admins can only manage permissions for users in their own branch.
We need: **Branch A Admin should be able to grant permissions to users in Branch B (or any branch)**

## Solution
Add cross-branch support to the `UserGroupRole` model so roles can be scoped to specific branches, or left null for organization-wide access.

---

## Schema Update

### Current State
```prisma
model UserGroupRole {
  groupId   String
  roleId    String
  group     UserGroup @relation(...)
  role      Role @relation(...)
  @@unique([groupId, roleId])
}
```

**Problem:** A group can only belong to one branch, limiting cross-branch assignment.

### New State
```prisma
model UserGroupRole {
  id        String  @id @default(cuid())
  groupId   String
  roleId    String
  branchIds String? @map("branch_ids")  // NEW: JSON array of branch IDs this role applies to
  
  group     UserGroup @relation(...)
  role      Role @relation(...)
  
  @@unique([groupId, roleId, branchIds])
  @@map("user_group_role")
}
```

**Benefit:** A group can have a role with different branch scopes.

---

## UPDATE 1: Modify Prisma Schema

Edit `backend/prisma/schema.prisma` and update UserGroupRole:

```prisma
model UserGroupRole {
  id        String  @id @default(cuid())
  groupId   String
  roleId    String
  
  // NEW: Scope this role assignment to specific branches
  // null = applies to all branches user can access
  // JSON array = applies only to specified branches
  // Example: "[1, 2]" means role applies in branches 1 and 2
  branchIds String? @db.MediumText @map("branch_ids")
  
  createdAt DateTime @default(now()) @map("created_at")
  
  group     UserGroup @relation(fields: [groupId], references: [id], onDelete: Cascade)
  role      Role @relation(fields: [roleId], references: [id], onDelete: Cascade)

  @@unique([groupId, roleId, branchIds])
  @@map("user_group_role")
  @@index([groupId])
  @@index([roleId])
}
```

Run migration:
```bash
npm run prisma:migrate dev
# Name: "add_cross_branch_support"
```

---

## UPDATE 2: IAM Service Methods

Add these methods to `backend/src/services/iam.service.js`:

```javascript
// ============================================
// CROSS-BRANCH PERMISSION MANAGEMENT
// ============================================

/**
 * Get user permissions scoped to a specific branch
 * Filters permissions based on branch assignment
 */
async getUserPermissionsForBranch(userId, targetBranchId) {
  const user = await this.getUserWithPermissions(userId);

  // SUPER_ADMIN: has all permissions everywhere
  if (user.role === "SUPER_ADMIN") {
    return this._getAllPermissions();
  }

  // Get all groups user belongs to
  const groupIds = user.groupMemberships.map((m) => m.groupId);

  if (groupIds.length === 0) {
    return [];
  }

  // Get role-permission mappings for these groups
  // Filter by branch
  const rolePermissions = await prisma.rolePermission.findMany({
    where: {
      role: {
        groupRoles: {
          some: {
            groupId: { in: groupIds },
            OR: [
              { branchIds: null }, // Role applies everywhere
              { branchIds: { contains: targetBranchId.toString() } } // Role applies to this branch
            ]
          }
        }
      }
    },
    include: {
      permission: true
    }
  });

  // Deduplicate
  const seen = new Set();
  const permissions = [];

  for (const rp of rolePermissions) {
    const key = rp.permissionId;
    if (!seen.has(key)) {
      seen.add(key);
      permissions.push({
        ...rp.permission,
        accessLevel: rp.accessLevel
      });
    }
  }

  return permissions;
}

/**
 * Check if a role applies to a specific branch
 */
roleAppliesToBranch(roleAssignment, branchId) {
  if (!roleAssignment.branchIds) {
    return true; // null = applies everywhere
  }

  try {
    const branchIds = JSON.parse(roleAssignment.branchIds);
    return branchIds.includes(branchId);
  } catch {
    return false;
  }
}

/**
 * Assign role to group with branch scoping
 */
async assignRoleToGroupForBranches(groupId, roleId, branchIds = null) {
  // branchIds: null = all branches, [1, 2] = specific branches
  
  const branchIdsJson = branchIds ? JSON.stringify(branchIds) : null;

  return prisma.userGroupRole.create({
    data: {
      groupId,
      roleId,
      branchIds: branchIdsJson
    }
  });
}

/**
 * Update role's branch scope
 */
async updateRoleGroupBranchScope(groupId, roleId, branchIds) {
  const branchIdsJson = branchIds ? JSON.stringify(branchIds) : null;

  return prisma.userGroupRole.update({
    where: {
      groupId_roleId_branchIds: {
        groupId,
        roleId,
        branchIds: await this._getCurrentBranchIds(groupId, roleId)
      }
    },
    data: { branchIds: branchIdsJson }
  });
}

async _getCurrentBranchIds(groupId, roleId) {
  const current = await prisma.userGroupRole.findFirst({
    where: { groupId, roleId }
  });
  return current?.branchIds;
}

/**
 * Get all branches a group's role applies to
 */
async getRoleGroupBranches(groupId, roleId) {
  const assignment = await prisma.userGroupRole.findFirst({
    where: { groupId, roleId }
  });

  if (!assignment || !assignment.branchIds) {
    // Get all active branches
    return prisma.location.findMany({
      where: { isActive: true },
      select: { id: true }
    });
  }

  try {
    const branchIds = JSON.parse(assignment.branchIds);
    return prisma.location.findMany({
      where: { id: { in: branchIds }, isActive: true },
      select: { id: true }
    });
  } catch {
    return [];
  }
}
```

---

## UPDATE 3: Example Usage

### Scenario: Branch A Admin assigns Manager role to users in Branch B

```javascript
// 1. Create group in Branch B (or use existing)
const group = await iamService.createUserGroup({
  name: "Branch B Team",
  branchId: 2 // Branch B
});

// 2. Get Manager role
const managerRole = await prisma.role.findUnique({
  where: { name: "MANAGER" }
});

// 3. Assign role to group, scoped to branches 2 and 3
await iamService.assignRoleToGroupForBranches(
  group.id,
  managerRole.id,
  [2, 3] // This group gets MANAGER role in branches 2 and 3 only
);

// 4. Add users from branches 2 and 3 to this group
await iamService.assignUserToGroup(branch2User.id, group.id);
await iamService.assignUserToGroup(branch3User.id, group.id);

// Now users have MANAGER permissions, but only in branches 2 and 3
```

### Scenario: Organization-wide role

```javascript
// Create a group and assign a role to ALL branches
await iamService.assignRoleToGroupForBranches(
  group.id,
  superAdminRole.id,
  null  // null = applies to all branches
);
```

---

## UPDATE 4: Permission Check (Branch-Aware)

Update the middleware to use branch-aware permissions:

```javascript
// backend/src/middleware/permissionMiddleware.js

const checkPermissionForBranch = (module, feature, requiredLevel = "READ") => {
  return async (req, res, next) => {
    try {
      const targetBranchId = parseInt(
        req.params.branchId || req.body.branchId
      );

      if (!targetBranchId) {
        return res.status(400).json({ message: "Branch ID required" });
      }

      // Check permission for THIS SPECIFIC BRANCH
      const hasPermission = await iamService.hasPermissionInBranch(
        req.user.id,
        module,
        feature,
        requiredLevel,
        targetBranchId
      );

      if (!hasPermission) {
        return res.status(403).json({
          message: `You don't have ${requiredLevel} permission for ${module}:${feature} in this branch`
        });
      }

      req.permission = {
        module,
        feature,
        level: requiredLevel,
        branchId: targetBranchId
      };

      next();
    } catch (error) {
      console.error("Permission check failed:", error);
      res.status(500).json({ message: "Permission check failed" });
    }
  };
};

// Add this method to iam.service.js
async hasPermissionInBranch(userId, module, feature, requiredLevel, branchId) {
  const user = await this.getUserWithPermissions(userId);

  // SUPER_ADMIN: has all permissions everywhere
  if (user.role === "SUPER_ADMIN") {
    return true;
  }

  // Get permissions scoped to this branch
  const permissions = await this.getUserPermissionsForBranch(userId, branchId);

  const permission = permissions.find(
    (p) => p.module === module && p.feature === feature
  );

  if (!permission || permission.accessLevel === "DISABLED") {
    return false;
  }

  if (requiredLevel === "READ") {
    return (
      permission.accessLevel === "READ" ||
      permission.accessLevel === "READ_WRITE"
    );
  }

  if (requiredLevel === "READ_WRITE") {
    return permission.accessLevel === "READ_WRITE";
  }

  return false;
}

module.exports = {
  checkPermissionForBranch,
  checkBranchAccess,
  checkPermissions,
  checkAnyPermission
};
```

---

## UPDATE 5: Routes Example

```javascript
// Use branch-aware permission check
router.post(
  "/",
  protect,
  checkBranchAccess("branchId"),
  checkPermissionForBranch("ASSET", "Asset Management", "READ_WRITE"),
  controller.createAsset
);
```

---

## How It Works

### Example: Multi-Branch Admin Setup

```
Branch 1          Branch 2          Branch 3
├─ Users          ├─ Users          ├─ Users
└─ Group: "Team"  └─ Group: "Team"  └─ Group: "Team"
  └─ Role: Manager (branches [1,2])
    └─ Can manage in branches 1 & 2 only
    
  └─ Role: Supervisor (branches [2,3])
    └─ Can supervise in branches 2 & 3 only
```

### Permission Resolution

```javascript
User (Branch 2) with groups:
  ├─ Group A: Manager role (branches [1,2])    → Has MANAGER permissions in branches 1 & 2
  ├─ Group B: Lead role (branches [2,3])       → Has LEAD permissions in branches 2 & 3
  └─ Group C: Viewer role (branchIds: null)    → Has VIEWER permissions in ALL branches

When accessing branch 2:
  → Combine Group A (applies) + Group B (applies) + Group C (applies)
  → User has combined permissions: MANAGER + LEAD + VIEWER in branch 2
```

---

## Database Structure After Update

```
user_group_role table:

id  | groupId | roleId | branchIds      | createdAt
────┼─────────┼────────┼────────────────┼───────────
1   | G1      | R_ADM  | null           | 2026-08-21  (Applies to all branches)
2   | G1      | R_MGR  | "[1, 2]"       | 2026-08-21  (Applies to branches 1 & 2)
3   | G2      | R_ADM  | "[2, 3]"       | 2026-08-21  (Applies to branches 2 & 3)
4   | G3      | R_STF  | null           | 2026-08-21  (Applies to all branches)
```

---

## Testing Cross-Branch Permissions

Add to `backend/test/iam.test.js`:

```javascript
test("Cross-Branch: Role assigned to multiple branches", async () => {
  const data = await setupTestData();

  try {
    // Assign manager role to group, but scoped to branches 1 and 2
    await iamService.assignRoleToGroupForBranches(
      data.group1.id,
      data.roles.managerRole.id,
      [data.branch1.id, data.branch2.id]
    );

    // User has manager permissions in branch 1 (within scope)
    const hasPerm1 = await iamService.hasPermissionInBranch(
      data.branch1Admin.id,
      "ASSET",
      "Asset Management",
      "READ_WRITE",
      data.branch1.id
    );

    assert.strictEqual(hasPerm1, true, "Should have permission in branch 1");

    // User has manager permissions in branch 2 (within scope)
    const hasPerm2 = await iamService.hasPermissionInBranch(
      data.branch1Admin.id,
      "ASSET",
      "Asset Management",
      "READ_WRITE",
      data.branch2.id
    );

    assert.strictEqual(hasPerm2, true, "Should have permission in branch 2");

  } finally {
    await cleanupTestData(data);
  }
});

test("Cross-Branch: Role doesn't apply outside scope", async () => {
  const data = await setupTestData();

  try {
    // Assign role scoped to only branch 1
    await iamService.assignRoleToGroupForBranches(
      data.group1.id,
      data.roles.managerRole.id,
      [data.branch1.id]
    );

    // User doesn't have permissions in branch 2 (outside scope)
    const hasPerm = await iamService.hasPermissionInBranch(
      data.branch1Admin.id,
      "ASSET",
      "Asset Management",
      "READ_WRITE",
      data.branch2.id
    );

    assert.strictEqual(hasPerm, false, "Should NOT have permission in branch 2");

  } finally {
    await cleanupTestData(data);
  }
});
```

---

## Admin Panel Configuration

In the admin UI (future phase), allow:

```
Role Assignment Form:
├─ Select Role: [MANAGER dropdown]
├─ Apply to Branches:
│  ├─ ☐ All Branches (null)
│  ├─ ☐ Branch 1
│  ├─ ☐ Branch 2
│  └─ ☐ Branch 3
└─ [Save] [Cancel]
```

---

## Summary

**Before:** Branch Admin → Can only assign roles to users in their branch  
**After:** Branch Admin → Can assign roles to users in multiple branches with fine-grained scope

This enables scenarios like:
- Multi-location management
- Shared services across branches
- Temporary cross-branch access
- Project-based cross-branch teams

All while maintaining proper access control and audit trails.

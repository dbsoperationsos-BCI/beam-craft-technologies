# IAM Implementation Guide with Branch Restrictions

## Complete Implementation Plan

### Phase 1: Database Schema Design
### Phase 2: Backend Services & Middleware
### Phase 3: Admin UI Structure
### Phase 4: Route Protection & Filtering
### Phase 5: Frontend Implementation

---

## PHASE 1: DATABASE SCHEMA (with Branch Support)

### Database Model Relationships

```
User
  ├─ belongsTo: Branch (branchId)
  └─ hasMany: UserGroupMember (userIds)

UserGroup
  ├─ belongsTo: Branch (branchId) [optional - null = organization-wide]
  └─ hasMany: UserGroupMember
  └─ hasMany: UserGroupRole

UserGroupMember
  ├─ belongsTo: User
  └─ belongsTo: UserGroup

Role
  ├─ isSystem: Boolean (SUPER_ADMIN cannot be modified)
  ├─ isAdmin: Boolean (Admin role)
  ├─ isBranchManager: Boolean (Branch manager role)
  └─ hasMany: RolePermission

Permission
  ├─ module: String (ASSET, HRM, SALES, IMAGE_SELECTION, ADMIN)
  ├─ feature: String (Asset Management, Employee Management, etc.)
  └─ hasMany: RolePermission

RolePermission
  ├─ roleId
  ├─ permissionId
  └─ accessLevel: String (DISABLED, READ, READ_WRITE)

UserGroupRole
  ├─ userGroupId
  └─ roleId

Branch (Location)
  ├─ code
  ├─ name
  ├─ isActive
  └─ hasMany: Users
  └─ hasMany: UserGroups (optional)
```

### Prisma Schema Implementation

```prisma
// ============================================
// BRANCH/LOCATION MODEL (Already exists)
// ============================================
model Location {
  id          Int      @id @default(autoincrement())
  code        String   @unique @db.VarChar(50)
  name        String   @db.VarChar(120)
  address     String?  @db.Text
  description String?  @db.Text
  isActive    Boolean  @default(true) @map("is_active")
  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt @map("updated_at")
  
  // Relations
  users       User[]
  userGroups  UserGroup[]
  assets      Asset[]
  
  @@map("location")
  @@index([isActive, name])
}

// ============================================
// USER MODEL (Enhanced with branch support)
// ============================================
model User {
  id                 Int       @id @default(autoincrement())
  name               String
  email              String    @unique
  username           String?   @unique @db.VarChar(50)
  password           String
  
  // Branch Assignment (CRITICAL for branch-wise restrictions)
  branchId           Int?      @map("branch_id")
  branch             Location? @relation(fields: [branchId], references: [id], onDelete: SetNull)
  
  // Legacy role support (deprecated after 3 months)
  role               String    @default("SUPER_ADMIN")
  
  status             String    @default("ACTIVE")
  linkedEmployeeId   Int?      @unique @map("linked_employee_id")
  accessDepartment   String?   @db.VarChar(100) @map("access_department")
  mustChangePassword Boolean   @default(true) @map("must_change_password")
  credentialsSentAt  DateTime? @map("credentials_sent_at")
  lastLoginAt        DateTime? @map("last_login_at")
  createdAt          DateTime  @default(now()) @map("created_at")
  updatedAt          DateTime  @updatedAt @map("updated_at")
  
  // IAM Relations
  groupMemberships   UserGroupMember[]
  
  @@map("user")
  @@index([branchId])
  @@index([accessDepartment])
  @@index([role])
}

// ============================================
// USER GROUP MODEL (with branch scoping)
// ============================================
model UserGroup {
  id              String     @id @default(cuid())
  name            String     @db.VarChar(150)
  description     String?    @db.Text
  
  // BRANCH SCOPING: null = organization-wide, set = branch-specific
  branchId        Int?       @map("branch_id")
  branch          Location?  @relation(fields: [branchId], references: [id], onDelete: Cascade)
  
  isActive        Boolean    @default(true) @map("is_active")
  createdAt       DateTime   @default(now()) @map("created_at")
  updatedAt       DateTime   @updatedAt @map("updated_at")
  
  // Relations
  members         UserGroupMember[]
  roles           UserGroupRole[]
  
  @@unique([name, branchId])  // Can have same group name in different branches
  @@map("user_group")
  @@index([branchId])
  @@index([isActive])
}

// ============================================
// USER GROUP MEMBERSHIP (junction)
// ============================================
model UserGroupMember {
  id        String     @id @default(cuid())
  userId    Int
  groupId   String
  joinedAt  DateTime   @default(now()) @map("joined_at")
  
  user      User       @relation(fields: [userId], references: [id], onDelete: Cascade)
  group     UserGroup  @relation(fields: [groupId], references: [id], onDelete: Cascade)
  
  @@unique([userId, groupId])
  @@map("user_group_member")
  @@index([groupId])
  @@index([userId])
}

// ============================================
// ROLE MODEL (System-wide or branch-specific)
// ============================================
model Role {
  id              String     @id @default(cuid())
  name            String     @unique @db.VarChar(100)
  description     String?    @db.Text
  
  // Role characteristics (like Nokia)
  isSystem        Boolean    @default(false) @map("is_system")      // Cannot be deleted if true
  isAdmin         Boolean    @default(false) @map("is_admin")       // Full admin access
  isBranchManager Boolean    @default(false) @map("is_branch_manager") // Branch-level admin
  isDepartmentLead Boolean   @default(false) @map("is_department_lead")
  
  isActive        Boolean    @default(true) @map("is_active")
  createdAt       DateTime   @default(now()) @map("created_at")
  updatedAt       DateTime   @updatedAt @map("updated_at")
  
  // Relations
  permissions     RolePermission[]
  groupRoles      UserGroupRole[]
  
  @@map("role")
  @@index([isActive])
  @@index([isSystem])
}

// ============================================
// PERMISSION MODEL (Modules & Features)
// ============================================
model Permission {
  id          String     @id @default(cuid())
  module      String     @db.VarChar(50)        // ASSET, HRM, SALES, IMAGE_SELECTION, ADMIN
  feature     String     @db.VarChar(100)       // Asset Management, Employee Management
  level       String     @db.VarChar(50)        // ASSET_MANAGE, EMPLOYEE_MANAGE, PROJECT_MANAGE
  description String?    @db.Text
  displayName String?    @db.VarChar(150) @map("display_name")
  
  isActive    Boolean    @default(true) @map("is_active")
  createdAt   DateTime   @default(now()) @map("created_at")
  updatedAt   DateTime   @updatedAt @map("updated_at")
  
  // Relations
  roles       RolePermission[]
  
  @@unique([module, feature, level])
  @@map("permission")
  @@index([module])
  @@index([isActive])
}

// ============================================
// ROLE-PERMISSION JUNCTION (with access levels)
// ============================================
model RolePermission {
  id          String     @id @default(cuid())
  roleId      String
  permissionId String
  
  // ACCESS LEVEL: This is the key for Read/Read-Write implementation
  accessLevel String     @db.VarChar(20)  // DISABLED, READ, READ_WRITE
  
  createdAt   DateTime   @default(now()) @map("created_at")
  updatedAt   DateTime   @updatedAt @map("updated_at")
  
  role        Role       @relation(fields: [roleId], references: [id], onDelete: Cascade)
  permission  Permission @relation(fields: [permissionId], references: [id], onDelete: Cascade)
  
  @@unique([roleId, permissionId])
  @@map("role_permission")
  @@index([roleId])
  @@index([permissionId])
}

// ============================================
// USER GROUP-ROLE JUNCTION
// ============================================
model UserGroupRole {
  id      String     @id @default(cuid())
  groupId String
  roleId  String
  
  group   UserGroup  @relation(fields: [groupId], references: [id], onDelete: Cascade)
  role    Role       @relation(fields: [roleId], references: [id], onDelete: Cascade)
  
  @@unique([groupId, roleId])
  @@map("user_group_role")
  @@index([groupId])
  @@index([roleId])
}
```

---

## PHASE 2: BACKEND SERVICES & MIDDLEWARE

### File: `backend/src/services/iam.service.js`

**Core IAM Service with Branch Filtering**

```javascript
const prisma = require("@/config/db");

class IAMService {
  // ============================================
  // USER PERMISSIONS (with branch check)
  // ============================================
  
  async getUserWithPermissions(userId) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        branch: true,
        groupMemberships: {
          include: {
            group: true
          }
        }
      }
    });
    
    if (!user) throw new Error("User not found");
    return user;
  }
  
  async getUserPermissions(userId) {
    const user = await this.getUserWithPermissions(userId);
    
    // SUPER_ADMIN bypass: has all permissions
    if (user.role === "SUPER_ADMIN") {
      return this._getAllPermissions();
    }
    
    // Get all groups user belongs to
    const groupIds = user.groupMemberships.map(m => m.groupId);
    
    // Get all roles from those groups
    const rolePermissions = await prisma.userGroupRole.findMany({
      where: {
        groupId: { in: groupIds }
      },
      include: {
        role: {
          include: {
            permissions: {
              include: { permission: true }
            }
          }
        }
      }
    });
    
    // Flatten and deduplicate permissions
    const permissions = new Map();
    rolePermissions.forEach(rp => {
      rp.role.permissions.forEach(perm => {
        const key = `${perm.permission.module}:${perm.permission.level}`;
        permissions.set(key, {
          ...perm.permission,
          accessLevel: perm.accessLevel
        });
      });
    });
    
    return Array.from(permissions.values());
  }
  
  // ============================================
  // PERMISSION CHECKING (with branch scope)
  // ============================================
  
  async hasPermission(userId, module, feature, requiredLevel = "READ") {
    const user = await this.getUserWithPermissions(userId);
    
    // SUPER_ADMIN has all permissions
    if (user.role === "SUPER_ADMIN") return true;
    
    const permissions = await this.getUserPermissions(userId);
    
    // Find matching permission
    const permission = permissions.find(
      p => p.module === module && p.feature === feature
    );
    
    if (!permission || permission.accessLevel === "DISABLED") {
      return false;
    }
    
    // Check access level
    if (requiredLevel === "READ") {
      return permission.accessLevel === "READ" || permission.accessLevel === "READ_WRITE";
    }
    
    if (requiredLevel === "READ_WRITE") {
      return permission.accessLevel === "READ_WRITE";
    }
    
    return false;
  }
  
  // ============================================
  // BRANCH RESTRICTIONS (CRITICAL)
  // ============================================
  
  async canAccessBranch(userId, targetBranchId) {
    const user = await this.getUserWithPermissions(userId);
    
    // SUPER_ADMIN can access all branches
    if (user.role === "SUPER_ADMIN") return true;
    
    // BRANCH_MANAGER can access their assigned branch
    if (user.role === "BRANCH_ADMIN" || user.role === "BRANCH_MANAGER") {
      return user.branchId === targetBranchId;
    }
    
    // Regular users can only access their own branch
    if (user.branchId === targetBranchId) return true;
    
    return false;
  }
  
  // ============================================
  // BUILD FILTERS (for queries with branch scope)
  // ============================================
  
  async buildBranchFilter(userId) {
    const user = await this.getUserWithPermissions(userId);
    
    // SUPER_ADMIN: no filter (sees all branches)
    if (user.role === "SUPER_ADMIN") {
      return {};
    }
    
    // Others: only their branch
    if (user.branchId) {
      return { branchId: user.branchId };
    }
    
    return { branchId: null };
  }
  
  // ============================================
  // ADMIN OPERATIONS (User/Group/Role management)
  // ============================================
  
  async createUser(data) {
    return prisma.user.create({
      data: {
        name: data.name,
        email: data.email,
        username: data.username,
        password: data.password,
        branchId: data.branchId,
        status: "ACTIVE"
      }
    });
  }
  
  async assignUserToGroup(userId, groupId) {
    // Verify branch match (can't add user from branch A to group in branch B)
    const user = await prisma.user.findUnique({ where: { id: userId } });
    const group = await prisma.userGroup.findUnique({ where: { id: groupId } });
    
    if (user.branchId !== group.branchId) {
      throw new Error("Cannot assign user to group in different branch");
    }
    
    return prisma.userGroupMember.create({
      data: { userId, groupId }
    });
  }
  
  async createUserGroup(data, adminBranchId) {
    // Branch manager can only create groups in their branch
    const adminUser = await this.getUserWithPermissions(data.createdByUserId);
    
    if (adminUser.role !== "SUPER_ADMIN" && data.branchId !== adminUser.branchId) {
      throw new Error("Cannot create group in other branches");
    }
    
    return prisma.userGroup.create({
      data: {
        name: data.name,
        description: data.description,
        branchId: data.branchId
      }
    });
  }
  
  async assignRoleToGroup(groupId, roleId) {
    return prisma.userGroupRole.create({
      data: { groupId, roleId }
    });
  }
  
  // ============================================
  // UTILITY METHODS
  // ============================================
  
  async _getAllPermissions() {
    return prisma.permission.findMany({
      where: { isActive: true }
    });
  }
  
  async getAllRoles() {
    return prisma.role.findMany({
      where: { isActive: true },
      include: { permissions: true }
    });
  }
  
  async getAllPermissions() {
    return prisma.permission.findMany({
      where: { isActive: true }
    });
  }
}

module.exports = new IAMService();
```

---

## PHASE 3: MIDDLEWARE FOR ROUTE PROTECTION

### File: `backend/src/middleware/permissionMiddleware.js`

```javascript
const iamService = require("@/services/iam.service");

// ============================================
// Check Permission + Branch Access
// ============================================
const checkPermission = (module, feature, requiredLevel = "READ") => {
  return async (req, res, next) => {
    try {
      // Check permission
      const hasPermission = await iamService.hasPermission(
        req.user.id,
        module,
        feature,
        requiredLevel
      );
      
      if (!hasPermission) {
        return res.status(403).json({
          message: `You don't have ${requiredLevel} permission for ${module}:${feature}`
        });
      }
      
      // Attach permission info to request
      req.permission = {
        module,
        feature,
        level: requiredLevel
      };
      
      next();
    } catch (error) {
      res.status(500).json({ message: "Permission check failed" });
    }
  };
};

// ============================================
// Check Branch Access
// ============================================
const checkBranchAccess = (branchIdParam = "branchId") => {
  return async (req, res, next) => {
    try {
      const targetBranchId = parseInt(
        req.params[branchIdParam] || req.body[branchIdParam]
      );
      
      if (!targetBranchId) {
        return res.status(400).json({ message: "Branch ID required" });
      }
      
      const canAccess = await iamService.canAccessBranch(req.user.id, targetBranchId);
      
      if (!canAccess) {
        return res.status(403).json({
          message: "You cannot access this branch"
        });
      }
      
      req.targetBranchId = targetBranchId;
      next();
    } catch (error) {
      res.status(500).json({ message: "Branch access check failed" });
    }
  };
};

module.exports = {
  checkPermission,
  checkBranchAccess
};
```

---

## PHASE 4: ROUTE PROTECTION EXAMPLES

### Example 1: Asset Module Routes

**File**: `backend/src/modules/assets/assets.routes.js`

```javascript
const express = require("express");
const { protect } = require("@/middleware/authMiddleware");
const { 
  checkPermission, 
  checkBranchAccess 
} = require("@/middleware/permissionMiddleware");
const controller = require("./assets.controller");

const router = express.Router();

// Apply authentication to all routes
router.use(protect);

// ============================================
// ASSET ROUTES (with permission + branch checks)
// ============================================

// GET /api/assets
// Permission: ASSET module, Asset Management feature, READ access
router.get(
  "/",
  checkPermission("ASSET", "Asset Management", "READ"),
  checkBranchAccess("branchId"),
  controller.listAssets
);

// POST /api/assets
// Permission: ASSET module, Asset Management feature, READ_WRITE access
router.post(
  "/",
  checkPermission("ASSET", "Asset Management", "READ_WRITE"),
  checkBranchAccess("branchId"),
  controller.createAsset
);

// PATCH /api/assets/:assetId
router.patch(
  "/:assetId",
  checkPermission("ASSET", "Asset Management", "READ_WRITE"),
  checkBranchAccess("branchId"),
  controller.updateAsset
);

// DELETE /api/assets/:assetId
router.delete(
  "/:assetId",
  checkPermission("ASSET", "Asset Management", "READ_WRITE"),
  checkBranchAccess("branchId"),
  controller.deleteAsset
);

// GET /api/assets/:assetId/inspect
// Different feature for inspection
router.get(
  "/:assetId/inspect",
  checkPermission("ASSET", "Asset Inspection", "READ"),
  checkBranchAccess("branchId"),
  controller.getInspectionHistory
);

module.exports = router;
```

### Example 2: HRM Module Routes

**File**: `backend/src/modules/hrm/employees/routes.js`

```javascript
const express = require("express");
const { protect } = require("@/middleware/authMiddleware");
const { checkPermission, checkBranchAccess } = require("@/middleware/permissionMiddleware");
const controller = require("./employees.controller");

const router = express.Router();
router.use(protect);

// LIST EMPLOYEES: READ permission required
router.get(
  "/",
  checkPermission("HRM", "Employee Management", "READ"),
  checkBranchAccess("branchId"),
  controller.listEmployees
);

// CREATE EMPLOYEE: READ_WRITE permission required
router.post(
  "/",
  checkPermission("HRM", "Employee Management", "READ_WRITE"),
  checkBranchAccess("branchId"),
  controller.createEmployee
);

// UPDATE EMPLOYEE: READ_WRITE permission required
router.patch(
  "/:employeeId",
  checkPermission("HRM", "Employee Management", "READ_WRITE"),
  checkBranchAccess("branchId"),
  controller.updateEmployee
);

// APPROVE PAYMENT REQUEST: Different permission
router.post(
  "/:employeeId/payment-requests/:requestId/approve",
  checkPermission("HRM", "Payment Request Approval", "READ_WRITE"),
  checkBranchAccess("branchId"),
  controller.approvePaymentRequest
);

module.exports = router;
```

---

## PHASE 5: PERMISSION MATRIX (System Setup)

### File: `backend/prisma/seeds/create-permissions.js`

```javascript
const prisma = require("@/config/db");

const PERMISSIONS = [
  // ============================================
  // ASSET MODULE
  // ============================================
  {
    module: "ASSET",
    feature: "Asset Management",
    level: "ASSET_MANAGE",
    displayName: "Manage Assets",
    description: "Create, read, update, delete assets"
  },
  {
    module: "ASSET",
    feature: "Asset Inspection",
    level: "ASSET_INSPECT",
    displayName: "Inspect Assets",
    description: "View and perform asset inspections"
  },
  {
    module: "ASSET",
    feature: "Asset Assignment",
    level: "ASSET_ASSIGN",
    displayName: "Assign Assets",
    description: "Assign assets to employees"
  },
  
  // ============================================
  // HRM MODULE
  // ============================================
  {
    module: "HRM",
    feature: "Employee Management",
    level: "EMPLOYEE_MANAGE",
    displayName: "Manage Employees",
    description: "Create, read, update, delete employee records"
  },
  {
    module: "HRM",
    feature: "Payment Request Approval",
    level: "PAYMENT_APPROVE",
    displayName: "Approve Payments",
    description: "Approve payment requests"
  },
  {
    module: "HRM",
    feature: "Payroll Management",
    level: "PAYROLL_MANAGE",
    displayName: "Manage Payroll",
    description: "Handle payroll and salary management"
  },
  
  // ============================================
  // SALES MODULE
  // ============================================
  {
    module: "SALES",
    feature: "Project Management",
    level: "PROJECT_MANAGE",
    displayName: "Manage Projects",
    description: "Create, read, update, delete projects"
  },
  {
    module: "SALES",
    feature: "CRM Leads",
    level: "LEAD_MANAGE",
    displayName: "Manage Leads",
    description: "Manage CRM leads"
  },
  {
    module: "SALES",
    feature: "Quotation Management",
    level: "QUOTATION_MANAGE",
    displayName: "Manage Quotations",
    description: "Create and manage quotations"
  },
  
  // ============================================
  // IMAGE SELECTION MODULE
  // ============================================
  {
    module: "IMAGE_SELECTION",
    feature: "Project Management",
    level: "ISPROJECT_MANAGE",
    displayName: "Manage IS Projects",
    description: "Create and manage image selection projects"
  },
  {
    module: "IMAGE_SELECTION",
    feature: "Upload & Gallery",
    level: "UPLOAD_PUBLISH",
    displayName: "Upload & Publish",
    description: "Upload images and publish galleries"
  },
  
  // ============================================
  // ADMIN MODULE
  // ============================================
  {
    module: "ADMIN",
    feature: "User Management",
    level: "USER_MANAGE",
    displayName: "Manage Users",
    description: "Create, read, update, delete users"
  },
  {
    module: "ADMIN",
    feature: "Role Management",
    level: "ROLE_MANAGE",
    displayName: "Manage Roles",
    description: "Create and manage roles"
  },
  {
    module: "ADMIN",
    feature: "System Settings",
    level: "SETTINGS_MANAGE",
    displayName: "System Settings",
    description: "Manage system configuration"
  }
];

async function seedPermissions() {
  for (const perm of PERMISSIONS) {
    await prisma.permission.upsert({
      where: {
        module_feature_level: {
          module: perm.module,
          feature: perm.feature,
          level: perm.level
        }
      },
      create: perm,
      update: perm
    });
  }
  console.log("✅ Permissions seeded");
}

async function seedRoles() {
  // SUPER_ADMIN: All permissions with READ_WRITE
  const superAdminRole = await prisma.role.upsert({
    where: { name: "SUPER_ADMIN" },
    create: {
      name: "SUPER_ADMIN",
      description: "Full system access",
      isSystem: true,
      isAdmin: true
    },
    update: {}
  });
  
  // ADMIN: Most permissions with READ_WRITE
  const adminRole = await prisma.role.upsert({
    where: { name: "ADMIN" },
    create: {
      name: "ADMIN",
      description: "Administrative access",
      isSystem: true,
      isAdmin: true
    },
    update: {}
  });
  
  // BRANCH_MANAGER: Branch-level admin (only their branch)
  const branchManagerRole = await prisma.role.upsert({
    where: { name: "BRANCH_MANAGER" },
    create: {
      name: "BRANCH_MANAGER",
      description: "Branch-level administrator",
      isSystem: true,
      isBranchManager: true
    },
    update: {}
  });
  
  // MANAGER: Can manage team and resources
  const managerRole = await prisma.role.upsert({
    where: { name: "MANAGER" },
    create: {
      name: "MANAGER",
      description: "Team manager",
      isSystem: true
    },
    update: {}
  });
  
  // STAFF: Basic access (READ + limited READ_WRITE)
  const staffRole = await prisma.role.upsert({
    where: { name: "STAFF" },
    create: {
      name: "STAFF",
      description: "Regular staff member",
      isSystem: true
    },
    update: {}
  });
  
  console.log("✅ Roles seeded");
  return { superAdminRole, adminRole, branchManagerRole, managerRole, staffRole };
}

async function assignPermissionsToRoles() {
  const permissions = await prisma.permission.findMany();
  const roles = await prisma.role.findMany();
  
  // SUPER_ADMIN: All permissions READ_WRITE
  const superAdminRole = roles.find(r => r.name === "SUPER_ADMIN");
  for (const perm of permissions) {
    await prisma.rolePermission.upsert({
      where: {
        roleId_permissionId: {
          roleId: superAdminRole.id,
          permissionId: perm.id
        }
      },
      create: {
        roleId: superAdminRole.id,
        permissionId: perm.id,
        accessLevel: "READ_WRITE"
      },
      update: {}
    });
  }
  
  // ADMIN: Most READ_WRITE, except SETTINGS (READ only)
  const adminRole = roles.find(r => r.name === "ADMIN");
  for (const perm of permissions) {
    const accessLevel = perm.level === "SETTINGS_MANAGE" ? "READ" : "READ_WRITE";
    await prisma.rolePermission.upsert({
      where: {
        roleId_permissionId: {
          roleId: adminRole.id,
          permissionId: perm.id
        }
      },
      create: {
        roleId: adminRole.id,
        permissionId: perm.id,
        accessLevel
      },
      update: {}
    });
  }
  
  // BRANCH_MANAGER: Limited permissions READ_WRITE in their branch
  const branchManagerRole = roles.find(r => r.name === "BRANCH_MANAGER");
  const branchManagerPermissions = permissions.filter(p => 
    !["ROLE_MANAGE", "SETTINGS_MANAGE", "USER_MANAGE"].includes(p.level)
  );
  for (const perm of branchManagerPermissions) {
    await prisma.rolePermission.upsert({
      where: {
        roleId_permissionId: {
          roleId: branchManagerRole.id,
          permissionId: perm.id
        }
      },
      create: {
        roleId: branchManagerRole.id,
        permissionId: perm.id,
        accessLevel: "READ_WRITE"
      },
      update: {}
    });
  }
  
  // MANAGER: Most READ, some READ_WRITE
  const managerRole = roles.find(r => r.name === "MANAGER");
  const managerPermissions = permissions.filter(p =>
    !["ROLE_MANAGE", "USER_MANAGE", "SETTINGS_MANAGE"].includes(p.level)
  );
  for (const perm of managerPermissions) {
    const accessLevel = ["EMPLOYEE_MANAGE", "ASSET_MANAGE", "PROJECT_MANAGE"].includes(perm.level)
      ? "READ_WRITE"
      : "READ";
    await prisma.rolePermission.upsert({
      where: {
        roleId_permissionId: {
          roleId: managerRole.id,
          permissionId: perm.id
        }
      },
      create: {
        roleId: managerRole.id,
        permissionId: perm.id,
        accessLevel
      },
      update: {}
    });
  }
  
  // STAFF: Most READ only, some READ_WRITE
  const staffRole = roles.find(r => r.name === "STAFF");
  const staffPermissions = permissions.filter(p =>
    !["ROLE_MANAGE", "USER_MANAGE", "SETTINGS_MANAGE", "PAYROLL_MANAGE"].includes(p.level)
  );
  for (const perm of staffPermissions) {
    const accessLevel = ["ASSET_MANAGE", "PROJECT_MANAGE"].includes(perm.level)
      ? "READ_WRITE"
      : "READ";
    await prisma.rolePermission.upsert({
      where: {
        roleId_permissionId: {
          roleId: staffRole.id,
          permissionId: perm.id
        }
      },
      create: {
        roleId: staffRole.id,
        permissionId: perm.id,
        accessLevel
      },
      update: {}
    });
  }
  
  console.log("✅ Permissions assigned to roles");
}

async function main() {
  await seedPermissions();
  const roles = await seedRoles();
  await assignPermissionsToRoles();
}

main().catch(console.error);
```

---

## COMPLETE FLOW DIAGRAM

```
REQUEST
  ↓
authMiddleware (verify JWT + load user + branch)
  ↓
checkBranchAccess (verify user can access target branch)
  ↓
checkPermission (verify user has required permission level for module:feature)
  ↓
CONTROLLER
  ├─ Get data from database
  ├─ Apply branch filter (WHERE branchId = userBranchId)
  ├─ Return only data user can access
  └─ Send response
```

---

## DATABASE QUERIES EXAMPLES

### Example 1: List Assets (with branch filter)

```javascript
// User in Branch 1 with READ permission
const branchFilter = await iamService.buildBranchFilter(userId);
// Returns: { branchId: 1 }

const assets = await prisma.asset.findMany({
  where: {
    ...branchFilter,  // Only Branch 1 assets
    isDeleted: false
  },
  include: { assignedPerson: true, branch: true }
});
```

### Example 2: User Permissions Query

```javascript
// Get all permissions for a user
const permissions = await iamService.getUserPermissions(userId);
// Returns:
// [
//   { module: "ASSET", feature: "Asset Management", accessLevel: "READ_WRITE" },
//   { module: "HRM", feature: "Employee Management", accessLevel: "READ" },
//   ...
// ]
```

### Example 3: Check Permission Before Action

```javascript
// In controller before updating asset
const canUpdate = await iamService.hasPermission(
  userId,
  "ASSET",
  "Asset Management",
  "READ_WRITE"
);

if (!canUpdate) {
  return res.status(403).json({ message: "No update permission" });
}
```

---

## ADMIN PANEL UI STRUCTURE (Nokia-style)

```
/admin/
├── USERS
│   ├─ List: name | email | branch | group | status | actions
│   ├─ Create: name, email, branch selector, group selector, password
│   └─ Edit: change branch, change group, activate/deactivate
│
├── GROUPS
│   ├─ List: name | description | branch | member count | roles | actions
│   ├─ Create: name, description, branch selector, assign roles
│   └─ Edit: add/remove members, change roles
│
├── ROLES
│   ├─ List: name | description | characteristics | permission count | system
│   ├─ Create (Tabs like Nokia):
│   │   ├─ Identification: role name, description
│   │   ├─ Characteristics: Admin checkbox, Branch Manager checkbox, Dept Lead checkbox
│   │   └─ Action Permissions (Permission Matrix):
│   │       ├─ ASSET MODULE
│   │       │  ├─ Asset Management: [Dropdown: DISABLED | READ | READ_WRITE]
│   │       │  ├─ Asset Inspection: [Dropdown: DISABLED | READ | READ_WRITE]
│   │       │  └─ Asset Assignment: [Dropdown: DISABLED | READ | READ_WRITE]
│   │       ├─ HRM MODULE
│   │       │  ├─ Employee Management: [Dropdown: DISABLED | READ | READ_WRITE]
│   │       │  ├─ Payment Approval: [Dropdown: DISABLED | READ | READ_WRITE]
│   │       │  └─ Payroll: [Dropdown: DISABLED | READ | READ_WRITE]
│   │       ├─ SALES MODULE (similar)
│   │       └─ IMAGE_SELECTION MODULE (similar)
│   └─ Edit: same as create
│
└── PERMISSIONS
    └─ Read-only list: module | feature | permission level | description
```

---

## SUMMARY OF IMPLEMENTATION
(Will be explained clearly in next section)

# Complete IAM Implementation Explanation

## How Everything Works Together

---

## 1️⃣ DATABASE ARCHITECTURE (The Foundation)

### What Each Table Does

```
┌─────────────────────────────────────────────────────────────┐
│                        LOCATION (Branch)                     │
│  id | code | name | address | isActive                      │
│  ────────────────────────────────────────────────────────────│
│  1  | BR1  | Branch A | Chennai | true                      │
│  2  | BR2  | Branch B | Bangalore | true                    │
└─────────────────────────────────────────────────────────────┘
         ↑                    ↑
    (assigned to)      (assigned to)
         ↑                    ↑
┌──────────────────┐   ┌──────────────────────┐
│   USER (John)    │   │  USERGROUP           │
│  id | name|email │   │ (Sales Team)         │
│  branchId: 1 ✓  │   │  branchId: 1 ✓      │
└──────────────────┘   └──────────────────────┘
         ↓                    ↓
      belongs to member of
         ↓                    ↓
┌─────────────────────────────────────────────────────────────┐
│         USERGROUPMEMBER (junction table)                     │
│  userId: John | groupId: SalesTeam                          │
└─────────────────────────────────────────────────────────────┘
         ↓
      has roles
         ↓
┌─────────────────────────────────────────────────────────────┐
│         USERGROUPROLE (junction table)                       │
│  groupId: SalesTeam | roleId: Manager                       │
└─────────────────────────────────────────────────────────────┘
         ↓
      contains
         ↓
┌──────────────────────────┐    ┌────────────────────────────┐
│   ROLE (Manager)         │    │  PERMISSION                │
│  name: Manager           │    │ module: ASSET              │
│  isAdmin: false          │    │ feature: Asset Management  │
│  isBranchManager: false  │    │ level: ASSET_MANAGE        │
│  isDepartmentLead: false │    └────────────────────────────┘
└──────────────────────────┘              ↑
         ↓                           relates to
      has
         ↓
┌─────────────────────────────────────────────────────────────┐
│         ROLEPERMISSION (junction table)                      │
│  roleId: Manager | permissionId: ASSET_MANAGE               │
│  accessLevel: READ_WRITE ✓                                  │
└─────────────────────────────────────────────────────────────┘
```

### Key Point: BRANCH RESTRICTION

The `branchId` field on both `User` and `UserGroup` ensures:
- ✅ Each user belongs to exactly ONE branch
- ✅ Each user group belongs to ONE branch (or null for org-wide)
- ✅ Users can only access data in their branch

---

## 2️⃣ PERMISSION FLOW (How Access is Checked)

### Flow Chart: Request to Response

```
┌─────────────────────┐
│  HTTP REQUEST       │
│  GET /api/assets    │
│  Headers: JWT token │
└──────────┬──────────┘
           ↓
┌─────────────────────────────────────────────────────────────┐
│ STEP 1: authMiddleware (JWT Verification)                  │
│                                                              │
│ • Verify JWT token signature ✓                             │
│ • Extract: userId, email, role                             │
│ • Load user from database with relations:                  │
│   - User's branch (branchId)                               │
│   - User's group memberships                               │
│ • Attach to req.user                                       │
└──────────┬──────────────────────────────────────────────────┘
           ↓
┌─────────────────────────────────────────────────────────────┐
│ STEP 2: checkBranchAccess Middleware                        │
│                                                              │
│ • Get target branch from request params                    │
│ • Call: canAccessBranch(userId, targetBranchId)           │
│                                                              │
│ Decision Tree:                                              │
│ if user.role === "SUPER_ADMIN"                             │
│   → allow (can access all branches) ✓                      │
│ else if user.branchId === targetBranchId                   │
│   → allow (their own branch) ✓                             │
│ else                                                        │
│   → deny (different branch) ✗                              │
│                                                              │
│ If denied → Return 403 Forbidden                           │
└──────────┬──────────────────────────────────────────────────┘
           ↓
┌─────────────────────────────────────────────────────────────┐
│ STEP 3: checkPermission Middleware                          │
│                                                              │
│ • Get all groups user belongs to                           │
│ • For each group, get all roles                            │
│ • For each role, get all permissions                       │
│ • Find permission matching (module + feature)              │
│ • Check accessLevel:                                        │
│   - DISABLED → deny ✗                                       │
│   - READ → allow if reading, deny if writing ✓/✗          │
│   - READ_WRITE → allow everything ✓                        │
│                                                              │
│ If denied → Return 403 Forbidden                           │
└──────────┬──────────────────────────────────────────────────┘
           ↓
┌─────────────────────────────────────────────────────────────┐
│ STEP 4: Controller (Business Logic)                         │
│                                                              │
│ • Query database:                                           │
│   const branchFilter = await buildBranchFilter(userId)     │
│   // Returns: { branchId: userBranchId }                   │
│                                                              │
│   const assets = await prisma.asset.findMany({            │
│     where: {                                               │
│       ...branchFilter,  // Only user's branch ✓           │
│       isDeleted: false                                     │
│     }                                                       │
│   });                                                       │
│                                                              │
│ • Process data (filter, sort, paginate)                   │
│ • Prepare response                                         │
└──────────┬──────────────────────────────────────────────────┘
           ↓
┌─────────────────────────────────────────────────────────────┐
│ STEP 5: Response                                            │
│                                                              │
│ 200 OK + [Assets from user's branch only]                  │
└─────────────────────────────────────────────────────────────┘
```

---

## 3️⃣ CONCRETE EXAMPLE: User Access Scenario

### Scenario: John (Branch A Manager) tries to list assets

```javascript
// ============================================
// SETUP
// ============================================
User: John
  ├─ id: 5
  ├─ email: john@example.com
  ├─ branchId: 1 (Branch A) ✓
  └─ role: "MANAGER"

UserGroup: "Sales Team"
  ├─ branchId: 1 (Branch A) ✓
  └─ roles: [Manager]

Role: "Manager"
  └─ permissions: [
      { module: ASSET, feature: Asset Management, accessLevel: READ_WRITE },
      { module: HRM, feature: Employee Management, accessLevel: READ },
      ...
    ]

// ============================================
// REQUEST: GET /api/assets?branchId=1
// ============================================

// STEP 1: authMiddleware loads John's user data ✓
req.user = {
  id: 5,
  name: "John",
  branchId: 1,
  role: "MANAGER"
}

// STEP 2: checkBranchAccess("branchId")
// Query: canAccessBranch(5, 1) // userId=5, targetBranchId=1
// Check: user.branchId (1) === targetBranchId (1) ✓
// Result: ALLOW ✓

// STEP 3: checkPermission("ASSET", "Asset Management", "READ")
// Get permissions for John:
//   - Find all groups John belongs to → ["Sales Team"]
//   - Find all roles for "Sales Team" → ["Manager"]
//   - Find all permissions for "Manager" → [...]
//   - Find permission: module=ASSET + feature=Asset Management
//   - accessLevel: READ_WRITE ✓
// Check: READ_WRITE covers READ? YES ✓
// Result: ALLOW ✓

// STEP 4: Controller - List Assets
const branchFilter = { branchId: 1 }; // From buildBranchFilter(5)
const assets = await prisma.asset.findMany({
  where: {
    branchId: 1,  // Only Branch A assets
    isDeleted: false
  }
});
// Returns: [Asset1(Branch A), Asset2(Branch A)]

// STEP 5: Response
200 OK
{
  data: [
    { id: 1, name: "Camera", branchId: 1, ... },
    { id: 2, name: "Lens", branchId: 1, ... }
  ]
}

// ============================================
// Same request, different scenario:
// REQUEST: GET /api/assets?branchId=2 (Branch B)
// ============================================

// STEP 2: checkBranchAccess("branchId")
// Check: user.branchId (1) === targetBranchId (2)? NO ✗
// Result: DENY
// Response: 403 Forbidden - "You cannot access this branch"
```

---

## 4️⃣ READ vs READ/WRITE Permission System

### How Permission Levels Work

```javascript
// ============================================
// PERMISSION LEVELS
// ============================================

const ACCESS_LEVELS = {
  DISABLED: {
    canRead: false,
    canWrite: false,
    canCreate: false,
    canDelete: false
  },
  
  READ: {
    canRead: true,      // ✓ Can view
    canWrite: false,    // ✗ Cannot edit
    canCreate: false,   // ✗ Cannot create
    canDelete: false    // ✗ Cannot delete
  },
  
  READ_WRITE: {
    canRead: true,      // ✓ Can view
    canWrite: true,     // ✓ Can edit
    canCreate: true,    // ✓ Can create
    canDelete: true     // ✓ Can delete
  }
};

// ============================================
// CHECKING PERMISSION IN MIDDLEWARE
// ============================================

async hasPermission(userId, module, feature, requiredLevel) {
  // Find user's permission for this module:feature
  const permission = await findPermission(userId, module, feature);
  
  if (!permission) return false;
  
  const { accessLevel } = permission;
  
  // Check if accessLevel covers requiredLevel
  if (requiredLevel === "READ") {
    // READ is satisfied by: READ or READ_WRITE
    return accessLevel === "READ" || accessLevel === "READ_WRITE";
  }
  
  if (requiredLevel === "READ_WRITE") {
    // READ_WRITE is ONLY satisfied by: READ_WRITE
    return accessLevel === "READ_WRITE";
  }
  
  return false;
}

// ============================================
// ROUTE PROTECTION EXAMPLES
// ============================================

// GET /api/assets (view assets)
router.get(
  "/",
  checkPermission("ASSET", "Asset Management", "READ"),  // Only need READ
  controller.listAssets
);

// POST /api/assets (create asset)
router.post(
  "/",
  checkPermission("ASSET", "Asset Management", "READ_WRITE"),  // Need WRITE
  controller.createAsset
);

// PATCH /api/assets/:id (edit asset)
router.patch(
  "/:id",
  checkPermission("ASSET", "Asset Management", "READ_WRITE"),  // Need WRITE
  controller.updateAsset
);

// DELETE /api/assets/:id (delete asset)
router.delete(
  "/:id",
  checkPermission("ASSET", "Asset Management", "READ_WRITE"),  // Need WRITE
  controller.deleteAsset
);

// ============================================
// PERMISSION CHECK EXAMPLES
// ============================================

// User has READ permission on ASSET:Asset Management
User Permission: READ

router.get("/", checkPermission("ASSET", "Asset Management", "READ"))
→ Allowed ✓

router.post("/", checkPermission("ASSET", "Asset Management", "READ_WRITE"))
→ Denied ✗ (has READ, needs READ_WRITE)

router.patch("/:id", checkPermission("ASSET", "Asset Management", "READ_WRITE"))
→ Denied ✗ (has READ, needs READ_WRITE)


// User has READ_WRITE permission on ASSET:Asset Management
User Permission: READ_WRITE

router.get("/", checkPermission("ASSET", "Asset Management", "READ"))
→ Allowed ✓

router.post("/", checkPermission("ASSET", "Asset Management", "READ_WRITE"))
→ Allowed ✓

router.patch("/:id", checkPermission("ASSET", "Asset Management", "READ_WRITE"))
→ Allowed ✓
```

---

## 5️⃣ BRANCH RESTRICTION MECHANISM

### How Branch Filtering Works

```javascript
// ============================================
// SCENARIO: Multi-branch database
// ============================================

Database Assets:
  id | name | branchId
  ───────────────────────
  1  | Camera | 1 (Branch A)
  2  | Lens | 1 (Branch A)
  3  | Monitor | 2 (Branch B)
  4  | Keyboard | 2 (Branch B)
  5  | Mouse | 1 (Branch A)

// ============================================
// USER 1: John (Branch A)
// ============================================

User: John
  ├─ id: 5
  ├─ branchId: 1

const branchFilter = await buildBranchFilter(5);
// Returns: { branchId: 1 }

const assets = await prisma.asset.findMany({
  where: {
    ...branchFilter  // Applied filter: branchId: 1
  }
});

// SQL generated:
// SELECT * FROM asset WHERE branchId = 1

// Results John sees:
[
  { id: 1, name: "Camera", branchId: 1 },
  { id: 2, name: "Lens", branchId: 1 },
  { id: 5, name: "Mouse", branchId: 1 }
]

// ============================================
// USER 2: Sarah (Branch B)
// ============================================

User: Sarah
  ├─ id: 10
  ├─ branchId: 2

const branchFilter = await buildBranchFilter(10);
// Returns: { branchId: 2 }

const assets = await prisma.asset.findMany({
  where: {
    ...branchFilter  // Applied filter: branchId: 2
  }
});

// SQL generated:
// SELECT * FROM asset WHERE branchId = 2

// Results Sarah sees:
[
  { id: 3, name: "Monitor", branchId: 2 },
  { id: 4, name: "Keyboard", branchId: 2 }
]

// ============================================
// SUPER ADMIN: Alex
// ============================================

User: Alex
  ├─ id: 1
  ├─ role: "SUPER_ADMIN"
  ├─ branchId: null (no restriction)

const branchFilter = await buildBranchFilter(1);
// Returns: {} (no filter - sees all)

const assets = await prisma.asset.findMany({
  where: {
    ...branchFilter  // No filter applied
  }
});

// SQL generated:
// SELECT * FROM asset

// Results Alex sees (ALL):
[
  { id: 1, name: "Camera", branchId: 1 },
  { id: 2, name: "Lens", branchId: 1 },
  { id: 3, name: "Monitor", branchId: 2 },
  { id: 4, name: "Keyboard", branchId: 2 },
  { id: 5, name: "Mouse", branchId: 1 }
]
```

---

## 6️⃣ COMPLETE REQUEST FLOW EXAMPLE

### Real-World: John trying to create an asset

```
┌───────────────────────────────────────────────────────────────┐
│ CLIENT (Frontend)                                              │
│                                                                │
│ POST /api/assets                                              │
│ Headers: Authorization: Bearer eyJhb...                       │
│ Body: { name: "NewCamera", branchId: 1 }                     │
└─────────────────┬─────────────────────────────────────────────┘
                  │
                  ↓
┌───────────────────────────────────────────────────────────────┐
│ SERVER - src/modules/assets/routes.js                         │
│                                                                │
│ router.post(                                                  │
│   "/",                                                        │
│   protect,                            ← MIDDLEWARE 1          │
│   checkBranchAccess("branchId"),      ← MIDDLEWARE 2          │
│   checkPermission("ASSET", "Asset Management", "READ_WRITE"),│
│                                       ← MIDDLEWARE 3          │
│   controller.createAsset              ← CONTROLLER            │
│ );                                                            │
└─────────────────┬─────────────────────────────────────────────┘
                  │
                  ↓
┌───────────────────────────────────────────────────────────────┐
│ MIDDLEWARE 1: protect (authMiddleware.js)                    │
│                                                                │
│ try {                                                         │
│   const token = req.headers.authorization.split(" ")[1];    │
│   const decoded = jwt.verify(token, JWT_SECRET);             │
│   // decoded = { id: 5, name: "John", branchId: 1 }          │
│                                                               │
│   const user = await prisma.user.findUnique({               │
│     where: { id: decoded.id },                              │
│     include: { groupMemberships: {...} }                    │
│   });                                                         │
│                                                               │
│   req.user = {                                               │
│     id: 5,                                                   │
│     name: "John",                                            │
│     branchId: 1,                                             │
│     role: "MANAGER",                                         │
│     groups: ["Sales Team"]                                   │
│   };                                                          │
│                                                               │
│   next(); → Continue to next middleware ✓                    │
│ }                                                             │
└─────────────────┬─────────────────────────────────────────────┘
                  │
                  ↓
┌───────────────────────────────────────────────────────────────┐
│ MIDDLEWARE 2: checkBranchAccess("branchId")                  │
│                                                                │
│ const targetBranchId = req.body.branchId;  // 1              │
│                                                               │
│ const canAccess = await iamService.canAccessBranch(         │
│   req.user.id,      // 5                                     │
│   targetBranchId    // 1                                     │
│ );                                                            │
│                                                               │
│ Decision:                                                     │
│   user.branchId (1) === targetBranchId (1)?                  │
│   1 === 1? YES ✓                                             │
│                                                               │
│ req.targetBranchId = 1;                                      │
│ next(); → Continue ✓                                         │
└─────────────────┬─────────────────────────────────────────────┘
                  │
                  ↓
┌───────────────────────────────────────────────────────────────┐
│ MIDDLEWARE 3: checkPermission("ASSET", "Asset Management",  │
│               "READ_WRITE")                                   │
│                                                                │
│ const permissions = await iamService.getUserPermissions(     │
│   req.user.id  // 5                                          │
│ );                                                            │
│                                                               │
│ // Query: Find all groups John belongs to                    │
│ groups = await prisma.userGroup.findMany({                   │
│   where: {                                                   │
│     members: { some: { userId: 5 } }                         │
│   }                                                           │
│ });                                                           │
│ // Result: [SalesTeam]                                       │
│                                                               │
│ // Query: Find all roles for SalesTeam group                 │
│ roles = await prisma.role.findMany({                         │
│   where: {                                                   │
│     groupRoles: { some: { groupId: SalesTeam.id } }          │
│   }                                                           │
│ });                                                           │
│ // Result: [Manager]                                         │
│                                                               │
│ // Query: Find all permissions for Manager role              │
│ permissions = await prisma.permission.findMany({             │
│   where: {                                                   │
│     roles: { some: { roleId: Manager.id } }                 │
│   }                                                           │
│ });                                                           │
│ // Result: [                                                 │
│ //   { module: ASSET, feature: Asset Management,             │
│ //     accessLevel: READ_WRITE }                             │
│ //   { module: HRM, feature: Employee Management,            │
│ //     accessLevel: READ }                                   │
│ // ]                                                          │
│                                                               │
│ // Find permission for ASSET + Asset Management              │
│ const permission = permissions.find(p =>                     │
│   p.module === "ASSET" && p.feature === "Asset Management"  │
│ );                                                            │
│ // Found: { accessLevel: READ_WRITE }                        │
│                                                               │
│ // Check if READ_WRITE covers required level READ_WRITE      │
│ READ_WRITE === READ_WRITE? YES ✓                             │
│                                                               │
│ next(); → Continue ✓                                         │
└─────────────────┬─────────────────────────────────────────────┘
                  │
                  ↓
┌───────────────────────────────────────────────────────────────┐
│ CONTROLLER: createAsset                                       │
│                                                                │
│ async createAsset(req, res) {                                │
│   // All checks passed, proceed                              │
│                                                               │
│   // Build branch filter                                     │
│   const branchFilter = await iamService.buildBranchFilter(  │
│     req.user.id  // 5                                        │
│   );                                                          │
│   // Returns: { branchId: 1 }                                │
│                                                               │
│   // Create asset                                            │
│   const asset = await prisma.asset.create({                 │
│     data: {                                                  │
│       name: "New Camera",                                    │
│       branchId: 1,  // From branch filter                    │
│       assignedPersonId: null,                                │
│       createdBy: 5   // John                                 │
│     }                                                         │
│   });                                                         │
│                                                               │
│   res.json({ success: true, data: asset });                 │
│ }                                                             │
└─────────────────┬─────────────────────────────────────────────┘
                  │
                  ↓
┌───────────────────────────────────────────────────────────────┐
│ RESPONSE: 200 OK                                              │
│                                                                │
│ {                                                             │
│   "success": true,                                            │
│   "data": {                                                   │
│     "id": 123,                                                │
│     "name": "New Camera",                                     │
│     "branchId": 1,                                            │
│     "createdBy": 5                                            │
│   }                                                           │
│ }                                                             │
└───────────────────────────────────────────────────────────────┘
```

---

## 7️⃣ NOKIA-STYLE ADMIN UI STRUCTURE

### Admin Panel Pages

```
/admin/iam/

├─ USERS (/admin/iam/users)
│  ├─ List View:
│  │  ├─ Search: by name, email
│  │  ├─ Filters: by branch, by group, by status
│  │  └─ Columns:
│  │     ├─ Name
│  │     ├─ Email
│  │     ├─ Branch
│  │     ├─ User Group(s)
│  │     ├─ Status (Active/Inactive)
│  │     ├─ Last Login
│  │     └─ Actions (Edit, Deactivate, Delete)
│  │
│  ├─ Create User Dialog:
│  │  ├─ Tab: Identification
│  │  │  ├─ Full Name *
│  │  │  ├─ Email *
│  │  │  ├─ Username
│  │  │  └─ Password *
│  │  │
│  │  └─ Assignment
│  │     ├─ Branch * (dropdown)
│  │     ├─ User Group(s) (multi-select)
│  │     └─ Status (Active/Inactive)
│  │
│  └─ Edit User: Similar to create
│
├─ USER GROUPS (/admin/iam/groups)
│  ├─ List View:
│  │  ├─ Columns:
│  │  │  ├─ Group Name
│  │  │  ├─ Description
│  │  │  ├─ Branch
│  │  │  ├─ Member Count
│  │  │  ├─ Assigned Roles
│  │  │  └─ Actions
│  │  │
│  │  └─ Create Group Button
│  │
│  ├─ Create/Edit Group Dialog:
│  │  ├─ Tab: Identification
│  │  │  ├─ Group Name *
│  │  │  ├─ Description
│  │  │  └─ Branch * (dropdown)
│  │  │
│  │  ├─ Tab: Members
│  │  │  ├─ Add Members (select from user list)
│  │  │  ├─ List of current members
│  │  │  └─ Remove button for each
│  │  │
│  │  └─ Tab: Roles
│  │     ├─ Available Roles (checkbox list)
│  │     └─ Selected Roles
│  │
│  └─ Group Detail View:
│     ├─ Group Info
│     ├─ Members list (with remove option)
│     └─ Roles assigned
│
├─ ROLES (/admin/iam/roles)
│  ├─ List View:
│  │  ├─ Columns:
│  │  │  ├─ Role Name
│  │  │  ├─ Description
│  │  │  ├─ Type (System/Custom)
│  │  │  ├─ Permission Count
│  │  │  ├─ Characteristics (Admin, Branch Manager, etc.)
│  │  │  └─ Actions (Edit, Delete if custom)
│  │  │
│  │  └─ Create Role Button
│  │
│  ├─ Create/Edit Role Dialog (LIKE NOKIA):
│  │  ├─ Tab: Identification
│  │  │  ├─ Role Name * (read-only if system)
│  │  │  ├─ Description
│  │  │  └─ Is System Role? (checkbox, disabled if system)
│  │  │
│  │  ├─ Tab: Characteristics
│  │  │  ├─ Administrator
│  │  │  │  └─ Checkbox: Grant full access to all resource groups
│  │  │  ├─ Branch Manager
│  │  │  │  └─ Checkbox: Grant admin access to assigned branch
│  │  │  └─ Department Lead
│  │  │     └─ Checkbox: Grant leadership permissions
│  │  │
│  │  └─ Tab: Action Permissions (PERMISSION MATRIX)
│  │     │
│  │     ├─ ASSET Module
│  │     │  ├─ Asset Management
│  │     │  │  └─ Dropdown: [DISABLED | READ | READ_WRITE]
│  │     │  ├─ Asset Inspection
│  │     │  │  └─ Dropdown: [DISABLED | READ | READ_WRITE]
│  │     │  └─ Asset Assignment
│  │     │     └─ Dropdown: [DISABLED | READ | READ_WRITE]
│  │     │
│  │     ├─ HRM Module
│  │     │  ├─ Employee Management
│  │     │  │  └─ Dropdown: [DISABLED | READ | READ_WRITE]
│  │     │  ├─ Payment Requests
│  │     │  │  └─ Dropdown: [DISABLED | READ | READ_WRITE]
│  │     │  └─ Payroll Management
│  │     │     └─ Dropdown: [DISABLED | READ | READ_WRITE]
│  │     │
│  │     ├─ SALES Module
│  │     │  ├─ Project Management
│  │     │  │  └─ Dropdown: [DISABLED | READ | READ_WRITE]
│  │     │  ├─ CRM Leads
│  │     │  │  └─ Dropdown: [DISABLED | READ | READ_WRITE]
│  │     │  └─ Quotation Management
│  │     │     └─ Dropdown: [DISABLED | READ | READ_WRITE]
│  │     │
│  │     ├─ IMAGE_SELECTION Module
│  │     │  ├─ Project Management
│  │     │  │  └─ Dropdown: [DISABLED | READ | READ_WRITE]
│  │     │  └─ Upload & Gallery
│  │     │     └─ Dropdown: [DISABLED | READ | READ_WRITE]
│  │     │
│  │     └─ ADMIN Module
│  │        ├─ User Management
│  │        │  └─ Dropdown: [DISABLED | READ | READ_WRITE]
│  │        ├─ Role Management
│  │        │  └─ Dropdown: [DISABLED | READ | READ_WRITE]
│  │        └─ System Settings
│  │           └─ Dropdown: [DISABLED | READ | READ_WRITE]
│  │
│  └─ Role Detail View:
│     ├─ Role Info
│     ├─ Characteristics display
│     └─ Permissions matrix (read-only)
│
└─ PERMISSIONS (/admin/iam/permissions)
   └─ Read-Only List View:
      ├─ Filters: by module
      ├─ Columns:
      │  ├─ Module
      │  ├─ Feature
      │  ├─ Level
      │  ├─ Display Name
      │  ├─ Description
      │  └─ Used by (which roles)
      └─ No edit/create (predefined)
```

---

## 8️⃣ KEY DESIGN PRINCIPLES (Why This Works)

### 1. **Hierarchical Permissions**
```
SUPER_ADMIN
  └─ Has ALL permissions READ_WRITE everywhere

ADMIN
  └─ Has most permissions READ_WRITE (except system settings)

BRANCH_MANAGER
  └─ Has most permissions READ_WRITE (but only in their branch)

MANAGER
  └─ Has READ_WRITE for management features, READ for most others

STAFF
  └─ Has mostly READ, some READ_WRITE for their specific work
```

### 2. **Module-Based Permissions**
- Each module (ASSET, HRM, SALES, etc.) has multiple features
- Each feature has permission level (DISABLED, READ, READ_WRITE)
- This allows fine-grained control

### 3. **Branch-Based Isolation**
- Every user belongs to exactly ONE branch
- Every user group belongs to ONE branch (or null for org-wide)
- All queries automatically filtered by user's branch
- SUPER_ADMIN bypass only for SUPER_ADMIN role

### 4. **Permission Level System**
```
DISABLED → Can't even see
READ → Can view but not modify
READ_WRITE → Can view and modify
```

### 5. **Group-based Assignment** (Instead of individual)
- Assign users to groups
- Assign roles to groups
- Users inherit all permissions from all their groups' roles
- Much easier to manage at scale

---

## 9️⃣ IMPLEMENTATION STEPS (Ready to Code)

```
Phase 1: Database
  ├─ Add Prisma models (User, UserGroup, Role, Permission, etc.)
  ├─ Run migration: npm run prisma:migrate dev
  ├─ Seed system roles and permissions
  └─ ✓ Database ready

Phase 2: Backend
  ├─ Create iam.service.js (core permission logic)
  ├─ Create permissionMiddleware.js (route protection)
  ├─ Create seeds for roles & permissions
  ├─ Update routes (add middleware to each endpoint)
  └─ ✓ Backend ready

Phase 3: Frontend
  ├─ Create AuthContext (load permissions from JWT)
  ├─ Create usePermissions hook
  ├─ Create permission guard components
  └─ ✓ Frontend ready

Phase 4: Admin UI
  ├─ Users management page
  ├─ Groups management page
  ├─ Roles management page (with permission matrix)
  └─ ✓ Admin panel ready
```

---

## 1️⃣0️⃣ SUMMARY

| Component | What It Does | Where |
|-----------|-------------|-------|
| **Database** | Stores users, groups, roles, permissions | `prisma/schema.prisma` |
| **IAM Service** | Checks permissions, loads user data | `services/iam.service.js` |
| **Auth Middleware** | Verifies JWT, loads user | `middleware/authMiddleware.js` |
| **Permission Middleware** | Checks branch + permission | `middleware/permissionMiddleware.js` |
| **Routes** | Apply middleware, call controller | `modules/*/routes.js` |
| **Controller** | Apply branch filter, query DB | `modules/*/controller.js` |
| **Admin UI** | Manage users/groups/roles | `/admin/iam/*` |

**The Flow:**
```
Request → Auth Check → Branch Check → Permission Check → Controller → Response
```

**Security Layers:**
```
Layer 1: JWT Authentication (is user who they claim?)
Layer 2: Branch Access (can user access this branch?)
Layer 3: Permission Check (does user have required permission level?)
Layer 4: Data Filter (only return data from user's branch)
```

---

## ✅ READY FOR IMPLEMENTATION

The complete implementation guide is in: `IAM_IMPLEMENTATION_GUIDE.md`

All phases are ready to code, with examples for each.

**Next step:** Start Phase 1 (Database Schema) by updating Prisma schema and running migration.

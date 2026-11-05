# IAM Implementation - Quick Start Guide

## 🚀 Ready to Deploy!

All code files have been created. Follow these steps to activate the IAM system:

---

## STEP 1: Run Database Migration (5 minutes)

```bash
cd backend
npm run prisma:migrate dev
```

**What happens:**
- Creates 8 new database tables (user_group, role, permission, etc.)
- Adds `branch_id` column to `user` table
- Adds relations to `location` table
- Generates Prisma client

**Expected output:**
```
✔ Enter a name for this migration › add_iam_system
✔ Database migrated, generated Prisma Client
```

✅ **Database is now ready!**

---

## STEP 2: Seed IAM Data (2 minutes)

```bash
npm run prisma:seed
```

**What happens:**
- Creates 5 system roles (SUPER_ADMIN, ADMIN, BRANCH_MANAGER, MANAGER, STAFF)
- Creates 13 permissions across 6 modules
- Assigns permissions to each role
- Updates admin user with IAM support

**Expected output:**
```
✅ Permissions seeded
✅ Roles seeded
✅ Permissions assigned to roles
✅ IAM seeding completed successfully!
```

✅ **IAM System is now live!**

---

## STEP 3: Verify Seed Data (2 minutes)

```bash
npm run prisma:studio
```

**What to check:**
1. Navigate to `role` table
   - Should see: SUPER_ADMIN, ADMIN, BRANCH_MANAGER, MANAGER, STAFF

2. Navigate to `permission` table
   - Should see 13 permissions like:
     - ASSET | Asset Management | ASSET_MANAGE
     - HRM | Employee Management | EMPLOYEE_MANAGE
     - etc.

3. Navigate to `role_permission` table
   - Should see assignments with access levels:
     - READ, READ_WRITE, DISABLED

✅ **All seed data verified!**

---

## STEP 4: Update Module Routes

Update each module's route file to add permission checks.

### For Assets Module: `src/modules/assets/assets.routes.js`

```javascript
// Add imports at top
const { checkPermission, checkBranchAccess } = require("@/middleware/permissionMiddleware");

// Update GET route
router.get(
  "/",
  checkBranchAccess("branchId"),
  checkPermission("ASSET", "Asset Management", "READ"),
  controller.listAssets
);

// Update POST route
router.post(
  "/",
  checkBranchAccess("branchId"),
  checkPermission("ASSET", "Asset Management", "READ_WRITE"),
  controller.createAsset
);

// Update PATCH route
router.patch(
  "/:assetId",
  checkBranchAccess("branchId"),
  checkPermission("ASSET", "Asset Management", "READ_WRITE"),
  controller.updateAsset
);

// Update DELETE route
router.delete(
  "/:assetId",
  checkBranchAccess("branchId"),
  checkPermission("ASSET", "Asset Management", "READ_WRITE"),
  controller.deleteAsset
);
```

### For HRM Module: `src/modules/hrm/employees/routes.js`

```javascript
const { checkPermission, checkBranchAccess } = require("@/middleware/permissionMiddleware");

// List employees
router.get(
  "/",
  checkBranchAccess("branchId"),
  checkPermission("HRM", "Employee Management", "READ"),
  controller.listEmployees
);

// Create employee
router.post(
  "/",
  checkBranchAccess("branchId"),
  checkPermission("HRM", "Employee Management", "READ_WRITE"),
  controller.createEmployee
);

// Approve payment
router.post(
  "/:employeeId/payment-requests/:requestId/approve",
  checkBranchAccess("branchId"),
  checkPermission("HRM", "Payment Request Approval", "READ_WRITE"),
  controller.approvePaymentRequest
);
```

### For Sales Module: `src/modules/sales/projects/routes.js`

```javascript
const { checkPermission, checkBranchAccess } = require("@/middleware/permissionMiddleware");

// List projects
router.get(
  "/",
  checkBranchAccess("branchId"),
  checkPermission("SALES", "Project Management", "READ"),
  controller.listProjects
);

// Create project
router.post(
  "/",
  checkBranchAccess("branchId"),
  checkPermission("SALES", "Project Management", "READ_WRITE"),
  controller.createProject
);
```

### For Image Selection Module: `src/modules/image-selection/projects/routes.js`

```javascript
const { checkPermission, checkBranchAccess } = require("@/middleware/permissionMiddleware");

// List projects
router.get(
  "/",
  checkBranchAccess("branchId"),
  checkPermission("IMAGE_SELECTION", "Project Management", "READ"),
  controller.listProjects
);

// Create project
router.post(
  "/",
  checkBranchAccess("branchId"),
  checkPermission("IMAGE_SELECTION", "Project Management", "READ_WRITE"),
  controller.createProject
);

// Publish
router.post(
  "/:projectId/publish",
  checkBranchAccess("branchId"),
  checkPermission("IMAGE_SELECTION", "Upload & Gallery", "READ_WRITE"),
  controller.publishProject
);
```

**Pattern for all routes:**
```
Read operation  → checkPermission(..., "READ")
Write operation → checkPermission(..., "READ_WRITE")
```

✅ **All routes protected!**

---

## STEP 5: Update Controllers for Branch Filtering

Add branch filtering to data queries.

### Example: `src/modules/assets/assets.controller.js`

```javascript
const iamService = require("@/services/iam.service");

async function listAssets(req, res) {
  try {
    // Build branch filter
    const branchFilter = await iamService.buildBranchFilter(req.user.id);

    // Query with filter
    const assets = await prisma.asset.findMany({
      where: {
        ...branchFilter,  // Adds { branchId: user.branchId }
        isDeleted: false
      },
      include: { assignedPerson: true, branch: true }
    });

    res.json({ success: true, data: assets });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}
```

### Apply to all list/search endpoints:
- `listAssets()`
- `listEmployees()`
- `listProjects()`
- etc.

✅ **Data filtering active!**

---

## STEP 6: Test the System

### Test 1: Verify Routes are Protected

```bash
# Try to access WITHOUT permission middleware
curl http://localhost:5001/api/assets \
  -H "Authorization: Bearer invalid_token"

# Expected: 401 Unauthorized
```

### Test 2: Create Test User and Group

```javascript
// In Node REPL or test script
const iamService = require("@/services/iam.service");

// 1. Create user (branch 1)
const user = await iamService.createUser({
  name: "Test User",
  email: "test@example.com",
  username: "testuser",
  password: "hashed_password",
  branchId: 1
});

// 2. Create group (branch 1)
const group = await iamService.createUserGroup({
  name: "Test Team",
  branchId: 1
});

// 3. Add user to group
await iamService.assignUserToGroup(user.id, group.id);

// 4. Get MANAGER role
const managerRole = await prisma.role.findUnique({
  where: { name: "MANAGER" }
});

// 5. Assign role to group
await iamService.assignRoleToGroup(group.id, managerRole.id);

// Now test user has MANAGER permissions!
```

### Test 3: Test API with Permissions

```bash
# 1. Login as admin
curl -X POST http://localhost:5001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@dontblinkstudio.com","password":"Admin@12345"}'

# Response: { token: "eyJh..." }

# 2. Get assets (should work - admin has all permissions)
curl http://localhost:5001/api/assets?branchId=1 \
  -H "Authorization: Bearer {token}"

# Response: 200 OK + [assets]

# 3. Try branch 2 (admin might be restricted)
curl http://localhost:5001/api/assets?branchId=2 \
  -H "Authorization: Bearer {token}"

# Response: 403 Forbidden (if admin is in branch 1)
# OR 200 OK + [assets] (if admin is super admin)
```

✅ **System is working!**

---

## STEP 7: Verify in Database

```bash
npm run prisma:studio
```

Check:
1. `user` table → admin user has `branch_id` = NULL (super admin)
2. `role` table → See 5 roles
3. `permission` table → See 13 permissions
4. `role_permission` → See assignments

✅ **All tables populated!**

---

## 📋 Checklist

- [ ] Step 1: Database migration completed
- [ ] Step 2: Seed data created
- [ ] Step 3: Verified in Prisma Studio
- [ ] Step 4: Updated Assets routes
- [ ] Step 4: Updated HRM routes
- [ ] Step 4: Updated Sales routes
- [ ] Step 4: Updated Image Selection routes
- [ ] Step 5: Updated controllers with branch filter
- [ ] Step 6: Tested with cURL/Postman
- [ ] Step 7: Verified in Prisma Studio
- [ ] ✅ IAM System is LIVE!

---

## 🎯 What's Working Now

✅ Users have roles via groups  
✅ Roles have permissions  
✅ Permissions have access levels (READ, READ_WRITE, DISABLED)  
✅ Branch access is checked  
✅ Data is automatically filtered by user's branch  
✅ Routes require permissions to access  
✅ 403 Forbidden returned if access denied  
✅ Super Admin bypasses all checks  

---

## 🔄 Workflow After Setup

**User logs in:**
```
1. Verify credentials
2. Generate JWT token
3. Include user permissions in JWT
4. Send to frontend
```

**User makes API request:**
```
1. authMiddleware → Verify JWT + load user data
2. checkBranchAccess → Verify user can access branch
3. checkPermission → Verify user has permission
4. Controller → Query with branch filter
5. Response → Return branch-scoped data
```

---

## 📞 Troubleshooting

### Migration fails
```bash
# Check if Prisma is properly installed
npm list @prisma/cli

# Verify DATABASE_URL in .env
echo $DATABASE_URL

# Try again
npm run prisma:migrate dev
```

### Seed fails
```bash
# Make sure migration ran first
npm run prisma:migrate dev

# Check for duplicates
npm run prisma:studio
# Delete existing roles if needed

# Run seed again
npm run prisma:seed
```

### Permission check not working
```bash
# Verify middleware is added to route
// Check: route has checkPermission()

// Verify user has permission
npm run prisma:studio
// Check: user → group → role → permission

// Check console for errors
// Look for "Permission check failed" in logs
```

---

## 📚 Documentation

- **Complete Guide**: `IAM_IMPLEMENTATION_GUIDE.md`
- **Detailed Explanation**: `IAM_EXPLANATION.md`
- **Implementation Summary**: `IAM_IMPLEMENTATION_SUMMARY.md`
- **This Guide**: `IAM_QUICK_START.md`

---

## ✨ Next Phase (Frontend)

After backend is working, implement:
1. `usePermissions()` hook
2. `<PermissionGuard>` component
3. Permission-based UI rendering
4. Admin panel for user/group/role management

---

## 🎉 You're Ready!

All backend code is ready. Start with Step 1 and work through Step 7.

**Estimated time: 30-45 minutes**

Let me know if you hit any issues! 🚀

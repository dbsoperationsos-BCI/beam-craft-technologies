# Protecting All Module Routes - Complete Guide

**Status:** ✅ Middleware imports added to all route files

Now you need to add permission checks to each endpoint. Follow these patterns:

---

## Module 1: ASSETS

### File: `backend/src/modules/assets/assets.routes.js`
**Status:** ✅ COMPLETE - Already updated with permission middleware

### Controllers to Update

**File:** `backend/src/modules/assets/assets.controller.js`

Add to `listAssets()` function:
```javascript
const branchFilter = await iamService.buildBranchFilter(req.user.id);
const where = { 
  isDeleted: false,
  ...branchFilter,  // Add this line
  // ... rest of filters
};
```

**Same for:** `createAsset()`, `updateAsset()`, `deleteAsset()`

---

## Module 2: HRM (Human Resource Management)

### Files to Update:
1. `backend/src/modules/hrm/payment-requests/routes.js`
2. `backend/src/modules/hrm/master-data/routes.js`

### Pattern for Payment Requests Routes

```javascript
const express = require("express");
const { protect } = require("../../../middleware/authMiddleware");
const { checkBranchAccess, checkPermission } = require("../../../middleware/permissionMiddleware");
const controller = require("./controller");

const router = express.Router();
router.use(protect);

// READ operations
router.get(
  "/",
  checkBranchAccess("branchId"),
  checkPermission("HRM", "Payment Request Approval", "READ"),
  controller.list
);

router.get(
  "/:id",
  checkBranchAccess("branchId"),
  checkPermission("HRM", "Payment Request Approval", "READ"),
  controller.getDetail
);

// WRITE operations
router.post(
  "/",
  checkBranchAccess("branchId"),
  checkPermission("HRM", "Payment Request Approval", "READ_WRITE"),
  controller.create
);

router.put(
  "/:id/approve",
  checkBranchAccess("branchId"),
  checkPermission("HRM", "Payment Request Approval", "READ_WRITE"),
  controller.approve
);

router.put(
  "/:id/reject",
  checkBranchAccess("branchId"),
  checkPermission("HRM", "Payment Request Approval", "READ_WRITE"),
  controller.reject
);

module.exports = router;
```

### Pattern for Master Data Routes

```javascript
router.get(
  "/",
  checkBranchAccess("branchId"),
  checkPermission("HRM", "Employee Management", "READ"),
  controller.list
);

router.post(
  "/",
  checkBranchAccess("branchId"),
  checkPermission("HRM", "Employee Management", "READ_WRITE"),
  controller.create
);

router.put(
  "/:id",
  checkBranchAccess("branchId"),
  checkPermission("HRM", "Employee Management", "READ_WRITE"),
  controller.update
);

router.delete(
  "/:id",
  checkBranchAccess("branchId"),
  checkPermission("HRM", "Employee Management", "READ_WRITE"),
  controller.delete
);
```

---

## Module 3: SALES

### Main Route Files:
- `backend/src/modules/sales/projects/routes.js` (if exists)
- `backend/src/modules/sales/crm-leads/routes.js` (if exists)
- `backend/src/modules/sales/quotations/routes.js` (if exists)

### Pattern for Projects Routes

```javascript
// Project Management
router.get(
  "/",
  checkBranchAccess("branchId"),
  checkPermission("SALES", "Project Management", "READ"),
  controller.list
);

router.post(
  "/",
  checkBranchAccess("branchId"),
  checkPermission("SALES", "Project Management", "READ_WRITE"),
  controller.create
);

router.put(
  "/:id",
  checkBranchAccess("branchId"),
  checkPermission("SALES", "Project Management", "READ_WRITE"),
  controller.update
);

router.delete(
  "/:id",
  checkBranchAccess("branchId"),
  checkPermission("SALES", "Project Management", "READ_WRITE"),
  controller.delete
);
```

### Pattern for CRM Leads Routes

```javascript
// CRM Leads
router.get(
  "/",
  checkBranchAccess("branchId"),
  checkPermission("SALES", "CRM Leads", "READ"),
  controller.list
);

router.post(
  "/",
  checkBranchAccess("branchId"),
  checkPermission("SALES", "CRM Leads", "READ_WRITE"),
  controller.create
);

router.put(
  "/:id/status",
  checkBranchAccess("branchId"),
  checkPermission("SALES", "CRM Leads", "READ_WRITE"),
  controller.updateStatus
);
```

### Pattern for Quotations Routes

```javascript
// Quotation Management
router.get(
  "/",
  checkBranchAccess("branchId"),
  checkPermission("SALES", "Quotation Management", "READ"),
  controller.list
);

router.post(
  "/",
  checkBranchAccess("branchId"),
  checkPermission("SALES", "Quotation Management", "READ_WRITE"),
  controller.create
);

router.put(
  "/:id",
  checkBranchAccess("branchId"),
  checkPermission("SALES", "Quotation Management", "READ_WRITE"),
  controller.update
);

router.delete(
  "/:id",
  checkBranchAccess("branchId"),
  checkPermission("SALES", "Quotation Management", "READ_WRITE"),
  controller.delete
);
```

---

## Module 4: IMAGE_SELECTION

### Files to Update:
- `backend/src/modules/image-selection/publication/routes.js`
- `backend/src/modules/image-selection/folders/routes.js`
- `backend/src/modules/image-selection/deliverables/routes.js`
- `backend/src/modules/image-selection/settings/routes.js`

### Pattern for Publication/Gallery Routes

```javascript
// Project Management (READ)
router.get(
  "/",
  checkBranchAccess("branchId"),
  checkPermission("IMAGE_SELECTION", "Project Management", "READ"),
  controller.list
);

// Project Management (READ_WRITE)
router.post(
  "/",
  checkBranchAccess("branchId"),
  checkPermission("IMAGE_SELECTION", "Project Management", "READ_WRITE"),
  controller.create
);

router.put(
  "/:id",
  checkBranchAccess("branchId"),
  checkPermission("IMAGE_SELECTION", "Project Management", "READ_WRITE"),
  controller.update
);

router.delete(
  "/:id",
  checkBranchAccess("branchId"),
  checkPermission("IMAGE_SELECTION", "Project Management", "READ_WRITE"),
  controller.delete
);
```

### Pattern for Folders/Upload Routes

```javascript
// Upload & Gallery (READ)
router.get(
  "/:projectId/folders",
  checkBranchAccess("branchId"),
  checkPermission("IMAGE_SELECTION", "Upload & Gallery", "READ"),
  controller.listFolders
);

// Upload & Gallery (READ_WRITE)
router.post(
  "/:projectId/folders",
  checkBranchAccess("branchId"),
  checkPermission("IMAGE_SELECTION", "Upload & Gallery", "READ_WRITE"),
  controller.createFolder
);

router.post(
  "/:projectId/upload",
  checkBranchAccess("branchId"),
  checkPermission("IMAGE_SELECTION", "Upload & Gallery", "READ_WRITE"),
  controller.uploadImages
);

router.delete(
  "/:folderId",
  checkBranchAccess("branchId"),
  checkPermission("IMAGE_SELECTION", "Upload & Gallery", "READ_WRITE"),
  controller.deleteFolder
);
```

---

## Module 5: ACCOUNTS

### File: `backend/src/modules/accounts/cash-entries/routes.js`

```javascript
// Payment/Cash Entry Management
router.get(
  "/",
  checkBranchAccess("branchId"),
  checkPermission("ADMIN", "System Settings", "READ"),  // Or create ACCOUNTS:Cash Management
  controller.list
);

router.post(
  "/",
  checkBranchAccess("branchId"),
  checkPermission("ADMIN", "System Settings", "READ_WRITE"),
  controller.create
);

router.put(
  "/:id",
  checkBranchAccess("branchId"),
  checkPermission("ADMIN", "System Settings", "READ_WRITE"),
  controller.update
);
```

---

## Step-by-Step Implementation

### 1️⃣ Update Assets Module (Already Done)
- ✅ Routes: `assets.routes.js`
- ⏳ Controllers: Add `buildBranchFilter()` to list/create/update functions

### 2️⃣ Update HRM Module
- Routes: `payment-requests/routes.js`, `master-data/routes.js`
- Controllers: Add branch filtering to all query operations

### 3️⃣ Update SALES Module
- Routes: All project/lead/quotation routes
- Controllers: Add branch filtering

### 4️⃣ Update IMAGE_SELECTION Module
- Routes: Publication, folders, deliverables
- Controllers: Add branch filtering

### 5️⃣ Update ACCOUNTS Module
- Routes: Cash entries
- Controllers: Add branch filtering

---

## Controller Template

Every controller query should look like this:

```javascript
const iamService = require("../../../services/iam.service");

async function listSomething(req, res) {
  try {
    // Add branch filter
    const branchFilter = await iamService.buildBranchFilter(req.user.id);
    
    const data = await prisma.yourModel.findMany({
      where: {
        ...branchFilter,  // ALWAYS include this
        isDeleted: false,
        // ... other filters
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit
    });

    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}
```

---

## Testing Each Module

After updating each module's routes and controllers:

```bash
# Login and get token
TOKEN="your_admin_token"

# Test READ (should work)
curl -X GET "http://localhost:5001/api/module?branchId=1" \
  -H "Authorization: Bearer $TOKEN"

# Test READ_WRITE (should work for admin)
curl -X POST "http://localhost:5001/api/module" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Test", "branchId": 1}'

# Test with limited user (should fail)
curl -X POST "http://localhost:5001/api/module" \
  -H "Authorization: Bearer $LIMITED_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Test", "branchId": 1}'
# Expected: 403 Forbidden
```

---

## Progress Tracking

- [x] Assets routes protected
- [ ] Assets controllers updated
- [ ] HRM routes protected
- [ ] HRM controllers updated
- [ ] Sales routes protected
- [ ] Sales controllers updated
- [ ] Image Selection routes protected
- [ ] Image Selection controllers updated
- [ ] Accounts routes protected
- [ ] Accounts controllers updated
- [ ] All modules tested

---

## Quick Commands

```bash
# Find all route files that need updating
find backend/src/modules -name "*routes.js" | grep -v example

# Find all controller files that need branch filtering
find backend/src/modules -name "*controller.js"

# Test everything works
npm test
```

---

**Estimated Time:** 2-3 hours for complete protection of all modules


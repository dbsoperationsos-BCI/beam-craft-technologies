# Route Protection - Quick Reference Card

## Copy-Paste Templates by Module

---

## 🏗️ ASSETS Module

**Feature:** ASSET:Asset Management | ASSET:Asset Inspection | ASSET:Asset Assignment

```javascript
// ❌ BEFORE
router.get("/", protect, controller.listAssets);
router.post("/", protect, controller.createAsset);

// ✅ AFTER
router.get(
  "/",
  protect,
  checkBranchAccess("branchId"),
  checkPermission("ASSET", "Asset Management", "READ"),
  controller.listAssets
);

router.post(
  "/",
  protect,
  checkBranchAccess("branchId"),
  checkPermission("ASSET", "Asset Management", "READ_WRITE"),
  controller.createAsset
);
```

---

## 👥 HRM Module

**Features:** HRM:Employee Management | HRM:Payment Request Approval | HRM:Payroll Management

```javascript
// Payment Requests - READ
router.get(
  "/",
  protect,
  checkBranchAccess("branchId"),
  checkPermission("HRM", "Payment Request Approval", "READ"),
  controller.list
);

// Payment Requests - WRITE
router.post(
  "/",
  protect,
  checkBranchAccess("branchId"),
  checkPermission("HRM", "Payment Request Approval", "READ_WRITE"),
  controller.create
);

router.put(
  "/:id/approve",
  protect,
  checkBranchAccess("branchId"),
  checkPermission("HRM", "Payment Request Approval", "READ_WRITE"),
  controller.approve
);
```

---

## 💼 SALES Module

**Features:** SALES:Project Management | SALES:CRM Leads | SALES:Quotation Management

```javascript
// Projects - READ
router.get(
  "/",
  protect,
  checkBranchAccess("branchId"),
  checkPermission("SALES", "Project Management", "READ"),
  controller.list
);

// Projects - WRITE
router.post(
  "/",
  protect,
  checkBranchAccess("branchId"),
  checkPermission("SALES", "Project Management", "READ_WRITE"),
  controller.create
);

// CRM Leads - READ
router.get(
  "/leads",
  protect,
  checkBranchAccess("branchId"),
  checkPermission("SALES", "CRM Leads", "READ"),
  controller.listLeads
);

// CRM Leads - WRITE
router.post(
  "/leads",
  protect,
  checkBranchAccess("branchId"),
  checkPermission("SALES", "CRM Leads", "READ_WRITE"),
  controller.createLead
);

// Quotations - READ
router.get(
  "/quotations",
  protect,
  checkBranchAccess("branchId"),
  checkPermission("SALES", "Quotation Management", "READ"),
  controller.listQuotations
);

// Quotations - WRITE
router.post(
  "/quotations",
  protect,
  checkBranchAccess("branchId"),
  checkPermission("SALES", "Quotation Management", "READ_WRITE"),
  controller.createQuotation
);
```

---

## 📸 IMAGE_SELECTION Module

**Features:** IMAGE_SELECTION:Project Management | IMAGE_SELECTION:Upload & Gallery

```javascript
// Project Management - READ
router.get(
  "/",
  protect,
  checkBranchAccess("branchId"),
  checkPermission("IMAGE_SELECTION", "Project Management", "READ"),
  controller.list
);

// Project Management - WRITE
router.post(
  "/",
  protect,
  checkBranchAccess("branchId"),
  checkPermission("IMAGE_SELECTION", "Project Management", "READ_WRITE"),
  controller.create
);

router.put(
  "/:id",
  protect,
  checkBranchAccess("branchId"),
  checkPermission("IMAGE_SELECTION", "Project Management", "READ_WRITE"),
  controller.update
);

// Upload & Gallery - READ
router.get(
  "/:id/folders",
  protect,
  checkBranchAccess("branchId"),
  checkPermission("IMAGE_SELECTION", "Upload & Gallery", "READ"),
  controller.listFolders
);

// Upload & Gallery - WRITE
router.post(
  "/:id/upload",
  protect,
  checkBranchAccess("branchId"),
  checkPermission("IMAGE_SELECTION", "Upload & Gallery", "READ_WRITE"),
  controller.upload
);

router.post(
  "/:id/folders",
  protect,
  checkBranchAccess("branchId"),
  checkPermission("IMAGE_SELECTION", "Upload & Gallery", "READ_WRITE"),
  controller.createFolder
);
```

---

## 💰 ACCOUNTS Module

**Features:** ADMIN:System Settings (or create ACCOUNTS:Cash Management)

```javascript
router.get(
  "/",
  protect,
  checkBranchAccess("branchId"),
  checkPermission("ADMIN", "System Settings", "READ"),
  controller.list
);

router.post(
  "/",
  protect,
  checkBranchAccess("branchId"),
  checkPermission("ADMIN", "System Settings", "READ_WRITE"),
  controller.create
);

router.put(
  "/:id",
  protect,
  checkBranchAccess("branchId"),
  checkPermission("ADMIN", "System Settings", "READ_WRITE"),
  controller.update
);
```

---

## Controller Template

Add to EVERY controller file:

```javascript
// At the top of the file
const iamService = require("../../../services/iam.service");

// In every list/get function
async listSomething(req, res) {
  try {
    const branchFilter = await iamService.buildBranchFilter(req.user.id);
    
    const data = await prisma.model.findMany({
      where: {
        ...branchFilter,  // ← ADD THIS
        isDeleted: false,
        // ... other filters
      }
    });

    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}
```

---

## What Each Middleware Does

| Middleware | Purpose | Example |
|-----------|---------|---------|
| `protect` | Requires valid JWT token | Prevents unauthenticated access |
| `checkBranchAccess("branchId")` | Validates user can access branch | Prevents cross-branch access |
| `checkPermission("MODULE", "Feature", "READ")` | Allows READ operations | GET, view-only actions |
| `checkPermission("MODULE", "Feature", "READ_WRITE")` | Allows create/update/delete | POST, PUT, DELETE operations |

---

## Permission Levels

```
READ       = GET operations (list, view)
READ_WRITE = All operations (GET, POST, PUT, DELETE, PATCH)
DISABLED   = No access (403 Forbidden)
```

---

## Quick Checklist

For each route file:

- [ ] Add import: `const { checkBranchAccess, checkPermission } = ...`
- [ ] Add `checkBranchAccess("branchId")` to ALL routes
- [ ] Add `checkPermission(...)` with correct module/feature/level
- [ ] Update controllers to use `buildBranchFilter()`
- [ ] Test with admin token
- [ ] Test with limited user token

---

## Test Commands

```bash
# Test permission works
curl -X GET "http://localhost:5001/api/assets?branchId=1" \
  -H "Authorization: Bearer $TOKEN"
# Expected: 200 ✅

# Test permission denied
curl -X POST "http://localhost:5001/api/assets" \
  -H "Authorization: Bearer $LIMITED_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"test","branchId":1}'
# Expected: 403 ❌

# Test missing branch
curl -X GET "http://localhost:5001/api/assets" \
  -H "Authorization: Bearer $TOKEN"
# Expected: 400 (branch required) ❌
```

---

**Ready? Start with Assets module first, then work through the rest!**


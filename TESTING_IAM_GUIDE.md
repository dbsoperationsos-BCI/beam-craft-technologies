# IAM Permission Testing Guide

## Overview
Complete guide to testing the IAM permission middleware and services.

---

## Quick Start - Run All Tests

```bash
cd backend
npm test
```

Expected output:
```
✓ Permission: Super Admin has all permissions
✓ Permission: User inherits permissions from group role
✓ Permission: Manager cannot write to admin-only features
✓ Permission: READ permission satisfies READ level
✓ Permission: DISABLED access denies all
✓ Branch Access: User can access their own branch
✓ Branch Access: User cannot access other branches
✓ Branch Access: Super Admin can access all branches
✓ Branch Filter: Super Admin gets no filter
✓ Branch Filter: Regular user gets their branch
✓ User Management: Create user with branch
✓ User Management: Assign user to group in same branch
✓ User Management: Cannot assign user to group in different branch
✓ Group Management: Create group with branch
✓ Integration: Complete permission flow
✓ Integration: Cross-branch isolation

16 tests completed successfully
```

---

## Manual Testing with cURL

### Setup

1. **Start your backend**
```bash
npm run dev
```

2. **Get admin JWT token**
```bash
curl -X POST http://localhost:5001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@dontblinkstudio.com",
    "password": "Admin@12345"
  }'
```

Response:
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": { "id": 1, "name": "admin", "email": "..." }
}
```

3. **Save token for testing**
```bash
TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

---

## Test Scenarios

### Test 1: Permission Allowed (200 OK)

**User has READ permission** → Can list resources

```bash
curl -X GET "http://localhost:5001/api/assets?branchId=1" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json"
```

Expected: **200 OK**
```json
{
  "success": true,
  "data": [
    { "id": 1, "name": "Camera", "branchId": 1 },
    { "id": 2, "name": "Lens", "branchId": 1 }
  ]
}
```

**What tested:**
- ✅ JWT authentication works
- ✅ Permission check passes for READ
- ✅ Branch filtering works
- ✅ Only returns data from user's branch

---

### Test 2: Permission Denied (403 Forbidden)

**User lacks permission** → Cannot create resource

```bash
# Create test user with STAFF role (limited permissions)
curl -X POST http://localhost:5001/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test Staff",
    "email": "staff@test.com",
    "password": "Pass1234",
    "role": "STAFF"
  }'

# Get their token
curl -X POST http://localhost:5001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "staff@test.com", "password": "Pass1234"}'

# Save token
STAFF_TOKEN="..."

# Try to create asset (STAFF cannot do this)
curl -X POST http://localhost:5001/api/assets \
  -H "Authorization: Bearer $STAFF_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "New Camera",
    "branchId": 1
  }'
```

Expected: **403 Forbidden**
```json
{
  "message": "You don't have READ_WRITE permission for ASSET:Asset Management"
}
```

**What tested:**
- ✅ Permission middleware blocks unauthorized access
- ✅ Correct error message
- ✅ Resource not created

---

### Test 3: Branch Access Denied (403 Forbidden)

**User tries to access different branch** → Access denied

```bash
# User in Branch 1 tries to access Branch 2
curl -X GET "http://localhost:5001/api/assets?branchId=2" \
  -H "Authorization: Bearer $BRANCH1_TOKEN" \
  -H "Content-Type: application/json"
```

Expected: **403 Forbidden**
```json
{
  "message": "You cannot access this branch"
}
```

**What tested:**
- ✅ Branch access check works
- ✅ Users restricted to their branch
- ✅ Correct error message

---

### Test 4: Super Admin Bypass

**Super Admin can access all branches**

```bash
# Admin account is usually super admin
curl -X GET "http://localhost:5001/api/assets?branchId=2" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json"
```

Expected: **200 OK** (if admin is super admin)
```json
{
  "success": true,
  "data": [
    { "id": 1, "name": "Monitor", "branchId": 2 },
    { "id": 2, "name": "Keyboard", "branchId": 2 }
  ]
}
```

**What tested:**
- ✅ Super admin bypasses branch restrictions
- ✅ Can see data from any branch
- ✅ No 403 error

---

### Test 5: Permission Levels (READ vs READ_WRITE)

**User with READ permission cannot write**

```bash
# User has READ permission on Assets
# Try to create (requires READ_WRITE)

curl -X POST http://localhost:5001/api/assets \
  -H "Authorization: Bearer $READ_ONLY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "New Asset", "branchId": 1}'
```

Expected: **403 Forbidden**
```json
{
  "message": "You don't have READ_WRITE permission for ASSET:Asset Management"
}
```

**User with READ_WRITE can do both**

```bash
# User has READ_WRITE permission
# Can create (READ_WRITE covers this)

curl -X POST http://localhost:5001/api/assets \
  -H "Authorization: Bearer $READ_WRITE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "New Asset", "branchId": 1}'
```

Expected: **200 OK** (or 201 Created)
```json
{
  "success": true,
  "data": { "id": 123, "name": "New Asset", "branchId": 1 }
}
```

**What tested:**
- ✅ READ permission allows GET only
- ✅ READ_WRITE permission allows GET and POST
- ✅ Permission levels enforced correctly

---

### Test 6: Data Filtering by Branch

**Verify data is filtered by user's branch**

```bash
# Create 2 branches
# Create assets in each
# User in Branch 1 lists assets

curl -X GET "http://localhost:5001/api/assets?branchId=1" \
  -H "Authorization: Bearer $BRANCH1_TOKEN"
```

Response shows **only branch 1 assets**:
```json
{
  "success": true,
  "data": [
    { "id": 1, "name": "Camera", "branchId": 1 },
    { "id": 2, "name": "Lens", "branchId": 1 }
  ]
}
```

**Not in response:** Branch 2 assets
- Assets with `branchId: 2` are excluded
- Even if user somehow bypassed permission check

**What tested:**
- ✅ buildBranchFilter() adds WHERE clause
- ✅ Data isolation at database level
- ✅ Even admin queries filtered by branch

---

### Test 7: Multiple Modules/Features

**Different modules have different permissions**

```bash
# Test ASSET module
curl -X GET http://localhost:5001/api/assets \
  -H "Authorization: Bearer $MANAGER_TOKEN"
# Expected: 200 OK (Manager has READ permission)

# Test HRM module
curl -X GET http://localhost:5001/api/employees \
  -H "Authorization: Bearer $MANAGER_TOKEN"
# Expected: 200 OK (Manager has READ permission)

# Test ADMIN module
curl -X GET http://localhost:5001/api/admin/users \
  -H "Authorization: Bearer $MANAGER_TOKEN"
# Expected: 403 Forbidden (Manager NO permission)
```

**What tested:**
- ✅ Different permissions per module
- ✅ Permission matrix applies correctly
- ✅ Feature-level granularity

---

## Test Cases Summary

| Test | Scenario | Expected |
|------|----------|----------|
| **Permission Allowed** | User has permission | 200 OK |
| **Permission Denied** | User lacks permission | 403 Forbidden |
| **Branch Allowed** | User's branch | 200 OK |
| **Branch Denied** | Different branch | 403 Forbidden |
| **READ Permission** | List/view data | 200 OK |
| **READ_WRITE Required** | Create/update data | 403 if only READ |
| **Data Filtering** | List assets | Only their branch returned |
| **Super Admin** | Access all branches | 200 OK for all branches |
| **Permission Levels** | READ vs READ_WRITE | Both checked separately |
| **Module Isolation** | Different modules | Separate permissions |

---

## Automated Test Execution

### Run Specific Test Suite

```bash
# Run only permission tests
npm test -- --grep "Permission"

# Run only branch access tests
npm test -- --grep "Branch"

# Run only integration tests
npm test -- --grep "Integration"
```

### Expected Output

```
Permission: Super Admin has all permissions
✓ Passed (2ms)

Permission: User inherits permissions from group role
✓ Passed (15ms)

Permission: Manager cannot write to admin-only features
✓ Passed (12ms)

... (13 more tests)

Total: 16 passed, 0 failed (124ms)
```

---

## Debugging Failed Tests

If a test fails:

### 1. Check the error message

```bash
npm test -- --grep "Permission: Super Admin"
```

Look for:
- `AssertionError`: Expected vs actual values
- `TypeError`: Method not found or wrong type
- `Error`: Permission check failed

### 2. Enable verbose logging

```bash
DEBUG=* npm test
```

Shows detailed logs from IAM service

### 3. Check test setup

Database must have:
- Roles: SUPER_ADMIN, ADMIN, MANAGER, STAFF
- Permissions: 13 defined
- Test users created properly

Verify:
```bash
npm run prisma:studio
# Check role, permission tables
```

### 4. Debug IAM service

Add console.log to `iam.service.js`:

```javascript
async hasPermission(userId, module, feature, level) {
  const permissions = await this.getUserPermissions(userId);
  console.log("User permissions:", permissions); // DEBUG
  ...
}
```

Re-run test:
```bash
npm test
```

Check console output

---

## Integration Testing via Postman

### 1. Import Collection

Create Postman collection with these requests:

**Login**
```
POST http://localhost:5001/api/auth/login
Body: {"email": "admin@...", "password": "..."}
```

**List Assets**
```
GET http://localhost:5001/api/assets?branchId=1
Headers: Authorization: Bearer {{token}}
```

**Create Asset**
```
POST http://localhost:5001/api/assets
Headers: Authorization: Bearer {{token}}
Body: {"name": "Test", "branchId": 1}
```

**List Employees**
```
GET http://localhost:5001/api/employees?branchId=1
Headers: Authorization: Bearer {{token}}
```

**Access Different Branch**
```
GET http://localhost:5001/api/assets?branchId=2
Headers: Authorization: Bearer {{token}}
(Should get 403 if user in branch 1)
```

### 2. Run Collection

Use Postman's "Run Collection" feature to:
- Execute all requests in order
- Verify responses (200 OK, 403 Forbidden, etc.)
- Check response times
- See all headers and body

### 3. Create Test Script

Postman pre-request script:

```javascript
// Save token for other requests
if (pm.response.code === 200) {
  const token = pm.response.json().token;
  pm.environment.set("token", token);
}
```

---

## Performance Testing

### Measure permission check time

```bash
# Add timing to iam.service.js
console.time("hasPermission");
const result = await this.hasPermission(userId, module, feature, level);
console.timeEnd("hasPermission");
```

Expected: **<50ms** for permission check

If slower, optimize queries:
- Add database indexes
- Cache permission lookups
- Reduce nested includes

---

## Security Testing

### Test 1: JWT Validation
```bash
# Invalid token
curl http://localhost:5001/api/assets \
  -H "Authorization: Bearer invalid_token"
# Expected: 401 Unauthorized
```

### Test 2: No Branch Bypass
```bash
# Try to access branch 2 without permission
curl "http://localhost:5001/api/assets?branchId=2" \
  -H "Authorization: Bearer $BRANCH1_TOKEN"
# Expected: 403 Forbidden (even with valid token)
```

### Test 3: Permission Escalation
```bash
# STAFF user tries to access ADMIN features
curl http://localhost:5001/api/admin/users \
  -H "Authorization: Bearer $STAFF_TOKEN"
# Expected: 403 Forbidden
```

---

## Summary

**Testing covers:**
- ✅ Permission middleware functionality
- ✅ Branch isolation
- ✅ Permission levels (READ, READ_WRITE, DISABLED)
- ✅ User group inheritance
- ✅ Role hierarchy
- ✅ Data filtering
- ✅ Error handling
- ✅ Security boundaries

**All tests should pass after Phase 1 deployment.**

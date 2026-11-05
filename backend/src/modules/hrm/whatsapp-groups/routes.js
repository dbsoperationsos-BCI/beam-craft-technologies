const express = require("express");
const { protect } = require("../../../middleware/authMiddleware");
const { requireModule } = require("../../../middleware/permissionMiddleware");
const controller = require("./controller");

/**
 * /api/hrm/whatsapp-groups - the studio's employee WhatsApp groups, and adding an employee to them.
 * `HRM / Employee Management` on the whole router: GET needs Read, everything else Read / Write.
 */
const router = express.Router();
router.use(protect);
router.use(requireModule("HRM", "Employee Management"));

// Above `/:id` routes and before the list, so "departments" is never read as a group id.
router.get("/departments", controller.listDepartments);
/*
 * One row per department with the groups it claims, which is how Settings reads them, plus adding a
 * group to a department and taking one out again. Above the `/:id` routes, so "departments" is never
 * read as a group id.
 */
router.get("/department-groups", controller.listDepartmentGroups);
router.post("/departments/:departmentId/groups", controller.addGroupToDepartment);
router.delete("/departments/:departmentId/groups/:groupId", controller.removeGroupFromDepartment);
router.get("/", controller.listGroups);
router.post("/", controller.addGroup);
router.delete("/:id", controller.removeGroup);
// Which departments a group serves, replaced as a whole - what the multi-select means by saving.
router.put("/:id/departments", controller.setGroupDepartments);
router.get("/employees/:employeeId", controller.employeeGroups);
router.post("/employees/:employeeId", controller.addEmployee);
/*
 * Out of every group, by hand - for somebody marked inactive without a separation, whom no exit will
 * ever clean up. Behind the same `HRM / Employee Management` guard the router mounts: putting people
 * into the studio's groups and taking them out is one job.
 */
router.delete("/employees/:employeeId", controller.removeEmployeeFromGroups);

module.exports = router;

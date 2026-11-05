export const masterDataModules = {
  departments: { label: "Departments", singular: "Department", fields: ["code", "name", "description", "parentDepartmentId"] },
  designations: { label: "Designations", singular: "Designation", fields: ["code", "name", "description"] },
  "employment-types": { label: "Employment Types", singular: "Employment Type", fields: ["code", "name", "description"] },
  locations: { label: "Locations", singular: "Location", fields: ["code", "name", "address", "description"] },
  skills: { label: "Skills", singular: "Skill", fields: ["code", "name", "description"] },
  verticals: { label: "Verticals", singular: "Vertical", fields: ["code", "name", "description"] },
  languages: { label: "Languages", singular: "Language", fields: ["code", "name", "description"] },
  "work-types": { label: "Work Types", singular: "Work Type", fields: ["code", "name", "description"] },
  "employee-statuses": { label: "Employee Statuses", singular: "Employee Status", fields: ["code", "name", "color", "sortOrder", "description"] },
};

export const fieldLabels = { code: "Code", name: "Name", description: "Description", address: "Address", color: "Colour", sortOrder: "Display order", parentDepartmentId: "Parent department ID" };

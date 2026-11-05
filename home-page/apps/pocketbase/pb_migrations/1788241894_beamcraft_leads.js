/// <reference path="../pb_data/types.d.ts" />

migrate(
  (app) => {
    let collection;
    try {
      collection = app.findCollectionByNameOrId("leads");
    } catch (_) {
      collection = new Collection({
        type: "base",
        name: "leads",
        // Public form submissions; only BeamCraft admins can read/manage.
        listRule: "@request.auth.role = 'admin'",
        viewRule: "@request.auth.role = 'admin'",
        createRule: "",
        updateRule: "@request.auth.role = 'admin'",
        deleteRule: "@request.auth.role = 'admin'",
        fields: [
          {
            name: "type",
            type: "select",
            required: true,
            maxSelect: 1,
            values: ["demo", "quote", "enterprise"],
          },
          { name: "name", type: "text", required: true, max: 120 },
          { name: "email", type: "email", required: true },
          { name: "company", type: "text", required: true, max: 120 },
          { name: "message", type: "text", max: 5000 },
          { name: "preferred_time", type: "text", max: 120 },
          {
            name: "status",
            type: "select",
            maxSelect: 1,
            values: ["new", "contacted", "closed"],
          },
          { name: "created", type: "autodate", onCreate: true, onUpdate: false },
          { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
        ],
        indexes: ["CREATE INDEX idx_leads_status ON leads (status)"],
      });
      app.save(collection);
    }
  },
  (app) => {
    try {
      const collection = app.findCollectionByNameOrId("leads");
      app.delete(collection);
    } catch (e) {
      if (!e.message.includes("no rows in result set")) throw e;
    }
  },
);

/// <reference path="../pb_data/types.d.ts" />

migrate(
  (app) => {
    try {
      app.findCollectionByNameOrId("usage_snapshots");
    } catch (_) {
      const users = app.findCollectionByNameOrId("users");
      const collection = new Collection({
        type: "base",
        name: "usage_snapshots",
        listRule: "@request.auth.id != '' && @request.auth.id = owner",
        viewRule: "@request.auth.id != '' && @request.auth.id = owner",
        createRule: null,
        updateRule: null,
        deleteRule: null,
        fields: [
          { name: "month", type: "text", required: true, max: 20 },
          { name: "operations", type: "number", min: 0 },
          { name: "automations", type: "number", min: 0 },
          { name: "active_apps", type: "number", min: 0 },
          {
            name: "owner",
            type: "relation",
            required: true,
            maxSelect: 1,
            collectionId: users.id,
            cascadeDelete: true,
          },
          { name: "created", type: "autodate", onCreate: true, onUpdate: false },
          { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
        ],
        indexes: ["CREATE INDEX idx_usage_owner ON usage_snapshots (owner)"],
      });
      app.save(collection);
    }
  },
  (app) => {
    try {
      const collection = app.findCollectionByNameOrId("usage_snapshots");
      app.delete(collection);
    } catch (e) {
      if (!e.message.includes("no rows in result set")) throw e;
    }
  },
);

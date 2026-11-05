/// <reference path="../pb_data/types.d.ts" />

migrate(
  (app) => {
    const users = app.findCollectionByNameOrId("users");

    if (!users.fields.getByName("role")) {
      users.fields.add(
        new SelectField({
          name: "role",
          maxSelect: 1,
          values: ["member", "admin"],
        }),
      );
    }
    if (!users.fields.getByName("plan")) {
      users.fields.add(
        new SelectField({
          name: "plan",
          maxSelect: 1,
          values: ["trial", "growth", "enterprise"],
        }),
      );
    }
    if (!users.fields.getByName("company")) {
      users.fields.add(new TextField({ name: "company", max: 120 }));
    }

    // Public self-serve sign-up (free trial funnel — explicitly requested).
    users.createRule = "";
    users.listRule = "id = @request.auth.id";
    users.viewRule = "id = @request.auth.id";
    users.updateRule = "id = @request.auth.id";
    users.deleteRule = null;

    const pw = users.fields.getByName("password");
    pw.min = Math.max(pw.min || 0, 10);

    app.save(users);

    // Seed the team admin account (server-side seed; credentials shared in chat only).
    try {
      app.findAuthRecordByEmail("users", "admin@beamcraft.tech");
    } catch (_) {
      const admin = new Record(users);
      admin.setEmail("admin@beamcraft.tech");
      admin.setPassword("BC-Admin-7f3K9xQ2mZ!p");
      admin.set("name", "BeamCraft Team");
      admin.set("role", "admin");
      admin.set("plan", "enterprise");
      admin.set("company", "BeamCraft");
      admin.set("verified", true);
      app.save(admin);
    }
  },
  (app) => {
    try {
      const admin = app.findAuthRecordByEmail("users", "admin@beamcraft.tech");
      app.delete(admin);
    } catch (e) {
      if (!e.message.includes("no rows in result set")) throw e;
    }
  },
);

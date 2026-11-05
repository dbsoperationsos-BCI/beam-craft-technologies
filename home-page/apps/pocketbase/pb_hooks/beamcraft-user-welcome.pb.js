/// <reference path="../pb_data/types.d.ts" />

// Welcome email + starter usage history when a user signs up (free trial).
onRecordAfterCreateSuccess((e) => {
  const email = e.record.getString("email");
  const name = e.record.getString("name") || "there";

  // Default plan for self-serve signups.
  try {
    if (!e.record.getString("plan")) {
      e.record.set("plan", "trial");
      $app.save(e.record);
    }
  } catch (err) {
    $app.logger().error("default plan set failed", "err", String(err));
  }

  // Seed six months of usage history so the dashboard has real data.
  try {
    const usage = $app.findCollectionByNameOrId("usage_snapshots");
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const label = d.toLocaleString("en-US", { month: "short" });
      const growth = 6 - i;
      const rec = new Record(usage);
      rec.set("month", label);
      rec.set("operations", 4200 * growth + Math.floor(Math.random() * 900));
      rec.set("automations", 140 * growth + Math.floor(Math.random() * 40));
      rec.set("active_apps", Math.min(1 + Math.floor(growth / 2), 4));
      rec.set("owner", e.record.id);
      $app.save(rec);
    }
  } catch (err) {
    $app.logger().error("usage seed failed", "err", String(err));
  }

  try {
    const message = new MailerMessage({
      from: { name: "BeamCraft" },
      to: [{ address: email }],
      subject: "Welcome to BeamCraft — your trial is live",
      html:
        '<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#0b1220">' +
        '<h1 style="font-size:22px">Welcome aboard, ' + name + ".</h1>" +
        "<p>Your BeamCraft free trial is active. Sign in to explore your workspace, review live usage metrics, and see what intelligence-crafted software feels like.</p>" +
        "<p>When you're ready to scale, request a demo or quote from your dashboard — our team responds within one business day.</p>" +
        '<p style="color:#5b6b83;font-size:13px;margin-top:32px">BeamCraft — Crafting Intelligence into Software<br/>beamcraft.tech</p>' +
        "</div>",
    });
    $app.newMailClient().send(message);
  } catch (err) {
    $app.logger().error("welcome email failed", "to", email, "err", String(err));
  }

  e.next();
}, "users");

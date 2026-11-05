/// <reference path="../pb_data/types.d.ts" />

// Confirmation email after a demo / quote / enterprise request.
onRecordAfterCreateSuccess((e) => {
  const name = e.record.getString("name") || "there";
  const email = e.record.getString("email");
  const type = e.record.getString("type");
  const company = e.record.getString("company") || "";

  const subjects = {
    demo: "Your BeamCraft demo request is confirmed",
    quote: "Your BeamCraft quote request is confirmed",
    enterprise: "Your BeamCraft enterprise inquiry is confirmed",
  };
  const lines = {
    demo: "Our solutions team will reach out within one business day to schedule your personalized walkthrough.",
    quote: "Our solutions team is reviewing your project details and will send a tailored quote within two business days.",
    enterprise: "A dedicated solutions engineer will contact you within one business day to discuss your enterprise requirements.",
  };

  try {
    const message = new MailerMessage({
      from: { name: "BeamCraft" },
      to: [{ address: email }],
      subject: subjects[type] || subjects.demo,
      html:
        '<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#0b1220">' +
        '<h1 style="font-size:22px">Thanks, ' + name + " — we've got your request.</h1>" +
        "<p>" + (lines[type] || lines.demo) + "</p>" +
        (company ? "<p><strong>Company:</strong> " + company + "</p>" : "") +
        '<p style="color:#5b6b83;font-size:13px;margin-top:32px">BeamCraft — Crafting Intelligence into Software<br/>beamcraft.tech</p>' +
        "</div>",
    });
    $app.newMailClient().send(message);
  } catch (err) {
    $app.logger().error("lead confirmation email failed", "to", email, "err", String(err));
  }

  e.next();
}, "leads");

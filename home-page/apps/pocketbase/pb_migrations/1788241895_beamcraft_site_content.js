/// <reference path="../pb_data/types.d.ts" />

const DEFAULT_CONTENT = [
  {
    key: "hero",
    label: "Hero section",
    value: {
      eyebrow: "Customized next-gen applications",
      title: "Crafting Intelligence into Software",
      subtitle:
        "BeamCraft designs and builds tailored AI-native applications for executive teams — turning operational complexity into software that thinks ahead, so CEOs and Operations Directors can move faster with confidence.",
      primaryCta: "Start Free Trial",
      secondaryCta: "Request Demo / Quote",
    },
  },
  {
    key: "stats",
    label: "Metrics band",
    value: [
      { value: 140, suffix: "+", label: "Custom applications delivered" },
      { value: 99.9, suffix: "%", label: "Platform uptime, trailing 12 months", decimals: 1 },
      { value: 32, suffix: "%", label: "Average operational cost reduction" },
      { value: 18, suffix: " days", label: "Median time from brief to launch" },
    ],
  },
  {
    key: "features",
    label: "Features",
    value: [
      {
        title: "Intelligence built in, not bolted on",
        description:
          "Every BeamCraft application ships with decision-grade AI at its core — forecasting, anomaly detection, and recommendations tuned to your operating model.",
      },
      {
        title: "Crafted around your workflows",
        description:
          "No forced templates. We map how your teams actually work, then craft software that fits — from board-level dashboards to floor-level automation.",
      },
      {
        title: "Executive visibility, real time",
        description:
          "Live operational metrics, usage analytics, and cost transparency give leadership a single source of truth across every deployment.",
      },
      {
        title: "Usage-based economics",
        description:
          "Pay for what you run, not seats you don't use. Scale up for peak season, scale down when you're done — your invoice follows your reality.",
      },
      {
        title: "Enterprise-grade by default",
        description:
          "SSO, audit trails, role-based access, and data residency options come standard on enterprise engagements — security review friendly.",
      },
      {
        title: "A partner, not a vendor",
        description:
          "Dedicated solutions engineers stay with you after launch, iterating on your application as your strategy evolves.",
      },
    ],
  },
  {
    key: "steps",
    label: "How it works",
    value: [
      {
        title: "Discover",
        description:
          "A working session with your leadership team to map the operational bottleneck worth solving first — and the metric that proves it worked.",
      },
      {
        title: "Craft",
        description:
          "Our engineers build your application in weekly increments. You review working software every Friday, not slideware every quarter.",
      },
      {
        title: "Scale",
        description:
          "Launch to your teams with usage-based pricing that grows only when your usage does. Expand to the next workflow when you're ready.",
      },
    ],
  },
  {
    key: "pricing",
    label: "Pricing tiers",
    value: [
      {
        name: "Trial",
        price: "Free",
        period: "14 days",
        description: "Self-serve evaluation of the BeamCraft platform with a sample workspace.",
        features: ["Full platform access for 14 days", "Sample data workspace", "Community support", "No credit card required"],
        cta: "Start Free Trial",
        highlighted: false,
      },
      {
        name: "Growth",
        price: "Usage-based",
        period: "from $0.004 / operation",
        description: "For teams running live applications. Your bill tracks your actual usage.",
        features: ["Everything in Trial", "Unlimited applications", "Real-time usage analytics", "Priority support", "Monthly usage reports"],
        cta: "Start Free Trial",
        highlighted: true,
      },
      {
        name: "Enterprise",
        price: "Custom",
        period: "annual agreement",
        description: "Custom-built applications, dedicated engineering, and procurement-ready terms.",
        features: ["Dedicated solutions engineer", "SSO, audit logs, data residency", "Custom SLA and security review", "Volume-based pricing"],
        cta: "Request Demo / Quote",
        highlighted: false,
      },
    ],
  },
  {
    key: "testimonials",
    label: "Testimonials",
    value: [
      {
        quote:
          "BeamCraft replaced three disconnected tools with one application built around how our operations actually run. Our weekly planning meeting went from two hours to twenty minutes.",
        name: "Elena Marsh",
        role: "Chief Operating Officer",
        company: "Northgate Logistics",
      },
      {
        quote:
          "The usage-based model was the deciding factor. We scaled from a pilot in one region to twelve markets without a single pricing renegotiation.",
        name: "David Okafor",
        role: "Chief Executive Officer",
        company: "Meridian Foods Group",
      },
      {
        quote:
          "Working software every Friday. That cadence changed how our board thinks about technology investment — we see progress, not promises.",
        name: "Priya Raman",
        role: "VP of Operations",
        company: "Halcyon Manufacturing",
      },
    ],
  },
];

migrate(
  (app) => {
    let collection;
    try {
      collection = app.findCollectionByNameOrId("site_content");
    } catch (_) {
      collection = new Collection({
        type: "base",
        name: "site_content",
        // Marketing copy is public to read; only admins can edit.
        listRule: "",
        viewRule: "",
        createRule: "@request.auth.role = 'admin'",
        updateRule: "@request.auth.role = 'admin'",
        deleteRule: "@request.auth.role = 'admin'",
        fields: [
          { name: "key", type: "text", required: true, max: 60 },
          { name: "label", type: "text", max: 120 },
          { name: "value", type: "json" },
          { name: "created", type: "autodate", onCreate: true, onUpdate: false },
          { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
        ],
        indexes: ["CREATE UNIQUE INDEX idx_site_content_key ON site_content (key)"],
      });
      app.save(collection);
    }

    for (const item of DEFAULT_CONTENT) {
      try {
        app.findFirstRecordByData("site_content", "key", item.key);
      } catch (_) {
        const record = new Record(collection);
        record.set("key", item.key);
        record.set("label", item.label);
        record.set("value", item.value);
        app.save(record);
      }
    }
  },
  (app) => {
    try {
      const collection = app.findCollectionByNameOrId("site_content");
      app.delete(collection);
    } catch (e) {
      if (!e.message.includes("no rows in result set")) throw e;
    }
  },
);

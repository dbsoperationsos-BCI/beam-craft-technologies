const iamService = require("./src/services/iam.service");
require("./src/config/db");

(async () => {
  try {
    const permissions = await iamService.getUserPermissions(1);
    console.log(`\nFound ${permissions.length} permissions for admin user:\n`);

    // Group by module
    const byModule = {};
    permissions.forEach((permission) => {
      if (!byModule[permission.module]) byModule[permission.module] = [];
      byModule[permission.module].push(permission.feature);
    });

    Object.entries(byModule).sort().forEach(([module, features]) => {
      console.log(`${module}:`);
      features.sort().forEach((feature) => console.log(`  - ${feature}`));
    });
  } catch (error) {
    console.error("Error:", error.message);
  }
  process.exit(0);
})();

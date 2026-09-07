// Static wiring smoke test for the curriculum routes.
// Verifies the route file exists, every endpoint is defined with the right
// verb+path+guard, and mounting is present in server/index.js.
// Run: node scripts/smoke-test-curriculum-routes.js
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const routeSrc = fs.readFileSync(path.join(root, 'server', 'routes', 'curriculum.js'), 'utf8');
const indexSrc = fs.readFileSync(path.join(root, 'server', 'index.js'), 'utf8');

let failed = 0;
function check(label, ok) {
  if (ok) console.log(`PASS ${label}`);
  else { failed++; console.log(`FAIL ${label}`); }
}

check('router is admin-guarded (router.use(requireAdmin))', /router\.use\(requireAdmin\)/.test(routeSrc));
check('PATCH /subjects/:id defined', /router\.patch\('\/subjects\/:id'/.test(routeSrc));
check('GET /subjects/:id/prerequisites defined', /router\.get\('\/subjects\/:id\/prerequisites'/.test(routeSrc));
check('POST /prerequisites defined', /router\.post\('\/prerequisites'/.test(routeSrc));
check('DELETE /prerequisites/:id defined', /router\.delete\('\/prerequisites\/:id'/.test(routeSrc));
check('uses validateComponentSplit', /validateComponentSplit\(/.test(routeSrc));
check('uses validatePrereqRow', /validatePrereqRow\(/.test(routeSrc));
check('audit-logs component updates', /CURRICULUM_UPDATE_COMPONENTS/.test(routeSrc));
check('audit-logs prereq creation', /CURRICULUM_ADD_PREREQ/.test(routeSrc));
check('audit-logs prereq deletion', /CURRICULUM_DELETE_PREREQ/.test(routeSrc));
check('handles unique-violation as 409', /23505/.test(routeSrc));
check('mounted in server/index.js', /app\.use\("\/api\/curriculum"/.test(indexSrc));
check('mounted with authMiddleware', /app\.use\("\/api\/curriculum",\s*authMiddleware/.test(indexSrc));

if (failed) { console.log(`\n${failed} check(s) failed`); process.exit(1); }
console.log('\nAll curriculum route wiring checks passed');

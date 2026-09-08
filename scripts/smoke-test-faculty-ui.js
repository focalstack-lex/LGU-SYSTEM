// Static wiring checks for the faculty portal. Run: node scripts/smoke-test-faculty-ui.js
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'client', 'faculty.html'), 'utf8');
const js = fs.readFileSync(path.join(root, 'client', 'js', 'faculty', 'faculty.js'), 'utf8');
const vercel = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));

let failed = 0;
const check = (label, ok) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`); if (!ok) failed++; };

check('page has gate + app shells', html.includes('faculty-gate') && html.includes('faculty-app'));
check('all three sections present', ['faculty-queue', 'faculty-approved', 'faculty-dean'].every(id => html.includes(id)));
check('evaluation view with three columns', html.includes('faculty-eval-prospectus') && html.includes('faculty-eval-history'));
check('loads faculty.js', html.includes('js/faculty/faculty.js'));
check('module boots on DOMContentLoaded', /FacultyPortal\.boot\(\)/.test(js));
check('role gating (head vs dean vs faculty)', /isHead/.test(js) && /isDean/.test(js));
check('grizz reason surfaced on items', /grizz_reason/.test(js));
check('approve confirm dialog present', /confirm\(/.test(js));
check('vercel routes /faculty', vercel.routes.some(r => r.src === '/faculty' && r.dest === 'client/faculty.html'));

if (failed) { console.log(`\n${failed} check(s) failed`); process.exit(1); }
console.log('\nAll faculty UI wiring checks passed');

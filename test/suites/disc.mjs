import fs from 'fs';
import { discoverProjects, candidateProjects, projectMarkers, readQuotationRef, projectTitleFrom } from '/home/user/dhh-job-intake/src/lib/project.js';
const rows = JSON.parse(fs.readFileSync(process.env.SP + '/real.json','utf8'));
const jobs = rows.map((r,i)=>({ ...r, id: 'j'+i, events: [], scheduledDate: r._date }));
const found = discoverProjects(jobs);
console.log('discovered projects:', found.length, '\n');
for (const p of found) {
  console.log(`${p.ref || '(no ref)'}  ${p.type.toUpperCase()}`);
  console.log(`   ${p.title}`);
  console.log(`   ${p.units.join(' / ')}`);
  console.log(`   ${p.days} day(s): ${p.dates.join(', ')}  (span ${p.spanDays}d)${p.continued?'  · continued':''}${p.revision?'  · rev '+p.revision:''}`);
  console.log(`   crew: ${p.crew.join(', ')}`);
  console.log(`   est: ${p.jobs.map(j=>j.estimatedTime||'—').join(', ')}`);
  console.log();
}
const cand = candidateProjects(jobs, found);
console.log('--- candidates (approved, no reference) ---', cand.length);
cand.forEach(c=>console.log(`   ${c.date} | ${c.property} ${c.unit} | ${c.description}`));
console.log();
// spot-check the parser on the awkward real strings
const tricky = [
  'ONB - Approved - Quotation - REV 01 - PC-2026-08-17 - Duct Cleaning',
  'Contin  Approved - Quotation - PC-2026-08-23 - Maintenance work',
  'Approevd - PC-2026-08-13 - Curtain fixing along with Fly mesh Repair or replace',
  'Quotation - PC-2026-08-24- Water heater replacement',
  'ONB - Approved - Quotation -PC-2026-08-15 - Maintenance work',
  'PC-2026-08-07 - Maintenance work',
  'Approved - Quotation - PC-2026-08-03 - Snag work',
  'Pick and Drop onboarding team',
  'Onboarding project',
  'AC PPM',
  'Approved - Water heater replacement - Collect from shop',
];
console.log('--- parser spot-check ---');
for (const t of tricky) {
  const m = projectMarkers({ description: t });
  console.log(`${m.isProject?'PROJECT':'   —   '} | ${(m.ref||'').padEnd(14)} | ${projectTitleFrom(t).padEnd(46)} | ${t.slice(0,44)}`);
}

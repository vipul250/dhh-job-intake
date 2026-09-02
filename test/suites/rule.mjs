import fs from 'fs';
const B = await import('/home/user/dhh-job-intake/src/lib/backlog.js');
const TODAY = '2026-09-01';
const text = fs.readFileSync(process.env.SP + '/pms-issues.tsv','utf8');
const { items, skipped, error } = B.parseIssuePaste(text, TODAY);
console.log(`parsed ${items.length} issues, skipped ${skipped}${error?' — '+error:''}\n`);
const rows = B.triage(items, { today: TODAY });
for (const { item, rec } of rows) {
  const flag = rec.overdue ? 'OVERDUE' : rec.blocked ? 'BLOCKED' : '       ';
  console.log(`${flag}  ${(item.property+' '+item.unit).padEnd(30)} ${item.description.slice(0,44)}`);
  console.log(`         -> ${rec.date || 'no date yet'}   [${B.BASIS[rec.basis]}]`);
  rec.why.forEach(w => console.log(`            · ${w}`));
  console.log();
}
console.log('SUMMARY', JSON.stringify(B.backlogSummary(items, { today: TODAY }), null, 1));

import fs from 'fs';
import { splitTrailingUnit } from '../../src/lib/normalize.js';
const d = JSON.parse(fs.readFileSync(process.env.SP + '/real.json','utf8'));
const blank = d.filter(r => !(r.unit||'').trim());
const seen = new Map();
blank.forEach(r => { const k = r.property.replace(/\s+/g,' ').trim(); if(!seen.has(k)) seen.set(k, splitTrailingUnit(r.property, r.unit)); });
let split=0, kept=0;
for (const [k,v] of seen) { v.split ? split++ : kept++; }
console.log(`distinct blank-unit properties: ${seen.size}  → split ${split}, left alone ${kept}\n`);
console.log('--- SPLIT ---');
for (const [k,v] of seen) if (v.split) console.log(`  ${k.padEnd(42)} -> ${v.property.padEnd(34)} / ${v.unit}`);
console.log('\n--- LEFT ALONE ---');
for (const [k,v] of seen) if (!v.split) console.log(`  ${k}`);
// safety: a row that already has a unit is only ever touched to remove an
// EXACT duplicate of that unit off the end of the building name
// ("Binghatti Tulip 305" + unit 305). Anything else must be left alone,
// because a wrong split renames a building. See splitTrailingUnit, and
// test/suites/pastefidelity.mjs for the assertions.
const withUnit = d.filter(r => (r.unit||'').trim());
const touched = withUnit.filter(r => splitTrailingUnit(r.property, r.unit).split);
console.log('\nrows with a unit already, de-duplicated:', touched.length);
touched.forEach(r => console.log('   ' + r.property + '  + unit ' + r.unit +
  '  ->  ' + splitTrailingUnit(r.property, r.unit).property));
const wrong = touched.filter(r => {
  const t = r.property.trim().split(/\s+/).pop();
  return t.toUpperCase().replace(/\.0+$/,'') !== String(r.unit).trim().toUpperCase().replace(/\.0+$/,'');
});
console.log('rows wrongly touched (tail was not the unit):', wrong.length);

import fs from 'fs';
import { splitTrailingUnit } from '/home/user/dhh-job-intake/src/lib/normalize.js';
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
// safety: never touch rows that already have a unit
const withUnit = d.filter(r => (r.unit||'').trim());
const changed = withUnit.filter(r => splitTrailingUnit(r.property, r.unit).split);
console.log('\nrows with a unit already, wrongly touched:', changed.length);

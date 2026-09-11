/* ---------------------------------------------------------------------- *
 * propertyname.mjs — one property, one name.
 *
 * Sixteen "distinct pools" in the real workbook are twelve. Binghatti
 * Tulip 305 and "Binghatti tulips 305" are one pool counted twice, so a
 * pool cleaned six times reads as 5 + 1 and its delivered frequency reads
 * 2.5 a week instead of 3.0 — against a contract specifying 2-3 times
 * weekly. Wrong in the direction that matters.
 *
 * The assertion that matters MOST is the refusal. Azizi Riviera 1 is one
 * edit from 10, 13 and 31, and those are different buildings. Merging them
 * bills one owner for three towers' visits. Every test below that says
 * "different" is protecting somebody's invoice.
 *
 * Run:  node test/suites/propertyname.mjs
 * ---------------------------------------------------------------------- */

import assert from "node:assert/strict";
import fs from "node:fs";
import { sameProperty, buildPropertyIndex } from "../../src/lib/propertyName.js";
import { parseSheetPaste } from "../../src/lib/importSheet.js";
import { canonProperty, squash, splitCrew } from "../../src/lib/normalize.js";

const ok = [];
const t = (name, fn) => { fn(); ok.push(name); };

/* ---------------- 1. the nine validated pairs ---------------- */

t("the four genuine duplicates are the same property", () => {
  assert.ok(sameProperty("Jumeirah Golf Estates", "Jumeirah golf estate"), "plural");
  assert.ok(sameProperty("Palmera 2 Villa 28 (", "Palmera 2 Villa 28"), "stray paren");
  assert.ok(sameProperty("Binghatti Tulip", "Binghatti tulips"), "plural");
  assert.ok(sameProperty("Bingatti Royale", "Binghatti Royale"), "one typo");
  /* A fifth, found by the rule rather than by eye. */
  assert.ok(sameProperty("Roawda Parkviews", "Rawda Parkviews"), "one typo");
});

t("a differing LETTER is a different building too", () => {
  /* Found by running the rule over the real workbook: both of these were
     merged by a numbers-only guard, and both are two real towers. A single
     letter is a designator, not a spelling. */
  assert.equal(sameProperty("Celestia A", "Celestia B"), false);
  assert.equal(sameProperty("Damac Towers by Paramount A", "Damac Towers by Paramount D"), false);
  assert.equal(sameProperty("Silverene Towers A", "Silverene Towers B"), false);
});

t("a differing number is a different building, however close the spelling", () => {
  /* THE important one. A similarity threshold merges these; the numeric
     guard refuses them outright. */
  assert.equal(sameProperty("Azizi Riviera 10", "Azizi Riviera 1"), false);
  assert.equal(sameProperty("Azizi Riviera 13", "Azizi Riviera 1"), false);
  assert.equal(sameProperty("Azizi Riviera 31", "Azizi Riviera 1"), false);
  assert.equal(sameProperty("Marina Gate 2", "Marina Gate 3"), false);
});

t("a missing number is a different building — confirmed by Vipul, 11 Sep", () => {
  /* Product truth, not an inference. Anybody relaxing the numeric guard so
     a missing trailing number is tolerated breaks this. */
  assert.equal(sameProperty("Elite Residence 4", "Elite Residence"), false);
  /* And canonProperty already folds the plural, so this is not a third. */
  assert.equal(canonProperty("Elite Residences 4"), canonProperty("Elite Residence 4"));
});

t("two typos in one name is a different property, not a worse typo", () => {
  assert.equal(sameProperty("Bingatti Royle", "Binghatti Royale"), false);
});

t("a different word count is a different property", () => {
  assert.equal(sameProperty("Palm Villa", "Palm Villa Garden"), false);
});

t("identical names are the same property", () => {
  assert.ok(sameProperty("Palm Villa", "palm  villa"));
  assert.ok(sameProperty("Damac Towers by Paramount A", "DAMAC TOWERS BY PARAMOUNT A"));
});

/* ---------------- 2. the index over real data ---------------- */

const { jobs } = parseSheetPaste(fs.readFileSync("test/harness/paste.tsv", "utf8"), null);

t("the real workbook merges exactly the five known duplicates, no more", () => {
  const index = buildPropertyIndex(jobs, []);
  /* An over-eager rule shows up here as a fifth merge. */
  const pairs = index.merges.map((m) => `${canonProperty(m.from)} -> ${canonProperty(m.to)}`).sort();
  assert.equal(index.merges.length, 5,
    `expected 5 merges, got ${index.merges.length}:\n  ${pairs.join("\n  ")}`);
  const joined = pairs.join(" | ");
  ["jumeirah golf estate", "palmera", "tulip", "royale", "rawda"].forEach((needle) =>
    assert.ok(new RegExp(needle).test(joined), `no merge mentioning ${needle}: ${joined}`));
  /* The two the rule used to get wrong. */
  assert.ok(!/celestia/.test(joined), `Celestia A and B must not merge: ${joined}`);
  assert.ok(!/paramount/.test(joined), `Paramount A and D must not merge: ${joined}`);
});

t("Azizi Riviera stays four buildings in the real data", () => {
  const index = buildPropertyIndex(jobs, []);
  const azizi = new Set();
  jobs.forEach((j) => {
    if (!/azizi riviera/i.test(squash(j.property))) return;
    azizi.add(canonProperty(index.resolve(j.property)));
  });
  /* 1, 10, 13, 31 and any others in the sample — the point is that
     resolving must not collapse them into one. */
  assert.ok(azizi.size >= 4, `Azizi collapsed to ${azizi.size}: ${[...azizi].join(", ")}`);
});

t("the twelve real pools resolve to twelve, not sixteen", () => {
  const index = buildPropertyIndex(jobs, []);
  const pools = jobs.filter((j) => /pool/i.test(j.description || ""));
  const keys = new Set(pools.map((j) =>
    `${canonProperty(index.resolve(j.property))}::${squash(j.unit).toUpperCase()}`));
  assert.equal(keys.size, 12, `expected 12 pools, got ${keys.size}:\n  ${[...keys].sort().join("\n  ")}`);
});

t("Jumeirah Golf Estates W019 reports 7 visits, not 6 and 1", () => {
  const index = buildPropertyIndex(jobs, []);
  const n = jobs.filter((j) =>
    /pool/i.test(j.description || "") &&
    canonProperty(index.resolve(j.property)) === "jumeirah golf estates" &&
    squash(j.unit).toUpperCase() === "W019").length;
  assert.equal(n, 7);
});

/* ---------------- 3. overrides and the master list ---------------- */

t("a keepApart entry overrides the rule", () => {
  const rows = [
    { property: "Binghatti Tulip", unit: "305", description: "Pool Cleaning" },
    { property: "Binghatti tulips", unit: "305", description: "Pool Cleaning" },
  ];
  const merged = buildPropertyIndex(rows, []);
  assert.equal(merged.merges.length, 1, "without an override these merge");

  const kept = buildPropertyIndex(rows, [], {
    keepApart: [["binghatti tulip", "binghatti tulips"]],
  });
  assert.equal(kept.merges.length, 0, "the override must win");
  assert.notEqual(kept.resolve("Binghatti tulips"), kept.resolve("Binghatti Tulip"));
});

t("the property master decides the canonical spelling", () => {
  const rows = [
    { property: "Bingatti Royale", unit: "605" },
    { property: "Bingatti Royale", unit: "605" },
    { property: "Bingatti Royale", unit: "605" },
    { property: "Binghatti Royale", unit: "605" },
  ];
  /* Frequency alone would pick the misspelling, three uses to one. */
  const byFreq = buildPropertyIndex(rows, []);
  assert.equal(squash(byFreq.resolve("Binghatti Royale")), "Bingatti Royale");

  const byMaster = buildPropertyIndex(rows, [{ name: "Binghatti Royale" }]);
  assert.equal(squash(byMaster.resolve("Bingatti Royale")), "Binghatti Royale",
    "the master list is authoritative over frequency");
});

t("resolve returns the name unchanged when nothing matches", () => {
  const index = buildPropertyIndex([{ property: "Somewhere New" }], []);
  assert.equal(squash(index.resolve("Somewhere New")), "Somewhere New");
  assert.equal(squash(index.resolve("Never Seen")), "Never Seen");
});

t("a blank property is not a property", () => {
  const index = buildPropertyIndex([{ property: "" }, { property: "   " }], []);
  assert.equal(index.merges.length, 0);
  assert.equal(index.resolve(""), "");
});

console.log(ok.map((n) => `  ok  ${n}`).join("\n"));
console.log(`\n${ok.length} checks passed.`);

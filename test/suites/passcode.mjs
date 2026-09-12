/* ---------------------------------------------------------------------- *
 * passcode.mjs — the door.
 *
 * 12 September: "yesterday when i opened the old link on a different
 * device, it opened and showed everything that this link shows."
 *
 * Both URLs serve the same deployment, so a gate in the app closes both.
 * What it cannot close is the anon key sitting in the bundle — these
 * checks exist partly to keep that distinction written down where the next
 * person will read it.
 *
 * Run:  node test/suites/passcode.mjs
 * ---------------------------------------------------------------------- */

import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import fs from "node:fs";

if (!globalThis.crypto) globalThis.crypto = webcrypto;

const { checkPasscode, isUnlocked, unlock, lock, UNLOCK_DAYS } =
  await import("../../src/lib/passcode.js");

/* A browser's localStorage, closely enough for the three calls used. */
function fakeStorage() {
  const m = new Map();
  globalThis.localStorage = {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
  return m;
}

const ok = [];
const t = async (name, fn) => { await fn(); ok.push(name); };

await t("the right passcode opens it", async () => {
  assert.equal(await checkPasscode("dhh-marina-4712"), true);
});

await t("surrounding whitespace is forgiven — it is typed on a phone", async () => {
  assert.equal(await checkPasscode("  dhh-marina-4712 "), true);
});

await t("a wrong passcode does not", async () => {
  for (const bad of ["dhh-marina-4713", "DHH-MARINA-4712", "dhhmarina4712", "", "   ", "password"]) {
    assert.equal(await checkPasscode(bad), false, JSON.stringify(bad));
  }
});

await t("the passcode itself is not in the source — only its hash", () => {
  const src = fs.readFileSync(new URL("../../src/lib/passcode.js", import.meta.url), "utf8");
  assert.ok(!src.includes("dhh-marina-4712"), "reading the bundle must not hand over the code");
  assert.ok(/[0-9a-f]{64}/.test(src), "a SHA-256 is what should be there");
});

await t("a fresh device is locked", () => {
  fakeStorage();
  assert.equal(isUnlocked(), false);
});

await t("unlocking lasts, and then stops lasting", () => {
  const m = fakeStorage();
  unlock();
  assert.equal(isUnlocked(), true);
  const until = Number(m.get("dhh-unlocked"));
  const days = (until - Date.now()) / (24 * 60 * 60 * 1000);
  assert.ok(Math.abs(days - UNLOCK_DAYS) < 0.01, `expiry is ${UNLOCK_DAYS} days`);

  m.set("dhh-unlocked", String(Date.now() - 1000));
  assert.equal(isUnlocked(), false, "an expired device asks again");
});

await t("signing the device out locks it", () => {
  fakeStorage();
  unlock();
  lock();
  assert.equal(isUnlocked(), false);
});

await t("junk in storage fails closed, never open", () => {
  const m = fakeStorage();
  for (const junk of ["", "nonsense", "NaN", "-1", "null"]) {
    m.set("dhh-unlocked", junk);
    assert.equal(isUnlocked(), false, junk);
  }
});

await t("storage that throws fails closed", () => {
  globalThis.localStorage = {
    getItem() { throw new Error("blocked"); },
    setItem() { throw new Error("blocked"); },
    removeItem() { throw new Error("blocked"); },
  };
  assert.equal(isUnlocked(), false, "a private window asks every time");
  unlock();               // must not throw
  lock();                 // must not throw
});

console.log(ok.map((n) => `  ok  ${n}`).join("\n"));
console.log(`\n${ok.length} checks passed.`);

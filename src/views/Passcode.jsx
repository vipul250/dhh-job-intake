import React, { useState } from "react";
import { Lock, Loader2 } from "lucide-react";
import { checkPasscode, unlock, UNLOCK_DAYS } from "../lib/passcode.js";

/* The first thing anybody sees. Deliberately says nothing about the
   department, the buildings or the data behind it — a wrong arrival should
   learn nothing from the door. */
export default function Passcode({ onUnlocked }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [wrong, setWrong] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (busy || !code.trim()) return;
    setBusy(true);
    setWrong(false);
    const ok = await checkPasscode(code);
    setBusy(false);
    if (!ok) { setWrong(true); setCode(""); return; }
    unlock();
    onUnlocked();
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
      <form onSubmit={submit} className="w-full max-w-sm">
        <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
          <div className="flex items-center gap-2 text-slate-900">
            <Lock className="w-4 h-4 text-slate-400" />
            <h1 className="text-sm font-medium">Enter the passcode</h1>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            This device will stay unlocked for {UNLOCK_DAYS} days.
          </p>

          <input
            autoFocus
            type="password"
            value={code}
            onChange={(e) => { setCode(e.target.value); setWrong(false); }}
            placeholder="Passcode"
            autoComplete="current-password"
            className={`mt-4 w-full border rounded-md px-3 py-2 text-sm ${
              wrong ? "border-red-400 bg-red-50" : "border-slate-300"}`}
          />

          {wrong && (
            <p className="mt-2 text-xs text-red-700">That is not the passcode.</p>
          )}

          <button
            type="submit"
            disabled={busy || !code.trim()}
            className="mt-4 w-full bg-slate-900 text-white text-sm rounded-md px-3 py-2 disabled:opacity-40 flex items-center justify-center gap-2"
          >
            {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Open
          </button>
        </div>
      </form>
    </div>
  );
}

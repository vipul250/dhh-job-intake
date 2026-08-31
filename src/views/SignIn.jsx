import React, { useState } from "react";
import { Loader2, Mail, KeyRound, ArrowLeft } from "lucide-react";
import { sendCode, verifyCode } from "../lib/auth.js";

/* ---------------------------------------------------------------------- *
 * SignIn.jsx — email, then a six-digit code from that email.
 *
 * No password to forget, share or write on a whiteboard, and the code
 * proves the person holds the mailbox. Whether an address is allowed at
 * all is decided in Supabase, not here — this screen only reports what it
 * is told, so a stranger cannot use it to discover who works here.
 * ---------------------------------------------------------------------- */

export default function SignIn({ onSignedIn }) {
  const [stage, setStage] = useState("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");

  async function send() {
    setBusy(true); setError(""); setNote("");
    const r = await sendCode(email);
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    setStage("code");
    setNote(`A six-digit code is on its way to ${email.trim().toLowerCase()}. It expires shortly.`);
  }

  async function verify() {
    setBusy(true); setError("");
    const r = await verifyCode(email, code);
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    onSignedIn(r.session);
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-start justify-center p-4">
      <div className="w-full max-w-sm mt-20 rounded-lg border border-slate-200 bg-white p-5">
        <h1 className="text-base font-semibold text-slate-900">DHH Job Intake</h1>
        <p className="text-xs text-slate-500 mt-1">
          Sign in with your work email. A one-time code is sent to your inbox — there is no
          password to remember or share.
        </p>

        {stage === "email" && (
          <>
            <label className="block text-xs text-slate-600 mt-4">
              Work email
              <div className="mt-1 flex items-center gap-2">
                <Mail className="w-4 h-4 text-slate-400 shrink-0" />
                <input autoFocus type="email" value={email}
                       onChange={(e) => setEmail(e.target.value)}
                       onKeyDown={(e) => { if (e.key === "Enter" && email.trim()) send(); }}
                       placeholder="you@deluxehomes.com"
                       className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm" />
              </div>
            </label>
            <button onClick={send} disabled={!email.trim() || busy}
                    className="mt-3 w-full flex items-center justify-center gap-1.5 text-sm bg-slate-900 text-white px-4 py-2 rounded-md disabled:opacity-40">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              Send me a code
            </button>
          </>
        )}

        {stage === "code" && (
          <>
            <label className="block text-xs text-slate-600 mt-4">
              Code from your email
              <div className="mt-1 flex items-center gap-2">
                <KeyRound className="w-4 h-4 text-slate-400 shrink-0" />
                <input autoFocus inputMode="numeric" value={code}
                       onChange={(e) => setCode(e.target.value)}
                       onKeyDown={(e) => { if (e.key === "Enter" && code.trim()) verify(); }}
                       placeholder="123456"
                       className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm tracking-widest" />
              </div>
            </label>
            <button onClick={verify} disabled={!code.trim() || busy}
                    className="mt-3 w-full flex items-center justify-center gap-1.5 text-sm bg-slate-900 text-white px-4 py-2 rounded-md disabled:opacity-40">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              Sign in
            </button>
            <div className="flex items-center justify-between mt-2">
              <button onClick={() => { setStage("email"); setCode(""); setError(""); }}
                      className="text-xs text-slate-500 flex items-center gap-1 hover:text-slate-800">
                <ArrowLeft className="w-3 h-3" /> different email
              </button>
              <button onClick={send} disabled={busy} className="text-xs text-slate-500 hover:text-slate-800">
                send another code
              </button>
            </div>
          </>
        )}

        {note && <p className="mt-3 text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded px-2 py-1.5">{note}</p>}
        {error && <p className="mt-3 text-xs text-red-800 bg-red-50 border border-red-200 rounded px-2 py-1.5">{error}</p>}

        <p className="mt-4 text-[11px] text-slate-400 border-t border-slate-100 pt-3">
          Only addresses an administrator has added in Supabase can receive a code. If yours is not
          working, ask them to add it rather than trying another address.
        </p>
      </div>
    </div>
  );
}

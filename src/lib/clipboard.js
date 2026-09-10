/* ---------------------------------------------------------------------- *
 * clipboard.js — copying that either works or says it didn't.
 *
 * The board's copy buttons were written as
 *
 *     navigator.clipboard?.writeText(text);
 *     showToast("Copied — paste into PMS.", "ok");
 *
 * which is two bugs wearing one coat. The `?.` means that on a device
 * without the Clipboard API the call quietly evaporates, and the toast
 * fires anyway — so the coordinator is told the day's jobs are on the
 * clipboard, switches to the PMS, and pastes whatever was there before.
 * The second bug is that `writeText` returns a promise that can reject
 * (denied permission, no user gesture recognised, an insecure context);
 * nothing awaited it, so the same lie is told.
 *
 * `navigator.clipboard` is missing more often than it looks: iOS Safari
 * before 13.4, Android WebView shells, anything served over plain http,
 * and in-app browsers that strip it. Those are field devices, and copy
 * for the technician is the one thing they are used for.
 *
 * So: try the modern API, fall back to the old selection-and-execCommand
 * trick that those browsers do support, and report the truth either way.
 * ---------------------------------------------------------------------- */

/**
 * Copy text, using whatever this browser actually has.
 * @param {string} text
 * @returns {Promise<boolean>} true only if the text really reached the clipboard.
 */
export async function copyText(text) {
  const s = String(text == null ? "" : text);
  if (!s) return false;

  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      await navigator.clipboard.writeText(s);
      return true;
    }
  } catch {
    /* Denied, insecure context, or no gesture. The old way may still work. */
  }

  return legacyCopy(s);
}

/**
 * The pre-Clipboard-API method: put the text in a field, select it, and
 * ask the document to copy the selection. Deprecated, still the only
 * thing that works on an older iPad, and harmless where it doesn't.
 */
function legacyCopy(text) {
  if (typeof document === "undefined" || !document.body) return false;

  const ta = document.createElement("textarea");
  ta.value = text;
  /* Off-screen rather than hidden: a display:none or zero-size field
     cannot be selected, and iOS scrolls to whatever it focuses, so it is
     pinned to the current viewport instead of the top of the document. */
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.top = "0";
  ta.style.left = "0";
  ta.style.width = "1px";
  ta.style.height = "1px";
  ta.style.padding = "0";
  ta.style.border = "none";
  ta.style.opacity = "0";
  document.body.appendChild(ta);

  const previous = document.activeElement;
  let ok = false;
  try {
    if (/ipad|iphone|ipod/i.test(navigator.userAgent || "")) {
      /* iOS ignores .select() on a readonly field, and needs a real range
         over an editable node before it will copy anything. */
      ta.contentEditable = "true";
      ta.readOnly = false;
      const range = document.createRange();
      range.selectNodeContents(ta);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      ta.setSelectionRange(0, safeLength(text));
    } else {
      ta.select();
    }
    ok = !!(document.execCommand && document.execCommand("copy"));
  } catch {
    ok = false;
  } finally {
    document.body.removeChild(ta);
    try {
      if (previous && typeof previous.focus === "function") previous.focus();
    } catch { /* the element went away with the render; nothing to restore */ }
  }
  return ok;
}

function safeLength(text) {
  /* setSelectionRange wants a number, and older WebKit dislikes lengths
     past the end of the value on a contentEditable field. */
  return Math.min(String(text).length, 999999);
}

/**
 * Copy and tell the truth in a toast.
 *
 * @param {string} text     what to copy
 * @param {function} showToast  the board's toast function (msg, kind)
 * @param {string} okMsg    what to say when it really worked
 */
export async function copyWithToast(text, showToast, okMsg) {
  const ok = await copyText(text);
  if (!showToast) return ok;
  if (ok) showToast(okMsg, "ok");
  else showToast("This browser would not let the app copy. Select the text by hand, or open the board in Chrome or Safari.", "warn");
  return ok;
}

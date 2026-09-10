import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import "./index.css";

/* ---------------------------------------------------------------------- *
 * A crash inside React is not a crash of the page.
 *
 * Without a boundary, a throw anywhere in the tree unmounts the whole
 * thing and leaves an empty <div id="root"> — the same blank screen as a
 * browser too old to run the bundle, and indistinguishable from it by the
 * person looking at the device. The boot guard in index.html only fires
 * before the first render, so from mount onwards this is what stands
 * between a bug in one row and a board that appears to be broken.
 *
 * It says what failed, offers a reload, and hands over the same copyable
 * report the boot guard writes, so a fault on a device nobody can attach
 * a console to still arrives as text rather than as "it stopped working".
 * ---------------------------------------------------------------------- */
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null, info: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    this.setState({ info });
    console.error("Board crashed:", error, info);
  }

  report() {
    const { error, info } = this.state;
    const lines = [
      "DHH Job Intake — crash report",
      `when: ${new Date().toString()}`,
      `url: ${location.href}`,
      `browser: ${navigator.userAgent}`,
      `error: ${(error && (error.stack || error.message)) || String(error)}`,
    ];
    if (info && info.componentStack) lines.push(`where:${info.componentStack}`);
    return lines.join("\n");
  }

  render() {
    if (!this.state.error) return this.props.children;

    const text = this.report();
    return (
      <div className="max-w-2xl mx-auto my-10 rounded-lg border border-slate-300 bg-white p-5">
        <div className="text-[17px] font-semibold text-slate-900">Something on the board broke</div>
        <p className="mt-1 text-slate-600">
          The page is still loaded — reloading usually brings it back. If it keeps happening, send
          the details below so the fault can be fixed rather than guessed at.
        </p>
        <div className="mt-3 flex gap-2">
          <button
            onClick={() => location.reload()}
            className="rounded-md border border-slate-400 bg-slate-50 px-3 py-1.5 text-sm"
          >
            Reload
          </button>
          <button
            onClick={(e) => {
              const btn = e.currentTarget;
              copyPlainText(text, (ok) => { btn.textContent = ok ? "Copied" : "Select and copy"; });
            }}
            className="rounded-md border border-slate-400 bg-slate-50 px-3 py-1.5 text-sm"
          >
            Copy details
          </button>
        </div>
        <pre className="mt-3 whitespace-pre-wrap break-words rounded-md bg-slate-100 p-3 text-[12px] leading-5 text-slate-900">
          {text}
        </pre>
      </div>
    );
  }
}

/* Deliberately not imported from lib/clipboard.js: this file has to keep
   working when a module in the tree is what threw. */
function copyPlainText(text, done) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => done(true), () => done(false));
      return;
    }
  } catch { /* fall through */ }
  done(false);
}

/** Tells the boot guard in index.html that React got as far as the screen. */
function BootSignal({ children }) {
  React.useEffect(() => {
    if (typeof window.__dhhBooted === "function") window.__dhhBooted();
  }, []);
  return children;
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ErrorBoundary>
      <BootSignal>
        <App />
      </BootSignal>
    </ErrorBoundary>
  </React.StrictMode>
);

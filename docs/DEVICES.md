# Devices and browsers

Written after a report that the board "works on the other devices, not on
mine", with no console, no error text and no way to reproduce it here. Two
things came out of that: the app now runs on much older browsers than it
did, and when it still fails it says so on the screen instead of showing a
white page.

---

## What the app runs on now

The build ships **twice**. A modern browser downloads the module build and
nothing else; anything older downloads an ES2015 build with the polyfills
it needs, and never sees the modern one.

| | Floor |
|---|---|
| iPhone / iPad | iOS 10.3 — an iPhone 5 is the oldest device Apple ever put it on |
| Android | Chrome 49, i.e. Android 5.0 and up |
| Windows / Mac desktop | Chrome 49, Firefox 52, Edge 17, Safari 10.1 |

Before this, the floor was **Chrome 87 / Safari 14 / Firefox 78 / Edge 88 —
late 2020**, and everything below it got a blank page with no message. That
is the default Vite build target, not a decision anyone made, and it is a
long way above the hardware a maintenance department actually carries.

The split is not by user-agent. Vite tests whether the browser can parse a
module that uses `import.meta`, dynamic import and an async generator;
what passes takes the modern build, what fails falls back to the older
one, and browsers with no module support at all never see the modern
files. The modern build is itself compiled down to Chrome 64 / Safari 12
— the same line the test draws — so nothing lands in a gap between the
two.

The floors are set in `vite.config.js`. Below them nothing can be done: an
engine without `Promise` cannot be polyfilled into having one, and every
build here needs it.

**Not supported, deliberately:** Internet Explorer 11, and anything running
Android 4.x. React 18 does not support IE11 and forcing full ES5 output to
chase it would slow the build and fatten the bundle the old phones have to
download, for devices that are not in use here.

## When somebody says it does not work on their device

Ask them for a screenshot of the whole screen. One of four things is on it.

**1. A panel headed "The job board did not start on this device."**
The page arrived, nothing rendered. Underneath it is a report — browser,
screen size, which JavaScript features the engine has, and any error or
failed download. That is the whole diagnosis; there is a **Copy details**
button so they can send it as text. `features: modules=NO` means an old
engine. A `Could not download` line means the network ate a chunk — hotel
or site wifi with a captive portal is the usual cause, and reloading once
past the portal fixes it.

**2. A panel headed "This browser is too old to run the job board."**
The engine has no `Promise`. Nothing to fix in the app: update the browser,
or use a different device.

**3. A panel headed "Something on the board broke."**
The board started and then a fault in the app took the screen down. That is
a bug here, and the details underneath name the component. Ask for them.

**4. Anything else — the board, but wrong.**
Not a compatibility problem. Get the screenshot and treat it as a bug.

A white page with none of these panels means the HTML itself never arrived
— DNS, the network, or Vercel. Check the URL is the current one; the link
has been renamed before.

## Where this lives in the code

- `vite.config.js` — the two builds and the browser floors.
- `index.html` — the boot guard. Inline, ES5, and it must stay that way:
  it exists to describe browsers that cannot parse anything newer, and a
  guard written in syntax the broken engine chokes on reports nothing.
  It waits about 35 seconds before declaring failure, because the older
  build is about 680 KB and old devices are usually on slow connections.
- `src/main.jsx` — the error boundary, which covers everything after the
  first render, where the boot guard stops.
- `src/lib/clipboard.js` — copy that falls back to `execCommand` where
  there is no Clipboard API (iOS before 13.4, in-app browsers, plain
  http), and reports failure honestly instead of claiming success.

## Testing it

`test/suites/device.mjs`. It checks that the old build is emitted, that it
parses as ES2015, that it actually renders the board when run in place of
the modern one, that a load with the bundle blocked ends in the panel and
not a white screen, and that a copy button with no clipboard says so.

```sh
cp test/harness/mock-storage.js src/lib/storage.js
npm run build && npx vite preview --port 4173 --host 127.0.0.1 &
cd test && SP=$PWD/harness node suites/device.mjs
git checkout src/lib/storage.js
```

It takes about 30 seconds — most of that is the 13-second wait for the boot
guard to give its verdict.

**What it cannot check:** no old engine is involved anywhere. Running the
ES2015 bundle in current Chromium proves the bundle is not broken in
itself; it does not prove iOS 10 runs it. Nothing short of the device
proves that.

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import legacy from "@vitejs/plugin-legacy";

/* ---------------------------------------------------------------------- *
 * Why this build ships twice.
 *
 * The default Vite build emits one `<script type="module">` and nothing
 * else. Every browser that does not understand ES modules — or that
 * understands them but chokes on `??`, which the bundle used in 22 places
 * — downloaded that file, failed to parse it, and rendered an empty
 * <div>. There was no error on screen, no spinner, no clue: the tab title
 * appeared and the page stayed white. That is exactly the report this
 * change comes from ("works on the other phones, not on mine"), and it is
 * unfalsifiable from the outside because the device that fails is the one
 * device without a console attached to it.
 *
 * The stock target is Chrome 87 / Safari 14 / Firefox 78 / Edge 88, i.e.
 * late 2020. An iPad kept on iOS 12 because the newer iPadOS will not
 * install on it, a site phone still on Android 8, a laptop on an old
 * managed Chrome — all of them are outside that line and all of them are
 * the kind of hardware a maintenance department actually carries.
 *
 * @vitejs/plugin-legacy emits a second set of chunks with the core-js
 * polyfills they need, guarded by `nomodule` so a current browser never
 * downloads a byte of it. The cost is build time and disk on the CDN; the
 * benefit is that the department is not sorting its devices into ones
 * that can open the board and ones that cannot.
 *
 * DO NOT SET `build.target` HERE. The plugin overrides it — it pins the
 * modern chunks to `es2020, edge79, firefox67, chrome64, safari12` — and
 * warns that it has. That override is the point rather than a nuisance:
 * it matches the feature test Vite uses to decide which of the two builds
 * a browser takes (can it parse a module using `import.meta`, dynamic
 * import and an async generator?), which Chrome 64 and Safari 12 pass.
 * Left at the default, everything from Chrome 64 to 86 would pass that
 * test, take a bundle written in syntax it cannot read, and white-screen
 * with the older copy sitting right there unused. Setting a target here
 * does nothing except print a warning.
 * ---------------------------------------------------------------------- */
export default defineConfig({
  plugins: [
    react(),
    legacy({
      /* Deliberately older than `defaults`. These are the floors, not a
         wish list: Chrome 49 is the last build for Android 5 and for
         Windows machines that never moved off it, and Safari 10.1 / iOS
         10.3 covers an iPhone 5. Anything below this predates Promise,
         and no polyfill saves it. */
      targets: [
        "defaults",
        "chrome >= 49",
        "firefox >= 52",
        "safari >= 10.1",
        "ios_saf >= 10.3",
        "edge >= 17",
        "not dead",
        "not op_mini all",
      ],
      /* core-js, picked per the targets above rather than shipped whole. */
      polyfills: true,
      /* The modern chunks go down to Chrome 64 and Safari 12, which are
         missing methods the bundle calls — `Object.fromEntries` needs
         Chrome 73, `flatMap` needs Chrome 69. Without this the syntax
         parses and the app throws on the first call instead. It costs
         every visitor ~36 kB gzipped, which is the price of the modern
         build being honest about how far down it goes. */
      modernPolyfills: true,
    }),
  ],
});

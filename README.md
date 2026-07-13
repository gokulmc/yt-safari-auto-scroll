# YT Shorts Auto-Scroll

<img src="extension/images/icon-256.png" width="128" alt="YT Shorts Auto-Scroll icon" align="right">

A Safari Web Extension that auto-advances YouTube Shorts when they end — **even in Picture-in-Picture, with the window backgrounded or minimized.** It also ships a toolbar popup with a universal "Picture-in-Picture this page" button that works on any site, not just YouTube.

<!-- TODO: demo GIF -->

## Why this exists

Poll-based Shorts auto-scroll userscripts work fine in a normal foreground tab, but stop advancing the moment a Short goes into Picture-in-Picture (or the tab is backgrounded). The root cause: Safari clamps `setInterval` to at least ~1 second and *suspends it entirely* in hidden/occluded tabs. A 300ms poll that's supposed to keep re-forcing `loop = false` after YouTube resets it per-video simply never runs — so the Short loops forever instead of advancing.

This extension has no poll loop at all. It's entirely event-driven off the media pipeline (`ended`, `timeupdate`, `playing`, and friends), which keeps firing from the browser's media engine regardless of tab visibility or PiP state. That's the actual fix, not a workaround.

## Features

- Auto-advances to the next Short when the current one ends, indefinitely — including while backgrounded or in PiP.
- A toolbar toggle to turn auto-scroll on/off (on by default).
- "Picture-in-Picture this page" button in the popup — pops out whatever video is currently playing on the active tab, on any site (YouTube, Vimeo, wherever there's a `<video>`).
- Auto-restores Picture-in-Picture across an auto-advance when the advance is what dropped it (never fights you if you close PiP yourself).
- Zero external dependencies, zero build step. Plain JS, MV3, promise-based `browser.*` APIs.

## Requirements

- macOS
- Safari 17 or later (Safari 26+ recommended for the no-Xcode temporary-extension dev loop described below)
- Xcode — only needed if you want a **persistent** install that survives a Safari restart. Not needed for the temporary-extension path.

## Install

There are two ways to run this extension. Pick one.

### (a) Temporary extension — fastest, no Xcode, but unloads on Safari quit

Requires Safari 26+.

1. Safari → Settings → Advanced → check **"Show features for web developers"**.
2. A **Developer** menu/tab appears in Settings. Open it.
3. Click **"Add Temporary Extension…"** and select this repo's `extension/` folder.
4. The extension is now active. It unloads automatically when Safari quits — repeat this step to reload it (e.g. after pulling changes).

This is the recommended path for trying the extension out or iterating on the source.

### (b) Xcode build — persistent install

This packages `extension/` into a thin native wrapper app that registers the extension with Safari, and it stays installed across restarts.

1. One-time, if you've never run the Safari web extension packager on this Mac:
   ```
   xcodebuild -runFirstLaunch
   ```
2. The generated Xcode project is **already committed** at `xcode/YT Shorts Auto-Scroll/` — you normally don't run the packager at all. (Only if you need to regenerate it, e.g. after big manifest changes:
   ```
   xcrun safari-web-extension-packager extension/ \
     --project-location xcode \
     --app-name "YT Shorts Auto-Scroll" \
     --bundle-identifier com.gokulmc.yt-shorts-autoscroll \
     --swift --macos-only --no-open --no-prompt --force
   ```
   If `safari-web-extension-packager` isn't found, try `safari-web-extension-converter` — Apple renamed the tool. Note the packager derives the *app* target's bundle id from the app name instead of honoring `--bundle-identifier`; fix `PRODUCT_BUNDLE_IDENTIFIER` for the app target in `project.pbxproj` to `com.gokulmc.yt-shorts-autoscroll` or the build fails embedded-binary validation.)
3. Open `xcode/YT Shorts Auto-Scroll/YT Shorts Auto-Scroll.xcodeproj`, select the app target, and under **Signing & Capabilities** select **your own team** (a free personal Apple ID team works). Then press **⌘R** to build and run — this installs and registers the extension with Safari.
   - No Apple ID / no team? Use ad-hoc signing instead and enable Safari → Settings → Developer → **"Allow unsigned extensions"**. This setting **resets every time Safari quits**, so you'll need to re-toggle it each session.
4. Safari → Settings → Extensions → enable "YT Shorts Auto-Scroll".
5. For subsequent rebuilds (or to skip Xcode's GUI entirely), `scripts/build.sh` wraps the equivalent `xcodebuild` command with ad-hoc signing and opens the built app for you. The Xcode scheme is already shared in the repo (`xcshareddata/xcschemes/`), so this works straight after a fresh clone.

## Permission UX

- **On `www.youtube.com`**: the first time you click the toolbar icon, Safari shows its own per-site permission sheet instead of the popup. Choose **"Always Allow on This Website"** — this is one-time. The content script needs this to auto-advance Shorts.
- **On any other site**: the extension only requests `activeTab`, which Safari grants silently for the current tab the moment you click the toolbar icon — no separate prompt.

## Usage

- Click the toolbar icon to open the popup.
- **Auto-scroll Shorts** toggle: on by default. Turn it off to fall back to YouTube's native (looping) Shorts behavior.
- **Picture-in-Picture this page**: pops out the best-guess `<video>` on the current tab. Works on YouTube Shorts, regular YouTube videos, and other video sites. If Safari blocks the page (e.g. the Safari start page, a PDF, or a page where the extension has no access) or there's simply no video, the popup shows an inline message instead of failing silently.

## How it works

`extension/content.js` runs on `www.youtube.com` at `document_start` and installs capture-phase listeners on `document` for the relevant media events synchronously, before doing anything async — this matters because a WebKit bug (FB9157626) means `document_start` can inject *after* a Shorts video has already started playing when "Preload Top Hit" is active, so a startup scan for an already-active video runs alongside the listener install as a hedge.

From there it's all reactive:
- `timeupdate`/`playing`/etc. on the currently-active Short force `loop = false` (YouTube sets `loop = true` per video load, so this has to be re-forced continuously, not once).
- `ended` on the active video triggers `advance()`, which clicks YouTube's own "next" button, falls back to a different selector, and as a last resort dispatches a synthetic `ArrowDown` keydown — it never uses `history.pushState` (invisible to YouTube's router) or `location.href` (a full reload, which would kill PiP).
- A loop-restart guard watches for YouTube's native loop winning the race against the `loop = false` forcing (a backward jump in `currentTime` after sitting near the end) and treats it as a missed `ended`.
- Picture-in-Picture is tracked via both the standard PiP events and Safari's `webkitpresentationmodechanged`, and is auto-restored after an advance only when the advance itself is what dropped it — closing PiP yourself (even right after an advance) is never overridden.
- A 5-second watchdog does cheap, idempotent cleanup only (re-asserting `loop = false`, retrying a stuck `ended` state, nudging a stalled `paused` video, and attaching direct per-element listeners to any `<video>` as a shadow-DOM hedge) — everything on the critical path is event-driven, so this timer being throttled in the background is fine.

`extension/pip-inject.js` is injected on demand by the popup's "Picture-in-Picture this page" button via `scripting.executeScript`, on whatever tab is active. It picks the best candidate video (currently playing, then largest visible, then just decoded enough), and tries the native PiP APIs; if the page has had zero user interaction yet, those calls are silently gesture-gated, so it falls back to a small on-page button that performs the request from a genuine click.

## Troubleshooting

- **Extension isn't picking up changes after a rebuild**: toggle it off and back on in Safari → Settings → Extensions.
- **"Unable to find X in the extension's resources"**: the Xcode project references each root-level file in `extension/` individually — if you ADD a new top-level file there, you must also add it to the Xcode project's extension-target Resources (folders like `images/` and `popup/` are whole-folder references and pick up new files automatically).
- **"Allow unsigned extensions" turned itself off**: this Safari Developer setting resets every time Safari quits when using ad-hoc signing. Re-enable it, or sign with your own Apple ID team instead (see step 3 above) for a setting that persists.
- **Toggle/settings don't seem to apply**: Safari profiles each have their own separate `storage.local` (and their own separate extension enablement) — check you're changing the setting in the profile you're actually browsing in.
- **Popup shows "Safari blocked this page…"**: this is expected on the Safari start page, most `file://`/PDF views, and any page where the extension hasn't been granted access yet.

## License

MIT — see [LICENSE](LICENSE).

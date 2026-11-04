# Reddit Remove Login Popup (Firefox)

Removes Reddit's logged-out sign-in wall on Firefox desktop and Firefox for Android: hides
and deletes the upsell popup (desktop) or the blocking "get the app" sheet (mobile web), lifts the
`rpl-scroll-lock` scroll lock, and restores infinite scroll on cut-down subreddit feeds by
re-adding the missing `<faceplate-partial slot="load-after">` placeholder.

## Install (development)

`about:debugging#/runtime/this-firefox` → **Load Temporary Add-on…** → `extension/manifest.json`.

## Test

```sh
npm install
npm test             # headless Playwright Firefox (Nightly build) with the extension loaded
HEADED=1 npm test    # watch it run
SUB=AskReddit npm test
```

Tests run against live reddit.com. Reddit doesn't wall automated sessions, so the tests
simulate the wall: they strip the load-after placeholder from the subreddit HTML (what a
walled server sends) and insert the popup elements and scroll lock.

## Test on an Android phone

Automated tests can't trigger a real wall, so check releases on a real device.

1. Phone: enable **Developer options** (tap *Build number* 7 times), then **USB debugging**,
   or **Wireless debugging** (pair once with `adb pair <ip>:<pairing-port>`, then
   `adb connect <ip>:<port>` each session; Mac and phone on the same Wi-Fi).
2. Firefox for Android: **Settings → Remote debugging via USB** (also covers wireless adb).
3. Run it (`adb devices` shows the device name):
   ```sh
   ANDROID_DEVICE=<device> npm run android     # FIREFOX_APK=org.mozilla.fenix for Nightly
   ```
   Firefox restarts with the extension in a fresh, logged-out profile and reloads it on file changes.
4. Browse logged out for a while. The mobile wall is time-based: it shows after ~30 s on a page
   for returning visitors. To inspect the phone's tabs, use desktop Firefox → `about:debugging`.

## Publish to addons.mozilla.org

```sh
npm run lint     # same checks AMO runs on upload; must be 0 errors / 0 warnings
npm test
npm run build    # -> web-ext-artifacts/reddit_remove_login_popup-<version>.zip
```

1. Bump `version` in `extension/manifest.json` (every upload needs a new version).
   Never change `browser_specific_settings.gecko.id`: it identifies the add-on on AMO.
2. Sign in at https://addons.mozilla.org/developers/ and choose **Submit a New Add-on**
   (later: **Upload New Version**). Pick *On this site* (listed, reviewed) or *On your own* (unlisted, signed only).
3. Upload the zip. No source-code submission is needed: the code isn't minified or bundled.
4. Under compatibility, tick both **Firefox** and **Firefox for Android**.
5. Fill in the listing (suggested text below). The data-collection question is "none",
   matching `data_collection_permissions` in the manifest.

Icons are rendered from `assets/icon.svg` with `npm run icons`.

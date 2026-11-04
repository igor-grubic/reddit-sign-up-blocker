# Reddit Remove Login Popup (Firefox)

Removes Reddit's logged-out sign-in wall: hides and deletes the upsell popup, lifts the
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
4. Fill in the listing (suggested text below). The data-collection question is "none",
   matching `data_collection_permissions` in the manifest.

Icons are rendered from `assets/icon.svg` with `npm run icons`.

### Suggested listing

- **Name:** Reddit Remove Login Popup
- **Summary:** Browse Reddit without an account: removes the "log in to continue" popup, unlocks scrolling and keeps infinite scroll working.
- **Category:** Privacy & Security, or Other
- **Description:**
  > When you're not logged in, Reddit sometimes blocks the page with a sign-up popup, freezes scrolling and stops loading posts after the first few.
  >
  > This add-on:
  > - hides and removes Reddit's sign-up popup (other dialogs are left alone),
  > - unlocks scrolling,
  > - restores infinite scroll on subreddit pages, using Reddit's own loading.
  >
  > It runs only on reddit.com, collects no data, and makes no network requests of its own.
  > Not affiliated with or endorsed by Reddit, Inc.

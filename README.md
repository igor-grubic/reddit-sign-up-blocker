# Reddit Sign-up Wall Blocker (Firefox)

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

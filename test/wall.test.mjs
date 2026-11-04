// End-to-end tests against live reddit.com in Playwright's Firefox Nightly, with the extension loaded.
//
// Reddit no longer walls automated sessions, so the wall is simulated faithfully:
//  - the walled feed: the subreddit HTML is intercepted and its
//    <faceplate-partial slot="load-after"> placeholder stripped (what a walled server sends);
//  - the popup + scroll lock: Reddit's element names and rpl-scroll-lock class, inserted
//    into the server HTML or added later from page script, as Reddit does.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launchWithExtension } from './firefox-with-extension.mjs';

const SUB = process.env.SUB || 'linux';
const SUB_URL = `https://www.reddit.com/r/${SUB}/`;
// Structure as seen in a real walled browser: the sheet sits inside the modal.
const SHEET_HTML =
  '<rpl-dialog-sheet id="desktop-dynamic-upsell" open>Join the most real place on the internet</rpl-dialog-sheet>';
const WALL_HTML = `<desktop-dynamic-upsell-modal>${SHEET_HTML}</desktop-dynamic-upsell-modal>`;
const WALL_QUERY = 'desktop-dynamic-upsell-modal, #desktop-dynamic-upsell-dialog, rpl-dialog-sheet#desktop-dynamic-upsell';

let browser;
before(async () => { browser = await launchWithExtension(); });
after(async () => { await browser?.close(); });

async function poll(fn, { timeout = 10000, interval = 250, message } = {}) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    last = await fn();
    if (last) return last;
    await new Promise((r) => setTimeout(r, interval));
  }
  assert.fail(message || `condition not met within ${timeout}ms (last: ${JSON.stringify(last)})`);
}

/**
 * Open the subreddit with the feed cut down like a walled session.
 * wallInHtml: also put the popup + scroll lock into the server HTML.
 */
async function openSubreddit({ stripLoadMore = true, wallInHtml = false } = {}) {
  const page = await browser.context.newPage();
  const feedRequests = [];
  page.on('request', (r) => { if (r.url().includes('/svc/shreddit/community-more-posts/')) feedRequests.push(r.url()); });
  await page.route((url) => url.origin === 'https://www.reddit.com' && url.pathname === `/r/${SUB}/`, async (route) => {
    if (route.request().resourceType() !== 'document') return route.continue();
    const res = await route.fetch();
    let html = await res.text();
    if (stripLoadMore) {
      const n = html.length;
      html = html.replace(/<faceplate-partial[^>]*slot="load-after"[\s\S]*?<\/faceplate-partial>/, '');
      if (html.length === n && html.includes('slot="load-after"')) throw new Error('could not strip placeholder');
    }
    if (wallInHtml) {
      html = html.replace(/<body([^>]*)>/, (m, attrs) =>
        /class="/.test(attrs) ? m.replace('class="', 'class="rpl-scroll-lock ') : `<body${attrs} class="rpl-scroll-lock" style="overflow:hidden">`);
      html = html.replace('</body>', WALL_HTML + '</body>');
    }
    await route.fulfill({ response: res, body: html });
  });
  await page.goto(SUB_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('shreddit-feed article[data-post-id]');
  return { page, feedRequests };
}

const wallState = (page) => page.evaluate((q) => ({
  wall: !!document.querySelector(q),
  locked: document.body.classList.contains('rpl-scroll-lock') || getComputedStyle(document.body).overflow === 'hidden',
}), WALL_QUERY);

const feedState = (page) => page.evaluate(() => {
  const ids = [...document.querySelectorAll('shreddit-feed article[data-post-id]')].map((a) => a.dataset.postId);
  return { posts: ids.length, unique: new Set(ids).size, loadAfter: !!document.querySelector('shreddit-feed > faceplate-partial[slot="load-after"]') };
});

test('walled page: popup removed, scroll unlocked, infinite scroll restored', async () => {
  const { page, feedRequests } = await openSubreddit({ wallInHtml: true });
  try {
    await poll(async () => { const s = await wallState(page); return !s.wall && !s.locked && s; }, { message: 'wall not removed / scroll still locked' });

    const start = await feedState(page);
    assert.ok(start.posts <= 5, `expected a cut-down feed, got ${start.posts} posts`);
    assert.ok(start.loadAfter, 'extension should have added the load-after placeholder');
    // Reddit defines the spinner element lazily; it upgrades once its bundle loads.
    const spinner = await poll(() => page.evaluate(() => {
      const s = document.querySelector('shreddit-feed > faceplate-partial[slot="load-after"] > shreddit-feed-page-loading');
      return s && s.constructor !== HTMLElement && { pageType: s.getAttribute('page-type') };
    }), { message: 'placeholder should carry Reddit\'s (upgraded) loading spinner' });
    assert.equal(spinner.pageType, 'community');

    // Reddit virtualizes the feed (off-screen posts leave the DOM), so record every post id seen.
    await page.evaluate(() => {
      window.__seen = new Set();
      const grab = () => document.querySelectorAll('shreddit-feed article[data-post-id]').forEach((a) => window.__seen.add(a.dataset.postId));
      grab(); new MutationObserver(grab).observe(document.querySelector('shreddit-feed'), { childList: true, subtree: true });
    });
    const h0 = await page.evaluate(() => document.documentElement.scrollHeight);

    // Scroll until our placeholder's batch AND two of Reddit's own follow-up batches have loaded.
    await poll(async () => {
      await page.mouse.wheel(0, 4000);
      return feedRequests.length >= 3;
    }, { timeout: 60000, interval: 400, message: `infinite scroll stalled after ${feedRequests.length} feed requests` });
    await page.waitForTimeout(2000);

    const cursors = feedRequests.map((u) => new URL(u).searchParams.get('after'));
    const res = await page.evaluate(() => ({ seen: window.__seen.size, y: scrollY, h: document.documentElement.scrollHeight }));
    assert.ok(res.y > 1000, 'page did not scroll');
    assert.equal(new Set(cursors).size, cursors.length, `feed cursors repeat: ${cursors}`);
    assert.ok(res.seen > start.posts + 40, `expected 40+ new posts, saw ${res.seen}`);
    assert.ok(res.h > h0 * 2, 'page did not grow');
    console.log(`  posts seen: ${start.posts} -> ${res.seen}; feed requests: ${feedRequests.length}; height ${h0} -> ${res.h}`);
  } finally { await page.close(); }
});

test('popup inserted later: hidden by CSS immediately, then removed and scroll unlocked', async () => {
  const { page } = await openSubreddit();
  try {
    const sync = await page.evaluate((html) => {
      document.body.insertAdjacentHTML('beforeend', html);
      document.body.classList.add('rpl-scroll-lock');
      const el = document.querySelector('desktop-dynamic-upsell-modal');
      return { display: getComputedStyle(el).display, connected: el.isConnected };
    }, WALL_HTML);
    assert.deepEqual(sync, { display: 'none', connected: true }, 'CSS should hide the popup before the script runs');
    await poll(async () => { const s = await wallState(page); return !s.wall && !s.locked; }, { message: 'late popup not removed' });

    // Reddit re-applies the lock shortly after the popup: still lifted.
    await page.evaluate(() => document.body.classList.add('rpl-scroll-lock'));
    await poll(async () => !(await wallState(page)).locked, { message: 'late scroll lock not lifted' });

    // Popup shows again (e.g. after in-app navigation): removed again.
    await page.evaluate((html) => document.body.insertAdjacentHTML('beforeend', html), WALL_HTML);
    await poll(async () => !(await wallState(page)).wall, { message: 'repeat popup not removed' });

    assert.ok((await feedState(page)).loadAfter, 'load-after placeholder should be restored once the wall was seen');
  } finally { await page.close(); }
});

test('upsell sheet rendered on its own is removed too', async () => {
  const { page } = await openSubreddit();
  try {
    const display = await page.evaluate((html) => {
      document.body.insertAdjacentHTML('beforeend', html);
      document.body.classList.add('rpl-scroll-lock');
      return getComputedStyle(document.querySelector('rpl-dialog-sheet#desktop-dynamic-upsell')).display;
    }, SHEET_HTML);
    assert.equal(display, 'none', 'CSS should hide the standalone sheet');
    await poll(async () => { const s = await wallState(page); return !s.wall && !s.locked; }, { message: 'standalone sheet not removed' });
  } finally { await page.close(); }
});

test('no wall: other dialogs, scroll locks and feeds are left alone', async () => {
  const { page, feedRequests } = await openSubreddit();
  try {
    await page.evaluate(() => {
      document.body.insertAdjacentHTML('beforeend', '<rpl-dialog id="some-other-dialog" open>Other dialog</rpl-dialog>');
      document.body.classList.add('rpl-scroll-lock');
    });
    await page.waitForTimeout(1500);
    const s = await page.evaluate(() => ({
      other: !!document.querySelector('#some-other-dialog'),
      locked: document.body.classList.contains('rpl-scroll-lock'),
      loadAfter: !!document.querySelector('shreddit-feed > faceplate-partial[slot="load-after"]'),
    }));
    assert.deepEqual(s, { other: true, locked: true, loadAfter: false });
    assert.equal(feedRequests.length, 0, 'no feed requests expected without a wall');
  } finally { await page.close(); }
});

test('unwalled real page: Reddit\'s own placeholder is untouched', async () => {
  const { page } = await openSubreddit({ stripLoadMore: false });
  try {
    const ids = await page.evaluate(() => [...document.querySelectorAll('shreddit-feed > faceplate-partial[slot="load-after"]')].map((p) => p.id));
    assert.equal(ids.length, 1);
  } finally { await page.close(); }
});

/*
 * Reddit sign-up wall blocker.
 *
 * When Reddit walls a logged-out session it:
 *   1. shows an upsell popup,
 *   2. locks scrolling with body.rpl-scroll-lock,
 *   3. serves subreddit feeds without the "load more" placeholder
 *      (<faceplate-partial slot="load-after">), so infinite scroll stops after 3 posts.
 *
 * This script undoes all three and keeps doing so as Reddit swaps content in place.
 */
(() => {
  'use strict';

  // Only Reddit's sign-up wall. Never generic dialogs.
  const WALL_SELECTORS = [
    'desktop-dynamic-upsell-modal',
    '#desktop-dynamic-upsell-dialog',
    'rpl-dialog-sheet#desktop-dynamic-upsell', // inner sheet; usually inside the modal
    'shreddit-async-loader[bundlename*="desktop_dynamic_upsell"]',
    'faceplate-partial[src*="desktop-dynamic-upsell"]',
  ].join(',');

  // Mobile web: a *blocking* "get the app" bottom sheet. The <configured-xpromo-modal>
  // holds the sheet definition; its visible copy is rendered into a sibling element whose
  // id equals the sheet's dialog-id. Non-blocking app prompts are left alone.
  const MOBILE_BLOCKING_SHEET = 'rpl-bottom-sheet[blocking][dialog-id^="configured-xpromo-"]';

  const SCROLL_LOCK_CLASS = 'rpl-scroll-lock';
  const LOAD_AFTER = ':scope > faceplate-partial[slot="load-after"]';
  // Keep re-unlocking for a while after removing the wall: Reddit may apply the lock
  // slightly after inserting the popup.
  const UNLOCK_GRACE_MS = 5000;

  let wallSeen = false;      // the wall was removed at least once in this document
  let unlockUntil = 0;
  // Feeds we already primed. After the first placeholder, every batch Reddit returns
  // carries the next one, so re-injecting could only duplicate posts.
  const primedFeeds = new WeakSet();

  function removeWall() {
    const nodes = new Set(document.querySelectorAll(WALL_SELECTORS));
    for (const sheet of document.querySelectorAll(MOBILE_BLOCKING_SHEET)) {
      nodes.add(sheet.closest('configured-xpromo-modal') || sheet);
      const rendered = document.getElementById(sheet.getAttribute('dialog-id'));
      if (rendered) nodes.add(rendered);
    }
    if (!nodes.size) return false;
    nodes.forEach((n) => n.remove());
    wallSeen = true;
    unlockUntil = Date.now() + UNLOCK_GRACE_MS;
    return true;
  }

  function unlockScroll() {
    for (const el of [document.body, document.documentElement]) {
      if (!el) continue;
      el.classList.remove(SCROLL_LOCK_CLASS);
      for (const prop of ['overflow', 'overflow-y', 'position', 'top', 'padding-right']) {
        el.style.removeProperty(prop);
      }
    }
  }

  // /r/<sub>/[<sort>/] -> { sub, sort }; null for non-listing pages (posts, wiki, ...)
  // and for r/popular and r/all, which are aggregate feeds, not communities.
  function subredditListing() {
    const m = location.pathname.match(/^\/r\/([^/]+)\/?(?:(best|hot|new|top|rising|controversial)\/?)?$/i);
    if (!m || /^(popular|all)$/i.test(m[1])) return null;
    return { sub: m[1], sort: (m[2] || 'best').toLowerCase() };
  }

  // Aggregate feeds (front page, r/popular, r/all, news, ...) page through
  // /svc/shreddit/feeds/<name>-feed; the feed element names its endpoint in reload-url.
  function aggregateFeedUrl(feed, after, length) {
    const reload = feed.getAttribute('reload-url');
    if (!reload || !reload.startsWith('/svc/shreddit/feeds/')) return null;
    const url = new URL(reload, location.origin);
    url.searchParams.set('after', after);
    url.searchParams.set('cursor', after);
    url.searchParams.set('distance', String(length));
    const sessionId = feed.getAttribute('navigation-session-id');
    if (sessionId) url.searchParams.set('navigationSessionId', sessionId);
    return url.pathname + url.search;
  }

  function communityFeedUrl(feed, listing, after, length) {
    const params = new URLSearchParams({
      after,
      t: (new URLSearchParams(location.search).get('t') || 'DAY').toUpperCase(),
      name: listing.sub,
      feedLength: String(length),
    });
    const sessionId = feed.getAttribute('navigation-session-id');
    if (sessionId) params.set('navigationSessionId', sessionId);
    return `/svc/shreddit/community-more-posts/${listing.sort}/?${params}`;
  }

  function restoreLoadMore() {
    const listing = subredditListing();
    const feed = document.querySelector('shreddit-feed');
    if (!feed || primedFeeds.has(feed) || feed.querySelector(LOAD_AFTER)) return;

    let items = feed.querySelectorAll(':scope > article[data-post-id], :scope > shreddit-ad-post');
    let posts = feed.querySelectorAll(':scope > article[data-post-id]');
    let lastId = posts.length && posts[posts.length - 1].getAttribute('data-post-id'); // e.g. t3_1xnntvp
    if (!lastId) {
      // Layout fallback: any post element inside the feed.
      posts = items = feed.querySelectorAll('shreddit-post[id]');
      lastId = posts.length && posts[posts.length - 1].id;
    }
    if (!lastId) return;
    const after = btoa(lastId);
    const src = aggregateFeedUrl(feed, after, items.length) ||
      (listing && communityFeedUrl(feed, listing, after, items.length));
    if (!src) return;

    const partial = document.createElement('faceplate-partial');
    partial.id = 'partial-more-posts-' + after.replace(/=+$/, '');
    partial.setAttribute('slot', 'load-after');
    partial.setAttribute('loading', 'programmatic');
    partial.setAttribute('method', 'GET');
    partial.setAttribute('src', src);
    // Reddit's own loading spinner, as in its server-rendered placeholder.
    const spinner = document.createElement('shreddit-feed-page-loading');
    // 'community' for subreddits; for aggregate feeds the endpoint name, e.g. popular-feed -> 'popular'.
    const feedName = src.match(/^\/svc\/shreddit\/feeds\/([\w-]+)-feed\b/);
    spinner.setAttribute('page-type', feedName ? feedName[1] : 'community');
    spinner.setAttribute('length-of-feed', String(items.length));
    partial.appendChild(spinner);
    feed.appendChild(partial);
    primedFeeds.add(feed);
  }

  function run() {
    removeWall();
    if (!wallSeen) return;
    if (Date.now() < unlockUntil) unlockScroll();
    restoreLoadMore();
  }

  // Coalesce bursts of mutations into one pass per frame.
  let scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      run();
    });
  }

  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.type === 'childList' && m.addedNodes.length) return schedule();
      if (m.type === 'attributes' && m.target.classList?.contains(SCROLL_LOCK_CLASS)) {
        // Re-checked; the lock is only lifted again if a wall is present or was just removed.
        return schedule();
      }
    }
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class'],
  });

  // In-app navigations (Reddit is an SPA): new pages, new feeds.
  window.addEventListener('popstate', schedule);
  if (window.navigation) window.navigation.addEventListener('navigatesuccess', schedule);
  document.addEventListener('DOMContentLoaded', schedule);
  schedule();
})();

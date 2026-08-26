/**
 * extract_users.js
 *
 * Browser-console script for extracting commenters from a Facebook Page's
 * main feed while logged in.
 *
 * Strategy: scroll-and-process.  Instead of scrolling all the way down first
 * and then trying to find buttons that may have been unloaded from the DOM,
 * we interleave scrolling with extraction:
 *   1. After each scroll, scan for new "View more comments" buttons.
 *   2. Immediately click each new button, open the dialog, extract, close.
 *   3. Also pick up inline comments from posts without a dialog trigger.
 *   4. Continue scrolling until no new content appears or maxScrolls reached.
 *   5. Return deduplicated structured JSON.
 *
 * Usage (browser console):
 *   — paste the entire file, or
 *   — inject via CDP's Runtime.evaluate
 *   The IIFE at the bottom calls extractFacebookCommenters() automatically.
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Promise-based delay. */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  
  /**
   * Clean a Facebook profile URL.
   *  - /profile.php?id=XXXXX&tracking=... --> /profile.php?id=XXXXX
   *  - /username?comment_id=...&__cft__=... --> /username
   */
  function cleanProfileUrl(rawUrl) {
    try {
      const url = new URL(rawUrl);
  
      // Numeric-ID profiles: keep only the "id" query param.
      if (url.pathname === '/profile.php') {
        const id = url.searchParams.get('id');
        if (id) {
          return `https://www.facebook.com/profile.php?id=${id}`;
        }
        return `https://www.facebook.com/profile.php`;
      }
  
      // Vanity-username profiles: strip every query param.
      return `https://www.facebook.com${url.pathname}`;
    } catch (_) {
      return rawUrl;
    }
  }
  
  /**
   * Determine whether a link element is a commenter profile link.
   * Rejects empty text, time-pattern text (e.g. "15h", "1d", "2w", "3m"),
   * and links whose href points to posts, hashtags, or photos.
   */
  function isProfileLink(anchor) {
    const text = (anchor.textContent || '').trim();
    if (!text) return false;
  
    // Reject time patterns such as "15h", "1d", "2w", "3mo", "1y", "Just now".
    if (/^\d+[hdwmy]$/i.test(text) || /^just now$/i.test(text)) return false;
  
    const href = anchor.href || '';
    if (!href.includes('facebook.com/')) return false;
  
    // Reject non-profile destinations.
    const rejectPatterns = ['/posts/', '/hashtag/', '/photo/', '/photos/', '/videos/'];
    for (const pat of rejectPatterns) {
      if (href.includes(pat)) return false;
    }
  
    return true;
  }
  
  /**
   * Extract commenter data from a single comment article element.
   * Returns { name, profileUrl, comment } or null.
   */
  function parseCommentArticle(article) {
    const anchors = [...article.querySelectorAll('a')];
    const profileAnchor = anchors.find(isProfileLink);
    if (!profileAnchor) return null;
  
    const name = profileAnchor.textContent.trim();
    const profileUrl = cleanProfileUrl(profileAnchor.href);
  
    // Extract comment text.  The article's innerText contains the name,
    // comment body, timestamps, and button labels like "Like", "Reply".
    let comment = '';
    const fullText = article.innerText || '';
    const nameIdx = fullText.indexOf(name);
    if (nameIdx !== -1) {
      comment = fullText.slice(nameIdx + name.length).trim();
    } else {
      comment = fullText.trim();
    }
  
    // Strip trailing UI elements (timestamps, buttons).
    const uiNoise = /\n(?:\d+[hdwmy]|Just now|Like|React|Reply|Hide or report this|Edited|Report this)(?:\n|$)/gi;
    comment = comment.split(uiNoise)[0].trim();
  
    if (comment.length > 200) {
      comment = comment.slice(0, 200) + '...';
    }
  
    return { name, profileUrl, comment };
  }
  
  /**
   * Wait (poll) for at least one comment article to appear inside a dialog.
   */
  async function waitForDialogComments(timeoutMs = 8000) {
    const pollInterval = 300;
    let elapsed = 0;
    while (elapsed < timeoutMs) {
      const found = document.querySelector(
        '[role="dialog"] [role="article"][aria-label^="Comment by"]'
      );
      if (found) return true;
      await sleep(pollInterval);
      elapsed += pollInterval;
    }
    return false;
  }
  
  /**
   * Close the currently open dialog.
   * First tries clicking the Close button; falls back to pressing Escape.
   */
  async function closeDialog() {
    const closeBtn = document.querySelector('[role="dialog"] [aria-label="Close"]');
    if (closeBtn) {
      closeBtn.click();
      await sleep(500);
      if (!document.querySelector('[role="dialog"]')) return;
    }
  
    document.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Escape',
      code: 'Escape',
      keyCode: 27,
      which: 27,
      bubbles: true,
    }));
    await sleep(500);
  }
  
  /**
   * Extract comments from the currently open dialog.
   * Returns an array of { name, profileUrl, comment }.
   */
  async function extractFromDialog() {
    const dialogLoaded = await waitForDialogComments(8000);
    if (!dialogLoaded) {
      await closeDialog();
      return [];
    }
  
    // Scroll inside the dialog to load all lazy-loaded comments.
    const dialog = document.querySelector('[role="dialog"]');
    if (dialog) {
      const scrollable = dialog.querySelector('[style*="overflow"]') || dialog;
      for (let s = 0; s < 5; s++) {
        scrollable.scrollTop = scrollable.scrollHeight;
        await sleep(800);
      }
    }
  
    const commentArticles = [
      ...document.querySelectorAll(
        '[role="dialog"] [role="article"][aria-label^="Comment by"]'
      ),
    ];
  
    const postComments = [];
    const seen = new Set();
  
    for (const article of commentArticles) {
      const data = parseCommentArticle(article);
      if (!data) continue;
      const dedupKey = `${data.name}|||${data.profileUrl}`;
      if (seen.has(dedupKey)) continue;
      seen.add(dedupKey);
      postComments.push(data);
    }
  
    await closeDialog();
    return postComments;
  }
  
  /**
   * Find all currently-visible "View more comments" buttons in the feed
   * (excluding any inside dialogs).
   */
  function findViewMoreButtons() {
    return [...document.querySelectorAll('[role="button"]')]
      .filter(b => {
        if (b.closest('[role="dialog"]')) return false;
        return b.textContent.trim() === 'View more comments';
      });
  }
  
  /**
   * Collect inline comment articles that are currently in the DOM
   * (not inside a dialog).
   */
  function findInlineComments() {
    return [...document.querySelectorAll(
      '[role="article"][aria-label^="Comment by"]'
    )].filter(el => !el.closest('[role="dialog"]'));
  }
  
  // ---------------------------------------------------------------------------
  // Main extraction function
  // ---------------------------------------------------------------------------
  
  /**
   * Scroll-and-process: scroll the page incrementally, processing each
   * "View more comments" button as soon as it appears. Also captures
   * inline comments from posts without that button.
   *
 * @param {{ maxScrolls?: number, scrollPauseMs?: number, maxPosts?: number }} options
 * @returns {Array<Object>} — array of post objects, each with `comments`.
 */
  async function extractFacebookCommenters(options = {}) {
    const {
      maxScrolls = 15,
      scrollPauseMs = 2000,
      maxPosts = Number.POSITIVE_INFINITY,
    } = options;
    const results = [];
    let postCounter = 0;
    const normalizedMaxPosts =
      Number.isFinite(maxPosts) && maxPosts > 0
        ? Math.floor(maxPosts)
        : Number.POSITIVE_INFINITY;
  
    // Track which buttons and inline comments we've already processed
    // so we don't double-count across scroll iterations.
    const processedButtons = new Set();      // WeakRef-safe: DOM elements
    const processedCommentKeys = new Set();  // "name|||profileUrl" strings
    // Track which inline comment articles we've already seen.
    const processedInlineArticles = new Set();
  
    console.log(`[extract_users] Starting scroll-and-process (up to ${maxScrolls} scrolls)...`);
  
    outer: for (let scrollIdx = 0; scrollIdx < maxScrolls; scrollIdx++) {
      // ----------------------------------------------------------------
      // A) Find and process any new "View more comments" buttons.
      // ----------------------------------------------------------------
      const currentButtons = findViewMoreButtons();
      const newButtons = currentButtons.filter(b => !processedButtons.has(b));

      for (const btn of newButtons) {
        if (postCounter >= normalizedMaxPosts) {
          console.log(`[extract_users] Reached post limit (${normalizedMaxPosts}). Stopping extraction.`);
          break outer;
        }
        processedButtons.add(btn);
        postCounter++;
        const postIndex = postCounter;
  
        console.log(
          `[extract_users] [scroll ${scrollIdx + 1}] Post ${postIndex}: clicking "View more comments"...`
        );
  
        try {
          // Scroll button into view and click.
          btn.scrollIntoView({ behavior: 'smooth', block: 'center' });
          await sleep(500);
          btn.click();
  
          const comments = await extractFromDialog();
  
          // Tag each comment with postIndex.
          const postComments = comments.map(c => ({ ...c, postIndex }));
  
          // Track globally for dedup.
          for (const c of postComments) {
            processedCommentKeys.add(`${c.name}|||${c.profileUrl}`);
          }
  
          if (postComments.length > 0) {
            results.push({ postIndex, comments: postComments });
            console.log(
              `[extract_users]   → ${postComments.length} commenters extracted.`
            );
          } else {
            console.log(`[extract_users]   → No comments found in dialog.`);
          }
  
          await sleep(300);
        } catch (err) {
          console.error(
            `[extract_users] Error processing post ${postIndex}:`, err
          );
          try { await closeDialog(); } catch (_) {}
        }
      }
  
      // ----------------------------------------------------------------
      // B) Pick up inline comments (posts with few comments, no dialog).
      //    We collect these on every scroll pass to catch newly-loaded ones.
      // ----------------------------------------------------------------
      const inlineArticles = findInlineComments()
        .filter(el => !processedInlineArticles.has(el));
  
      // Group by post ancestor (heuristic: walk up ~10 levels).
      const postGroups = new Map();
      for (const article of inlineArticles) {
        // Check if this comment's post also has a "View more comments" button
        // (i.e. already handled via dialog). Walk up 15 levels to see if any
        // processed button shares the same subtree.
        let belongsToDialogPost = false;
        for (const btn of processedButtons) {
          let ancestor = article.parentElement;
          for (let i = 0; i < 15 && ancestor; i++) {
            if (ancestor.contains(btn)) { belongsToDialogPost = true; break; }
            ancestor = ancestor.parentElement;
          }
          if (belongsToDialogPost) break;
        }
        if (belongsToDialogPost) {
          processedInlineArticles.add(article);
          continue;
        }
  
        // Walk up ~10 levels to find a post-level grouping ancestor.
        let groupKey = article;
        for (let i = 0; i < 10 && groupKey.parentElement; i++) {
          groupKey = groupKey.parentElement;
        }
  
        if (!postGroups.has(groupKey)) postGroups.set(groupKey, []);
        postGroups.get(groupKey).push(article);
      }

      for (const [, articles] of postGroups) {
        if (postCounter >= normalizedMaxPosts) {
          console.log(`[extract_users] Reached post limit (${normalizedMaxPosts}). Stopping extraction.`);
          break outer;
        }
        const postComments = [];
        const seen = new Set();
  
        for (const article of articles) {
          processedInlineArticles.add(article);
          const data = parseCommentArticle(article);
          if (!data) continue;
  
          const dedupKey = `${data.name}|||${data.profileUrl}`;
          if (seen.has(dedupKey) || processedCommentKeys.has(dedupKey)) continue;
          seen.add(dedupKey);
          processedCommentKeys.add(dedupKey);
          postComments.push(data);
        }
  
        if (postComments.length > 0) {
          postCounter++;
          const postIndex = postCounter;
          results.push({
            postIndex,
            comments: postComments.map(c => ({ ...c, postIndex })),
          });
          console.log(
            `[extract_users] [scroll ${scrollIdx + 1}] Post ${postIndex} (inline): ${postComments.length} commenters.`
          );
        }
      }
  
      // ----------------------------------------------------------------
      // C) Scroll down to load more content.
      // ----------------------------------------------------------------
      const prevHeight = document.documentElement.scrollHeight;
      window.scrollBy(0, window.innerHeight);
      console.log(`[extract_users] Scrolled (${scrollIdx + 1}/${maxScrolls})...`);
      await sleep(scrollPauseMs);
  
      // Check if we've reached the bottom (no new content loaded).
      const newHeight = document.documentElement.scrollHeight;
      if (newHeight === prevHeight) {
        // Give it one more try — sometimes content loads slowly.
        await sleep(scrollPauseMs);
        const retryHeight = document.documentElement.scrollHeight;
        if (retryHeight === prevHeight) {
          console.log('[extract_users] No more content. Stopping scroll.');
          break;
        }
      }
    }
  
    // ------------------------------------------------------------------
    // Final summary
    // ------------------------------------------------------------------
    const totalComments = results.reduce((sum, p) => sum + p.comments.length, 0);
    console.log('=========================================================');
    console.log(`[extract_users] Extraction complete.`);
    console.log(`[extract_users] Posts processed : ${results.length}`);
    console.log(`[extract_users] Total commenters: ${totalComments}`);
    console.log('=========================================================');
  
    for (const post of results) {
      console.log(`\n--- Post ${post.postIndex} (${post.comments.length} commenters) ---`);
      for (const c of post.comments) {
        console.log(`  ${c.name}  |  ${c.profileUrl}`);
        if (c.comment) {
          console.log(`    "${c.comment}"`);
        }
      }
    }
  
    console.log('\n[extract_users] Full JSON output:');
    console.log(JSON.stringify(results, null, 2));
  
    return results;
  }
  
  // ---------------------------------------------------------------------------
  // Auto-invoke
  // ---------------------------------------------------------------------------
  if (globalThis.__ROME_FACEBOOK_EXTRACT_USERS_AUTORUN__ !== false) {
    extractFacebookCommenters().catch(err => {
      console.error('[extract_users] Autorun failed:', err);
    });
  }
  

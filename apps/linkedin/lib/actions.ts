import type {
  Action,
  ActionConfig,
  ActionResult,
  BrowserCapabilityDiscovery,
} from "@rome-os/app-runtime";
import { detectConnectionState, STATE_BUTTON_MAP } from "./connection.js";
import { openBrowserPage, sleep, type LinkedinPage } from "./browser.js";
import {
  COMPANY_SECTIONS,
  PERSON_SECTIONS,
  type CompanySectionName,
  type PersonSectionName,
  parseCompanySections,
  parsePersonSections,
} from "./fields.js";
import {
  buildReferences,
  dedupeReferences,
  type RawReference,
  type Reference,
} from "./link-metadata.js";

const RATE_LIMITED_MSG =
  "[Rate limited] LinkedIn blocked this section. Try again later or request fewer sections.";
const LINKEDIN_HOST = "https://www.linkedin.com";
const PAGE_SIZE = 25;
const NAV_DELAY_MS = 2_000;
const RATE_LIMIT_RETRY_DELAY_MS = 5_000;

const DIALOG_SELECTOR = 'dialog[open], [role="dialog"]';
const DIALOG_TEXTAREA_SELECTOR = '[role="dialog"] textarea, dialog textarea';
const DIALOG_BUTTON_SELECTOR =
  'dialog[open] button, dialog[open] [role="button"], [role="dialog"] button, [role="dialog"] [role="button"]';
const MESSAGING_COMPOSE_LINK_SELECTOR = 'main a[href*="/messaging/compose/"]';
const MESSAGING_COMPOSE_FALLBACK_SELECTORS = [
  'div[role="textbox"][contenteditable="true"][aria-label*="Write a message"]',
  'main div[role="textbox"][contenteditable="true"]',
  'main [contenteditable="true"][aria-label*="message"]',
];
const MESSAGING_ENABLED_SEND_SELECTOR =
  'button[type="submit"]:not([disabled]), button[aria-label*="Send"]:not([disabled]), button[aria-label*="send"]:not([disabled])';
const MESSAGING_RECIPIENT_PICKER_SELECTOR =
  'input[placeholder*="Type a name"], input[aria-label*="Type a name"], input[placeholder*="multiple names"]';
const MESSAGING_CLOSE_SELECTOR =
  'button[aria-label*="Close your draft conversation"], button[aria-label="Dismiss"], button[aria-label*="Dismiss"], button[aria-label*="Close"]';
const MESSAGING_SEARCH_SELECTOR =
  'input[role="searchbox"], input[placeholder*="Search messages"], input[aria-label*="Search messages"], input[type="search"]';

const DATE_POSTED_MAP: Record<string, string> = {
  past_hour: "r3600",
  past_24_hours: "r86400",
  past_week: "r604800",
  past_month: "r2592000",
};

const EXPERIENCE_LEVEL_MAP: Record<string, string> = {
  internship: "1",
  entry: "2",
  associate: "3",
  mid_senior: "4",
  director: "5",
  executive: "6",
};

const JOB_TYPE_MAP: Record<string, string> = {
  full_time: "F",
  part_time: "P",
  contract: "C",
  temporary: "T",
  volunteer: "V",
  internship: "I",
  other: "O",
};

const WORK_TYPE_MAP: Record<string, string> = {
  on_site: "1",
  remote: "2",
  hybrid: "3",
};

const SORT_BY_MAP: Record<string, string> = {
  date: "DD",
  relevance: "R",
};

const NOISE_MARKERS = [
  /^About\n+(?:Accessibility|Talent Solutions)/m,
  /^More profiles for you$/m,
  /^Explore premium profiles$/m,
  /^Get up to .+ replies when you message with InMail$/m,
  /^(?:Careers|Privacy & Terms|Questions\?|Select language)\n+(?:Privacy & Terms|Questions\?|Select language|Advertising|Ad Choices|[A-Za-z]+ \([A-Za-z]+\))/m,
];

const NOISE_LINES = [
  /^(?:Play|Pause|Playback speed|Turn fullscreen on|Fullscreen)$/u,
  /^(?:Show captions|Close modal window|Media player modal window)$/u,
  /^(?:Loaded:.*|Remaining time.*|Stream Type.*)$/u,
];

export interface LinkedinActionDeps {
  capabilityDiscovery: BrowserCapabilityDiscovery;
}

interface ExtractedSection {
  text: string;
  references: RawReference[];
  error?: Record<string, unknown>;
}

type OperationDefinition = {
  inputSchema: Record<string, unknown>;
  sideEffects?: ActionConfig["sideEffects"];
  execute: (args: Record<string, unknown>, deps: LinkedinActionDeps) => Promise<unknown>;
};

const OPERATIONS: Record<string, OperationDefinition> = {
  "get-person-profile": {
    inputSchema: {
      type: "object",
      properties: {
        linkedin_username: { type: "string", description: "LinkedIn username" },
        sections: {
          type: "string",
          description:
            "Comma-separated extra sections: experience, education, interests, honors, languages, contact_info, posts",
        },
      },
      required: ["linkedin_username"],
    },
    sideEffects: "read-only",
    execute: async (args, deps) => {
      const linkedinUsername = requireString(args, ["linkedin_username", "linkedinUsername"]);
      const sections = optionalString(args, ["sections"]);
      const parsed = parsePersonSections(sections);
      return await withTemporaryPage(deps.capabilityDiscovery, async (page) => {
        const result = await scrapePerson(page, linkedinUsername, parsed.requested);
        if (parsed.unknown.length > 0) {
          return { ...result, unknown_sections: parsed.unknown };
        }
        return result;
      });
    },
  },
  "search-people": {
    inputSchema: {
      type: "object",
      properties: {
        keywords: { type: "string" },
        location: { type: "string" },
      },
      required: ["keywords"],
    },
    sideEffects: "read-only",
    execute: async (args, deps) => {
      const keywords = requireString(args, ["keywords"]);
      const location = optionalString(args, ["location"]);
      return await withTemporaryPage(deps.capabilityDiscovery, async (page) => {
        const params = new URLSearchParams({ keywords });
        if (location) {
          params.set("location", location);
        }
        return await extractSingleSectionResult(
          page,
          `${LINKEDIN_HOST}/search/results/people/?${params.toString()}`,
          "search_results",
        );
      });
    },
  },
  "connect-with-person": {
    inputSchema: {
      type: "object",
      properties: {
        linkedin_username: { type: "string" },
        note: { type: "string", description: "Optional connection note" },
      },
      required: ["linkedin_username"],
    },
    sideEffects: "write",
    execute: async (args, deps) => {
      const linkedinUsername = requireString(args, ["linkedin_username", "linkedinUsername"]);
      const note = optionalString(args, ["note"]);
      return await withTemporaryPage(deps.capabilityDiscovery, async (page) => {
        const url = `${LINKEDIN_HOST}/in/${linkedinUsername}/`;
        const profile = await scrapePerson(page, linkedinUsername, new Set(["main_profile"]));
        const profileSections =
          profile.sections && typeof profile.sections === "object" ?
            (profile.sections as Record<string, unknown>)
          : {};
        const pageText = String(profileSections.main_profile ?? "");
        if (!pageText) {
          return connectionResult(url, "unavailable", "Could not read profile page.");
        }

        let state = detectConnectionState(pageText);
        let viaMoreMenu = false;

        if (state === "already_connected") {
          return connectionResult(
            url,
            "already_connected",
            "You are already connected with this profile.",
            { profile: pageText },
          );
        }
        if (state === "pending") {
          return connectionResult(
            url,
            "pending",
            "A connection request is already pending for this profile.",
            { profile: pageText },
          );
        }

        if (state === "follow_only") {
          if (await openMoreMenu(page)) {
            state = "connectable";
            viaMoreMenu = true;
          } else {
            return connectionResult(
              url,
              "follow_only",
              "This profile currently exposes Follow but not Connect.",
              { profile: pageText },
            );
          }
        }

        if (state === "unavailable") {
          return connectionResult(
            url,
            "connect_unavailable",
            "LinkedIn did not expose a usable Connect action for this profile.",
            { profile: pageText },
          );
        }

        const buttonText = STATE_BUTTON_MAP[state];
        if (!buttonText) {
          return connectionResult(
            url,
            "connect_unavailable",
            `No button mapping for state '${state}'.`,
          );
        }

        const clicked = await page.clickByText(buttonText, viaMoreMenu ? "[role='menu']" : "main");
        if (!clicked) {
          return connectionResult(
            url,
            "send_failed",
            `Could not find or click button '${buttonText}'.`,
          );
        }

        if (state === "connectable") {
          await waitForDialog(page, 3_000);
        }

        let noteSent = false;
        if (note && (await dialogIsOpen(page))) {
          if (!(await isSelectorVisible(page, DIALOG_TEXTAREA_SELECTOR))) {
            await clickFirstDialogButton(page);
          }

          if (await isSelectorVisible(page, DIALOG_TEXTAREA_SELECTOR)) {
            await page.inputText(DIALOG_TEXTAREA_SELECTOR, note);
            noteSent = true;
          } else {
            await dismissDialog(page);
            return connectionResult(
              url,
              "note_not_supported",
              "LinkedIn did not offer note entry for this connection flow.",
            );
          }
        }

        if (await dialogIsOpen(page)) {
          const sent = await clickDialogPrimaryButton(page);
          if (!sent) {
            await dismissDialog(page);
            return connectionResult(
              url,
              "send_failed",
              "Could not find the send button in the dialog.",
            );
          }
          await waitUntilHidden(page, DIALOG_SELECTOR, 5_000);
        }

        const updatedText = await getMainText(page);
        const status = state === "incoming_request" ? "accepted" : "connected";
        return connectionResult(
          url,
          status,
          status === "connected" ? "Connection request sent." : "Connection request accepted.",
          {
            note_sent: noteSent,
            profile: updatedText,
          },
        );
      });
    },
  },
  "get-sidebar-profiles": {
    inputSchema: {
      type: "object",
      properties: {
        linkedin_username: { type: "string" },
      },
      required: ["linkedin_username"],
    },
    sideEffects: "read-only",
    execute: async (args, deps) => {
      const linkedinUsername = requireString(args, ["linkedin_username", "linkedinUsername"]);
      return await withTemporaryPage(deps.capabilityDiscovery, async (page) => {
        const url = `${LINKEDIN_HOST}/in/${linkedinUsername}/`;
        await page.navigate(url);
        await assertLinkedinPageUsable(page, url);
        await waitForMainText(page, 80, 10_000);

        const sidebarData = await page.evaluateByValue<{
          sections: Record<string, string[]>;
          showAllUrls: Record<string, string>;
        }>(`
          (() => {
            const SIDEBAR_SECTIONS = [
              "More profiles for you",
              "Explore premium profiles",
              "People you may know",
            ];
            const normalize = (text) => (text || "").replace(/\\s+/g, " ").trim();
            const slugify = (text) => text.toLowerCase().replace(/\\s+/g, "_");
            const extractProfilePath = (href) => {
              if (!href) return null;
              const idx = href.indexOf("/in/");
              if (idx === -1) return null;
              const rest = href.slice(idx + 4);
              const end = rest.search(/[/?#]/);
              const username = end === -1 ? rest : rest.slice(0, end);
              return username ? "/in/" + username + "/" : null;
            };

            const sections = {};
            const showAllUrls = {};
            const headings = Array.from(document.querySelectorAll("h1, h2, h3"));

            for (const heading of headings) {
              const headingText = normalize(heading.innerText || heading.textContent);
              if (!SIDEBAR_SECTIONS.includes(headingText)) continue;

              const sectionKey = slugify(headingText);
              let container = heading.parentElement;
              let foundSection = false;
              for (let depth = 0; container && depth < 5; depth += 1) {
                const tag = container.tagName.toLowerCase();
                if (tag === "section" || tag === "aside") {
                  foundSection = true;
                  break;
                }
                container = container.parentElement;
              }
              if (!container || !foundSection) continue;

              const seen = new Set();
              const profileLinks = [];
              for (const anchor of container.querySelectorAll('a[href*="/in/"]')) {
                const path = extractProfilePath(anchor.getAttribute("href"));
                if (path && !seen.has(path)) {
                  seen.add(path);
                  profileLinks.push(path);
                }
              }

              let showAll = null;
              for (const anchor of container.querySelectorAll("a")) {
                const text = normalize(anchor.innerText || anchor.textContent).toLowerCase();
                if (text.startsWith("show all") || text.startsWith("see all")) {
                  showAll = anchor.href || anchor.getAttribute("href");
                  break;
                }
              }

              sections[sectionKey] = profileLinks;
              if (showAll) {
                showAllUrls[sectionKey] = showAll;
              }
            }

            return { sections, showAllUrls };
          })()
        `);

        const sidebarProfiles = { ...sidebarData.sections };
        let firstShowAll = true;

        for (const [sectionKey, showAllUrl] of Object.entries(sidebarData.showAllUrls)) {
          if (showAllUrl.includes("/premium")) {
            continue;
          }

          if (!firstShowAll) {
            await sleep(NAV_DELAY_MS);
          }
          firstShowAll = false;

          await page.navigate(showAllUrl);
          await assertLinkedinPageUsable(page, showAllUrl);
          if ((await currentUrl(page)).includes("/premium")) {
            continue;
          }

          await waitForMainText(page, 80, 10_000);
          const expandedLinks = await page.evaluateByValue<string[]>(`
            (() => {
              const extractProfilePath = (href) => {
                if (!href) return null;
                const idx = href.indexOf("/in/");
                if (idx === -1) return null;
                const rest = href.slice(idx + 4);
                const end = rest.search(/[/?#]/);
                const username = end === -1 ? rest : rest.slice(0, end);
                return username ? "/in/" + username + "/" : null;
              };

              const seen = new Set();
              const links = [];
              for (const anchor of document.querySelectorAll('main a[href*="/in/"]')) {
                const path = extractProfilePath(anchor.getAttribute("href"));
                if (path && !seen.has(path)) {
                  seen.add(path);
                  links.push(path);
                }
              }
              return links;
            })()
          `);

          const existing = sidebarProfiles[sectionKey] ?? [];
          const seen = new Set(existing);
          for (const link of expandedLinks) {
            if (!seen.has(link)) {
              seen.add(link);
              existing.push(link);
            }
          }
          sidebarProfiles[sectionKey] = existing;
        }

        return {
          url,
          sidebar_profiles: sidebarProfiles,
        };
      });
    },
  },
  "get-company-profile": {
    inputSchema: {
      type: "object",
      properties: {
        company_name: { type: "string" },
        sections: { type: "string", description: "Comma-separated extra sections: posts,jobs" },
      },
      required: ["company_name"],
    },
    sideEffects: "read-only",
    execute: async (args, deps) => {
      const companyName = requireString(args, ["company_name", "companyName"]);
      const sections = optionalString(args, ["sections"]);
      const parsed = parseCompanySections(sections);
      return await withTemporaryPage(deps.capabilityDiscovery, async (page) => {
        const result = await scrapeCompany(page, companyName, parsed.requested);
        if (parsed.unknown.length > 0) {
          return { ...result, unknown_sections: parsed.unknown };
        }
        return result;
      });
    },
  },
  "get-company-posts": {
    inputSchema: {
      type: "object",
      properties: {
        company_name: { type: "string" },
      },
      required: ["company_name"],
    },
    sideEffects: "read-only",
    execute: async (args, deps) => {
      const companyName = requireString(args, ["company_name", "companyName"]);
      return await withTemporaryPage(deps.capabilityDiscovery, async (page) => {
        return await extractSingleSectionResult(
          page,
          `${LINKEDIN_HOST}/company/${encodeURIComponent(companyName)}/posts/`,
          "posts",
        );
      });
    },
  },
  "get-job-details": {
    inputSchema: {
      type: "object",
      properties: {
        job_id: { type: "string" },
      },
      required: ["job_id"],
    },
    sideEffects: "read-only",
    execute: async (args, deps) => {
      const jobId = requireString(args, ["job_id", "jobId"]);
      return await withTemporaryPage(deps.capabilityDiscovery, async (page) => {
        return await extractSingleSectionResult(
          page,
          `${LINKEDIN_HOST}/jobs/view/${encodeURIComponent(jobId)}/`,
          "job_posting",
        );
      });
    },
  },
  "search-jobs": {
    inputSchema: {
      type: "object",
      properties: {
        keywords: { type: "string" },
        location: { type: "string" },
        max_pages: { type: "number" },
        date_posted: { type: "string" },
        job_type: { type: "string" },
        experience_level: { type: "string" },
        work_type: { type: "string" },
        easy_apply: { type: "boolean" },
        sort_by: { type: "string" },
      },
      required: ["keywords"],
    },
    sideEffects: "read-only",
    execute: async (args, deps) => {
      const keywords = requireString(args, ["keywords"]);
      const location = optionalString(args, ["location"]);
      const maxPages = clampInteger(optionalNumber(args, ["max_pages", "maxPages"]) ?? 3, 1, 10);
      const datePosted = optionalString(args, ["date_posted", "datePosted"]);
      const jobType = optionalString(args, ["job_type", "jobType"]);
      const experienceLevel = optionalString(args, ["experience_level", "experienceLevel"]);
      const workType = optionalString(args, ["work_type", "workType"]);
      const easyApply = optionalBoolean(args, ["easy_apply", "easyApply"]) ?? false;
      const sortBy = optionalString(args, ["sort_by", "sortBy"]);

      return await withTemporaryPage(deps.capabilityDiscovery, async (page) => {
        const baseUrl = buildJobSearchUrl({
          keywords,
          location,
          date_posted: datePosted,
          job_type: jobType,
          experience_level: experienceLevel,
          work_type: workType,
          easy_apply: easyApply,
          sort_by: sortBy,
        });

        const allJobIds: string[] = [];
        const seenIds = new Set<string>();
        const pageTexts: string[] = [];
        const pageReferences: Reference[] = [];
        const sectionErrors: Record<string, unknown> = {};
        let totalPages: number | null = null;
        let totalPagesQueried = false;

        for (let pageNum = 0; pageNum < maxPages; pageNum += 1) {
          if (totalPages !== null && pageNum >= totalPages) {
            break;
          }
          if (pageNum > 0) {
            await sleep(NAV_DELAY_MS);
          }

          const url = pageNum === 0 ? baseUrl : `${baseUrl}&start=${pageNum * PAGE_SIZE}`;
          const extracted = await extractPage(page, url, "search_results", {
            rootSelectors: ["main"],
            waitForMainLength: 100,
            scrollBehavior: "main_bottom",
            scrollAttempts: 5,
          });

          if (!extracted.text || extracted.text === RATE_LIMITED_MSG) {
            if (extracted.error) {
              sectionErrors.search_results = extracted.error;
            }
            break;
          }

          if (!totalPagesQueried) {
            totalPagesQueried = true;
            totalPages = await getTotalSearchPages(page);
          }

          const pageIds = await extractJobIds(page);
          const newIds = pageIds.filter((id) => !seenIds.has(id));
          if (newIds.length === 0) {
            pageTexts.push(extracted.text);
            pageReferences.push(...buildReferences(extracted.references, "search_results"));
            break;
          }

          for (const id of newIds) {
            seenIds.add(id);
            allJobIds.push(id);
          }

          pageTexts.push(extracted.text);
          pageReferences.push(...buildReferences(extracted.references, "search_results"));
        }

        const result: Record<string, unknown> = {
          url: baseUrl,
          sections: pageTexts.length > 0 ? { search_results: pageTexts.join("\n---\n") } : {},
          job_ids: allJobIds,
        };
        if (pageReferences.length > 0) {
          result.references = {
            search_results: dedupeReferences(pageReferences, 15),
          };
        }
        if (Object.keys(sectionErrors).length > 0) {
          result.section_errors = sectionErrors;
        }
        return result;
      });
    },
  },
  "get-inbox": {
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number" },
      },
    },
    sideEffects: "read-only",
    execute: async (args, deps) => {
      const limit = clampInteger(optionalNumber(args, ["limit"]) ?? 20, 1, 50);
      return await withTemporaryPage(deps.capabilityDiscovery, async (page) => {
        const url = `${LINKEDIN_HOST}/messaging/`;
        await page.navigate(url);
        await assertLinkedinPageUsable(page, url);
        await waitForMainText(page, 80, 12_000);
        await scrollMainScrollableRegion(page, "bottom", Math.max(1, Math.ceil(limit / 10)), 500);

        const rawResult = await extractRootContent(page, ["main"]);
        const cleaned = stripLinkedinNoise(rawResult.text);
        const extractedReferences = cleaned ? buildReferences(rawResult.references, "inbox") : [];
        const conversationRefs = await extractConversationThreadRefs(page, limit);
        const references = dedupeReferences([...conversationRefs, ...extractedReferences], 30);

        return singleSectionResult(url, "inbox", cleaned, references);
      });
    },
  },
  "get-conversation": {
    inputSchema: {
      type: "object",
      properties: {
        linkedin_username: { type: "string" },
        thread_id: { type: "string" },
      },
    },
    sideEffects: "read-only",
    execute: async (args, deps) => {
      const linkedinUsername = optionalString(args, ["linkedin_username", "linkedinUsername"]);
      const threadId = optionalString(args, ["thread_id", "threadId"]);
      if (!linkedinUsername && !threadId) {
        throw new Error("Provide at least one of linkedin_username or thread_id");
      }

      return await withTemporaryPage(deps.capabilityDiscovery, async (page) => {
        if (threadId) {
          await page.navigate(`${LINKEDIN_HOST}/messaging/thread/${encodeURIComponent(threadId)}/`);
        } else {
          await openConversationByUsername(page, linkedinUsername!);
        }

        await assertLinkedinPageUsable(page);
        await waitForMainText(page, 80, 12_000);
        await scrollMainScrollableRegion(page, "top", 3, 500);

        const rawResult = await extractRootContent(page, ["main"]);
        const cleaned = stripLinkedinNoise(rawResult.text);
        const references = cleaned ? buildReferences(rawResult.references, "conversation") : [];
        return singleSectionResult(await currentUrl(page), "conversation", cleaned, references);
      });
    },
  },
  "search-conversations": {
    inputSchema: {
      type: "object",
      properties: {
        keywords: { type: "string" },
      },
      required: ["keywords"],
    },
    sideEffects: "read-only",
    execute: async (args, deps) => {
      const keywords = requireString(args, ["keywords"]);
      return await withTemporaryPage(deps.capabilityDiscovery, async (page) => {
        await page.navigate(`${LINKEDIN_HOST}/messaging/`);
        await assertLinkedinPageUsable(page);
        await fillMessagingSearch(page, keywords);
        await waitForMainText(page, 80, 12_000);

        const rawResult = await extractRootContent(page, ["main"]);
        const cleaned = stripLinkedinNoise(rawResult.text);
        const references = cleaned ? buildReferences(rawResult.references, "search_results") : [];
        return singleSectionResult(await currentUrl(page), "search_results", cleaned, references);
      });
    },
  },
  "send-message": {
    inputSchema: {
      type: "object",
      properties: {
        linkedin_username: { type: "string" },
        message: { type: "string" },
        confirm_send: { type: "boolean" },
        profile_urn: { type: "string" },
      },
      required: ["linkedin_username", "message", "confirm_send"],
    },
    sideEffects: "write",
    execute: async (args, deps) => {
      const linkedinUsername = requireString(args, ["linkedin_username", "linkedinUsername"]);
      const message = requireString(args, ["message"]);
      const confirmSend = requireBoolean(args, ["confirm_send", "confirmSend"]);
      const profileUrn = optionalString(args, ["profile_urn", "profileUrn"]);

      return await withTemporaryPage(deps.capabilityDiscovery, async (page) => {
        const profileUrl = `${LINKEDIN_HOST}/in/${linkedinUsername}/`;
        await page.navigate(profileUrl);
        await assertLinkedinPageUsable(page, profileUrl);
        await waitForMainText(page, 80, 10_000);

        const displayName = await readProfileDisplayName(page);
        const composeUrl =
          profileUrn ?
            `${LINKEDIN_HOST}/messaging/compose/?recipient=${encodeURIComponent(profileUrn)}`
          : await resolveMessageComposeHref(page);

        if (!composeUrl) {
          return messageActionResult(
            profileUrl,
            "message_unavailable",
            "LinkedIn did not expose a usable Message action for this profile.",
          );
        }

        await page.navigate(composeUrl);
        await assertLinkedinPageUsable(page, composeUrl);
        await waitForMainText(page, 40, 10_000);

        let messageSurface = await waitForMessageSurface(page);
        let recipientSelected = false;

        if (messageSurface === "recipient_picker") {
          recipientSelected = await selectMessageRecipient(page, displayName ?? "", linkedinUsername);
          if (!recipientSelected) {
            await dismissMessageUi(page);
            return messageActionResult(
              await currentUrl(page),
              "recipient_resolution_failed",
              "LinkedIn opened a compose page, but the visible recipient did not match the requested profile.",
            );
          }
          messageSurface = await waitForMessageSurface(page);
        }

        const composeBoxSelector = await resolveMessageComposeBoxSelector(page);
        if (!composeBoxSelector) {
          await dismissMessageUi(page);
          return messageActionResult(
            await currentUrl(page),
            "composer_unavailable",
            "LinkedIn did not expose a usable message composer.",
            { recipient_selected: recipientSelected },
          );
        }

        if (
          !(await composePageMatchesRecipient(page, displayName ?? "", linkedinUsername))
        ) {
          await dismissMessageUi(page);
          return messageActionResult(
            await currentUrl(page),
            "recipient_resolution_failed",
            "LinkedIn opened a compose page, but the visible recipient did not match the requested profile.",
            { recipient_selected: recipientSelected },
          );
        }

        recipientSelected = true;

        if (!confirmSend) {
          await dismissMessageUi(page);
          return messageActionResult(
            await currentUrl(page),
            "confirmation_required",
            "Set confirm_send=true to send the message.",
            { recipient_selected: recipientSelected },
          );
        }

        const focused = await page.focusElement(composeBoxSelector);
        if (!focused) {
          await dismissMessageUi(page);
          return messageActionResult(
            await currentUrl(page),
            "composer_unavailable",
            "LinkedIn did not expose a usable message composer.",
            { recipient_selected: recipientSelected },
          );
        }

        await page.typeText(message, 30);
        await sleep(300);

        const sendEnabled = await waitForEnabledSend(page);
        if (!sendEnabled) {
          await dismissMessageUi(page);
          return messageActionResult(
            await currentUrl(page),
            "send_unavailable",
            "LinkedIn did not expose an enabled Send action for this draft.",
            { recipient_selected: recipientSelected },
          );
        }

        await page.clickElement(MESSAGING_ENABLED_SEND_SELECTOR);
        const confirmed = await waitForVisibleMessageText(page, message);
        if (!confirmed) {
          await dismissMessageUi(page);
          return messageActionResult(
            await currentUrl(page),
            "send_unavailable",
            "LinkedIn did not confirm that the message was sent.",
            { recipient_selected: recipientSelected },
          );
        }

        return messageActionResult(await currentUrl(page), "sent", "Message sent.", {
          recipient_selected: recipientSelected,
          sent: true,
        });
      });
    },
  },
};

export function createLinkedinAction(
  actionName: string,
  config: ActionConfig,
  deps: LinkedinActionDeps,
): Action {
  const definition = OPERATIONS[actionName];
  if (!definition) {
    throw new Error(`Unsupported LinkedIn action: ${actionName}`);
  }

  return {
    config: {
      ...config,
      sideEffects: definition.sideEffects ?? config.sideEffects,
    },
    inputSchema: definition.inputSchema,
    execute: async (args: Record<string, unknown>): Promise<ActionResult> => {
      try {
        const data = await definition.execute(args, deps);
        return { status: "ok", data };
      } catch (error) {
        return {
          status: "error",
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };
}

async function withTemporaryPage<TResult>(
  capabilityDiscovery: BrowserCapabilityDiscovery,
  run: (page: LinkedinPage) => Promise<TResult>,
): Promise<TResult> {
  const page = await openBrowserPage(capabilityDiscovery);
  try {
    return await run(page);
  } finally {
    await page.closeTarget();
  }
}

async function scrapePerson(
  page: LinkedinPage,
  linkedinUsername: string,
  requested: Set<PersonSectionName>,
): Promise<Record<string, unknown>> {
  const sections: Record<string, string> = {};
  const references: Record<string, Reference[]> = {};
  const sectionErrors: Record<string, unknown> = {};
  const baseUrl = `${LINKEDIN_HOST}/in/${linkedinUsername}`;
  let profileUrn: string | null = null;

  const orderedEntries = Object.entries(PERSON_SECTIONS).filter(([name]) =>
    requested.has(name as PersonSectionName),
  ) as Array<[PersonSectionName, { suffix: string; overlay: boolean }]>;

  for (const [index, [sectionName, section]] of orderedEntries.entries()) {
    if (index > 0) {
      await sleep(NAV_DELAY_MS);
    }

    const url = `${baseUrl}${section.suffix}`;
    const extracted =
      section.overlay ?
        await extractOverlay(page, url, sectionName)
      : await extractPage(page, url, sectionName, {
          rootSelectors: ["main"],
          waitForMainLength: sectionName === "posts" ? 200 : 100,
          scrollBehavior: sectionName === "posts" ? "page_bottom" : "page_bottom",
          scrollAttempts: sectionName === "posts" ? 10 : 5,
        });

    if (extracted.text && extracted.text !== RATE_LIMITED_MSG) {
      sections[sectionName] = extracted.text;
      const refs = buildReferences(extracted.references, sectionName);
      if (refs.length > 0) {
        references[sectionName] = refs;
      }
    } else if (extracted.error) {
      sectionErrors[sectionName] = extracted.error;
    }

    if (sectionName === "main_profile" && !profileUrn) {
      profileUrn = await extractProfileUrn(page);
    }
  }

  const result: Record<string, unknown> = {
    url: `${baseUrl}/`,
    sections,
  };
  if (profileUrn) {
    result.profile_urn = profileUrn;
  }
  if (Object.keys(references).length > 0) {
    result.references = references;
  }
  if (Object.keys(sectionErrors).length > 0) {
    result.section_errors = sectionErrors;
  }
  return result;
}

async function scrapeCompany(
  page: LinkedinPage,
  companyName: string,
  requested: Set<CompanySectionName>,
): Promise<Record<string, unknown>> {
  const sections: Record<string, string> = {};
  const references: Record<string, Reference[]> = {};
  const sectionErrors: Record<string, unknown> = {};
  const baseUrl = `${LINKEDIN_HOST}/company/${companyName}`;

  const orderedEntries = Object.entries(COMPANY_SECTIONS).filter(([name]) =>
    requested.has(name as CompanySectionName),
  ) as Array<[CompanySectionName, { suffix: string; overlay: boolean }]>;

  for (const [index, [sectionName, section]] of orderedEntries.entries()) {
    if (index > 0) {
      await sleep(NAV_DELAY_MS);
    }

    const url = `${baseUrl}${section.suffix}`;
    const extracted = await extractPage(page, url, sectionName, {
      rootSelectors: ["main"],
      waitForMainLength: 100,
      scrollBehavior: "page_bottom",
      scrollAttempts: sectionName === "posts" ? 10 : 5,
    });

    if (extracted.text && extracted.text !== RATE_LIMITED_MSG) {
      sections[sectionName] = extracted.text;
      const refs = buildReferences(extracted.references, sectionName);
      if (refs.length > 0) {
        references[sectionName] = refs;
      }
    } else if (extracted.error) {
      sectionErrors[sectionName] = extracted.error;
    }
  }

  const result: Record<string, unknown> = {
    url: `${baseUrl}/`,
    sections,
  };
  if (Object.keys(references).length > 0) {
    result.references = references;
  }
  if (Object.keys(sectionErrors).length > 0) {
    result.section_errors = sectionErrors;
  }
  return result;
}

async function extractSingleSectionResult(
  page: LinkedinPage,
  url: string,
  sectionName: string,
): Promise<Record<string, unknown>> {
  const extracted = await extractPage(page, url, sectionName, {
    rootSelectors: ["main"],
    waitForMainLength: 100,
    scrollBehavior:
      sectionName === "search_results" ? "main_bottom"
      : sectionName === "job_posting" ? "page_bottom"
      : "page_bottom",
    scrollAttempts: 5,
  });

  const result: Record<string, unknown> = {
    url,
    sections: {},
  };

  if (extracted.text && extracted.text !== RATE_LIMITED_MSG) {
    result.sections = {
      [sectionName]: extracted.text,
    };
    const references = buildReferences(extracted.references, sectionName);
    if (references.length > 0) {
      result.references = {
        [sectionName]: references,
      };
    }
  } else if (extracted.error) {
    result.section_errors = {
      [sectionName]: extracted.error,
    };
  }

  return result;
}

async function extractPage(
  page: LinkedinPage,
  url: string,
  sectionName: string,
  options: {
    rootSelectors: string[];
    waitForMainLength: number;
    scrollBehavior: "none" | "page_bottom" | "main_bottom" | "main_top";
    scrollAttempts: number;
  },
): Promise<ExtractedSection> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await page.navigate(url);
      await assertLinkedinPageUsable(page, url);
      await waitForMainText(page, options.waitForMainLength, 10_000);

      if (options.scrollBehavior === "page_bottom") {
        await scrollPageToBottom(page, options.scrollAttempts, 500);
      } else if (options.scrollBehavior === "main_bottom") {
        await scrollMainScrollableRegion(page, "bottom", options.scrollAttempts, 500);
      } else if (options.scrollBehavior === "main_top") {
        await scrollMainScrollableRegion(page, "top", options.scrollAttempts, 500);
      }

      const rawResult = await extractRootContent(page, options.rootSelectors);
      if (!rawResult.text.trim()) {
        return { text: "", references: [] };
      }

      const cleaned = stripLinkedinNoise(rawResult.text);
      if (cleaned) {
        return {
          text: cleaned,
          references: rawResult.references,
        };
      }
    } catch (error) {
      return {
        text: "",
        references: [],
        error: buildIssueDiagnostics(error, "extract_page", url, sectionName),
      };
    }

    if (attempt === 0) {
      await sleep(RATE_LIMIT_RETRY_DELAY_MS);
    }
  }

  return { text: RATE_LIMITED_MSG, references: [] };
}

async function extractOverlay(
  page: LinkedinPage,
  url: string,
  sectionName: string,
): Promise<ExtractedSection> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await page.navigate(url);
      await assertLinkedinPageUsable(page, url);
      await waitForSelector(page, "dialog[open], .artdeco-modal__content, main", 8_000);
      const rawResult = await extractRootContent(page, ["dialog[open]", ".artdeco-modal__content", "main"]);

      if (!rawResult.text.trim()) {
        return { text: "", references: [] };
      }

      const cleaned = stripLinkedinNoise(rawResult.text);
      if (cleaned) {
        return {
          text: cleaned,
          references: rawResult.references,
        };
      }
    } catch (error) {
      return {
        text: "",
        references: [],
        error: buildIssueDiagnostics(error, "extract_overlay", url, sectionName),
      };
    }

    if (attempt === 0) {
      await sleep(RATE_LIMIT_RETRY_DELAY_MS);
    }
  }

  return { text: RATE_LIMITED_MSG, references: [] };
}

async function extractRootContent(
  page: LinkedinPage,
  selectors: string[],
): Promise<{ source: "root" | "body"; text: string; references: RawReference[] }> {
  return await page.evaluateByValue(`
    (() => {
      const selectors = ${JSON.stringify(selectors)};
      const normalize = (value) => (value || "").replace(/\\s+/g, " ").trim();
      const containerSelector = "section, article, li, div";
      const headingSelector = "h1, h2, h3";
      const directHeadingSelector = ":scope > h1, :scope > h2, :scope > h3";
      const maxHeadingContainers = 300;
      const maxReferenceAnchors = 500;

      const getHeadingText = (element) => {
        if (!element) return "";
        const heading =
          element.matches?.(headingSelector) ? element :
          element.querySelector?.(directHeadingSelector) || null;
        return normalize(heading?.innerText || heading?.textContent);
      };

      const getPreviousHeading = (node) => {
        let sibling = node?.previousElementSibling || null;
        for (let index = 0; sibling && index < 3; index += 1) {
          const heading = getHeadingText(sibling);
          if (heading) return heading;
          sibling = sibling.previousElementSibling;
        }
        return "";
      };

      const root = selectors.map((selector) => document.querySelector(selector)).find(Boolean);
      const source = root ? "root" : "body";
      const container = root || document.body;
      const text = container ? (container.innerText || "").trim() : "";
      const headingMap = new WeakMap();
      const candidateContainers = [
        container,
        ...Array.from(container.querySelectorAll(containerSelector)).slice(0, maxHeadingContainers),
      ];

      for (const node of candidateContainers) {
        const ownHeading = getHeadingText(node);
        const previousHeading = getPreviousHeading(node);
        const heading = ownHeading || previousHeading;
        if (heading) {
          headingMap.set(node, heading);
        }
      }

      const findHeading = (element) => {
        let current = element;
        while (current && current !== container) {
          if (headingMap.has(current)) {
            return headingMap.get(current);
          }
          current = current.parentElement;
        }
        return headingMap.get(container) || "";
      };

      const references = Array.from(container.querySelectorAll("a"))
        .slice(0, maxReferenceAnchors)
        .map((anchor) => ({
          href: anchor.href || anchor.getAttribute("href") || "",
          text: normalize(anchor.innerText || anchor.textContent || ""),
          aria_label: normalize(anchor.getAttribute("aria-label") || ""),
          title: normalize(anchor.getAttribute("title") || ""),
          heading: normalize(findHeading(anchor)),
          in_article: !!anchor.closest("article"),
          in_nav: !!anchor.closest("nav, header"),
          in_footer: !!anchor.closest("footer"),
        }));

      return {
        source,
        text,
        references,
      };
    })()
  `);
}

async function assertLinkedinPageUsable(page: LinkedinPage, targetUrl?: string): Promise<void> {
  const probe = await page.evaluateByValue<{ href: string; text: string }>(`
    ({
      href: location.href,
      text: (document.body?.innerText || "").slice(0, 3000),
    })
  `);

  const href = probe.href || "";
  const lowerText = probe.text.toLowerCase();
  if (
    href.includes("/login") ||
    href.includes("/authwall") ||
    href.includes("/checkpoint") ||
    href.includes("/uas/login")
  ) {
    throw new Error(`LinkedIn requires interactive login before visiting ${targetUrl ?? href}`);
  }
  if (
    lowerText.includes("let us know you're human") ||
    lowerText.includes("verify to continue") ||
    lowerText.includes("security verification")
  ) {
    throw new Error("LinkedIn presented a verification challenge");
  }
}

async function waitForMainText(
  page: LinkedinPage,
  minimumLength: number,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const textLength = await page.evaluateByValue<number>(`
      (() => {
        const main = document.querySelector("main");
        return main?.innerText?.length ?? 0;
      })()
    `);
    if (textLength >= minimumLength) {
      return;
    }
    await sleep(300);
  }
}

async function waitForSelector(page: LinkedinPage, selector: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await page.hasElement(selector)) {
      return;
    }
    await sleep(250);
  }
}

async function waitUntilHidden(
  page: LinkedinPage,
  selector: string,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await isSelectorVisible(page, selector))) {
      return;
    }
    await sleep(250);
  }
}

async function scrollPageToBottom(
  page: LinkedinPage,
  attempts: number,
  pauseMs: number,
): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await page.evaluate(`
      (() => {
        window.scrollTo({ top: document.body.scrollHeight, behavior: "instant" });
      })()
    `);
    await sleep(pauseMs);
  }
}

async function scrollMainScrollableRegion(
  page: LinkedinPage,
  position: "top" | "bottom",
  attempts: number,
  pauseMs: number,
): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await page.evaluate(`
      (() => {
        const main = document.querySelector("main");
        if (!main) return;
        const isScrollable = (element) => {
          const style = window.getComputedStyle(element);
          return (
            (style.overflowY === "auto" || style.overflowY === "scroll") &&
            element.scrollHeight > element.clientHeight + 20
          );
        };
        const candidates = [main, ...main.querySelectorAll("*")].filter(isScrollable);
        const target = candidates.sort((left, right) => right.scrollHeight - left.scrollHeight)[0] || main;
        target.scrollTop = ${JSON.stringify(position)} === "top" ? 0 : target.scrollHeight;
      })()
    `);
    await sleep(pauseMs);
  }
}

function stripLinkedinNoise(text: string): string {
  return filterLinkedinNoiseLines(truncateLinkedinNoise(text));
}

function truncateLinkedinNoise(text: string): string {
  let earliest = text.length;
  for (const pattern of NOISE_MARKERS) {
    const match = pattern.exec(text);
    if (match && match.index < earliest) {
      earliest = match.index;
    }
  }
  return text.slice(0, earliest).trim();
}

function filterLinkedinNoiseLines(text: string): string {
  return text
    .split("\n")
    .filter((line) => !NOISE_LINES.some((pattern) => pattern.test(line.trim())))
    .join("\n")
    .trim();
}

function buildIssueDiagnostics(
  error: unknown,
  context: string,
  targetUrl: string,
  sectionName: string,
): Record<string, unknown> {
  return {
    context,
    target_url: targetUrl,
    section_name: sectionName,
    message: error instanceof Error ? error.message : String(error),
  };
}

async function extractProfileUrn(page: LinkedinPage): Promise<string | null> {
  const href = await page.evaluateByValue<string | null>(`
    (() => {
      const anchor = document.querySelector(${JSON.stringify(MESSAGING_COMPOSE_LINK_SELECTOR)});
      return anchor ? anchor.getAttribute("href") || anchor.href || null : null;
    })()
  `);

  if (!href) {
    return null;
  }

  const parsed = new URL(href, LINKEDIN_HOST);
  const recipient = parsed.searchParams.get("recipient");
  return recipient?.trim() || null;
}

async function openMoreMenu(page: LinkedinPage): Promise<boolean> {
  const opened = await page.evaluateByValue<boolean>(`
    (() => {
      const normalize = (value) => (value || "").replace(/\\s+/g, " ").trim();
      const isVisible = (el) =>
        !!(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length));
      const candidates = Array.from(document.querySelectorAll("main button, main [role='button']"));
      const button = candidates.find((element) => {
        if (!isVisible(element)) return false;
        const text = normalize(element.innerText || element.textContent);
        const aria = normalize(element.getAttribute("aria-label") || "");
        return text === "More" || aria.includes("More");
      });
      if (!button) return false;
      button.click();
      return true;
    })()
  `);
  if (!opened) {
    return false;
  }

  await sleep(500);
  return await page.evaluateByValue<boolean>(`
    (() => {
      const normalize = (value) => (value || "").replace(/\\s+/g, " ").trim();
      const menu = document.querySelector("[role='menu']");
      if (!menu) return false;
      return Array.from(menu.querySelectorAll("button, a, li, [role='menuitem'], [role='button']")).some(
        (element) => normalize(element.innerText || element.textContent) === "Connect"
      );
    })()
  `);
}

async function dialogIsOpen(page: LinkedinPage): Promise<boolean> {
  return await isSelectorVisible(page, DIALOG_SELECTOR);
}

async function waitForDialog(page: LinkedinPage, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await dialogIsOpen(page)) {
      return true;
    }
    await sleep(250);
  }
  return false;
}

async function clickDialogPrimaryButton(page: LinkedinPage): Promise<boolean> {
  return await page.evaluateByValue<boolean>(`
    (() => {
      const isVisible = (el) =>
        !!(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length));
      const buttons = Array.from(document.querySelectorAll(${JSON.stringify(DIALOG_BUTTON_SELECTOR)})).filter(isVisible);
      const button = buttons[buttons.length - 1];
      if (!button) return false;
      button.click();
      return true;
    })()
  `);
}

async function clickFirstDialogButton(page: LinkedinPage): Promise<boolean> {
  return await page.evaluateByValue<boolean>(`
    (() => {
      const isVisible = (el) =>
        !!(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length));
      const button = Array.from(document.querySelectorAll(${JSON.stringify(DIALOG_BUTTON_SELECTOR)})).find(isVisible);
      if (!button) return false;
      button.click();
      return true;
    })()
  `);
}

async function dismissDialog(page: LinkedinPage): Promise<void> {
  await page.pressKey("Escape", "Escape", 27);
  await sleep(500);
}

async function isSelectorVisible(page: LinkedinPage, selector: string): Promise<boolean> {
  return await page.evaluateByValue<boolean>(`
    (() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      return !!(
        element &&
        (element.offsetWidth || element.offsetHeight || element.getClientRects().length)
      );
    })()
  `);
}

function buildJobSearchUrl(input: {
  keywords: string;
  location?: string;
  date_posted?: string;
  job_type?: string;
  experience_level?: string;
  work_type?: string;
  easy_apply?: boolean;
  sort_by?: string;
}): string {
  const params = new URLSearchParams({ keywords: input.keywords });
  if (input.location) {
    params.set("location", input.location);
  }
  if (input.date_posted) {
    params.set("f_TPR", DATE_POSTED_MAP[input.date_posted.trim()] ?? input.date_posted);
  }
  if (input.job_type) {
    params.set("f_JT", normalizeCsv(input.job_type, JOB_TYPE_MAP));
  }
  if (input.experience_level) {
    params.set("f_E", normalizeCsv(input.experience_level, EXPERIENCE_LEVEL_MAP));
  }
  if (input.work_type) {
    params.set("f_WT", normalizeCsv(input.work_type, WORK_TYPE_MAP));
  }
  if (input.easy_apply) {
    params.set("f_EA", "true");
  }
  if (input.sort_by) {
    params.set("sortBy", SORT_BY_MAP[input.sort_by.trim()] ?? input.sort_by);
  }
  return `${LINKEDIN_HOST}/jobs/search/?${params.toString()}`;
}

function normalizeCsv(value: string, mapping: Record<string, string>): string {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => mapping[entry] ?? entry)
    .join(",");
}

async function getTotalSearchPages(page: LinkedinPage): Promise<number | null> {
  const text = await page.evaluateByValue<string | null>(`
    (() => {
      const element = document.querySelector(".jobs-search-pagination__page-state");
      return element ? element.textContent?.trim() ?? null : null;
    })()
  `);
  if (!text) {
    return null;
  }
  const match = /of\s+(\d+)/u.exec(text);
  return match ? Number(match[1]) : null;
}

async function extractJobIds(page: LinkedinPage): Promise<string[]> {
  return await page.evaluateByValue<string[]>(`
    (() => {
      const seen = new Set();
      const ids = [];
      for (const anchor of document.querySelectorAll('a[href*="/jobs/view/"]')) {
        const match = (anchor.href || "").match(/\\/jobs\\/view\\/(\\d+)/);
        if (match && !seen.has(match[1])) {
          seen.add(match[1]);
          ids.push(match[1]);
        }
      }
      return ids;
    })()
  `);
}

function singleSectionResult(
  url: string,
  sectionName: string,
  text: string,
  references: Reference[],
): Record<string, unknown> {
  const result: Record<string, unknown> = {
    url,
    sections: {},
  };
  if (text) {
    result.sections = { [sectionName]: text };
    if (references.length > 0) {
      result.references = { [sectionName]: references };
    }
  }
  return result;
}

async function extractConversationThreadRefs(
  page: LinkedinPage,
  limit: number,
): Promise<Reference[]> {
  const conversations = await page.evaluateByValue<Array<{ name: string; threadId: string }>>(`
    (async () => {
      const limit = ${limit};
      const labels = Array.from(document.querySelectorAll('main label[aria-label^="Select conversation"]'));
      const results = [];
      for (let index = 0; index < Math.min(labels.length, limit); index += 1) {
        const label = labels[index];
        const ariaLabel = label.getAttribute("aria-label") || "";
        const name = ariaLabel.replace(/^Select conversation with\\s*/i, "").trim();
        const clickTarget = label.closest("li")?.querySelector('div[class*="listitem__link"]');
        if (!clickTarget) continue;
        clickTarget.click();
        await new Promise((resolve) => setTimeout(resolve, 300));
        const match = location.href.match(/\\/messaging\\/thread\\/([^/?#]+)/);
        if (match) {
          results.push({ name, threadId: match[1] });
        }
      }
      return results;
    })()
  `);

  return conversations.map((conversation) => ({
    kind: "conversation",
    url: `/messaging/thread/${conversation.threadId}/`,
    context: "inbox",
    ...(conversation.name ? { text: conversation.name } : {}),
  }));
}

async function openConversationByUsername(
  page: LinkedinPage,
  linkedinUsername: string,
): Promise<void> {
  const profileUrl = `${LINKEDIN_HOST}/in/${linkedinUsername}/`;
  await page.navigate(profileUrl);
  await assertLinkedinPageUsable(page, profileUrl);
  await waitForMainText(page, 80, 10_000);

  const displayName = await readProfileDisplayName(page);
  if (!displayName) {
    throw new Error(`Could not resolve a display name for ${linkedinUsername}.`);
  }

  const threadUrl = await resolveConversationThreadUrl(page, displayName);
  if (!threadUrl) {
    throw new Error(`Could not find a conversation for ${linkedinUsername}.`);
  }

  await page.navigate(threadUrl);
}

async function resolveConversationThreadUrl(
  page: LinkedinPage,
  searchQuery: string,
): Promise<string | null> {
  await page.navigate(`${LINKEDIN_HOST}/messaging/`);
  await assertLinkedinPageUsable(page);
  await waitForMainText(page, 80, 10_000);

  const baselineThreadId = extractThreadId(await currentUrl(page));
  await fillMessagingSearch(page, searchQuery);
  await waitForMainText(page, 80, 10_000);

  const matchResult = await page.evaluateByValue<{ clicked: boolean; href: string | null }>(`
    (() => {
      const searchQuery = ${JSON.stringify(searchQuery)};
      const normalize = (value) => (value || "").replace(/\\s+/g, " ").trim().toLowerCase();
      const target = normalize(searchQuery);
      const isVisible = (element) =>
        !!(element && (element.offsetWidth || element.offsetHeight || element.getClientRects().length));

      const resolveThreadHref = (element) => {
        if (!element) return null;
        const threadSelector = 'a[href*="/messaging/thread/"]';
        const candidates = [
          element.matches?.(threadSelector) ? element : null,
          element.querySelector?.(threadSelector) || null,
          element.closest?.(threadSelector) || null,
        ].filter(Boolean);
        const threadLink = candidates.find((candidate) => isVisible(candidate));
        return threadLink?.href || threadLink?.getAttribute("href") || null;
      };

      const matchingAnchor = Array.from(document.querySelectorAll('main a[href*="/messaging/thread/"]')).find(
        (anchor) => {
          if (!isVisible(anchor)) return false;
          const container = anchor.closest('[role="listitem"], li') || anchor.parentElement || anchor;
          const text = normalize(container.innerText || container.textContent);
          return text.includes(target);
        }
      );
      if (matchingAnchor) {
        matchingAnchor.click();
        return { clicked: true, href: resolveThreadHref(matchingAnchor) };
      }

      const matchingRow = Array.from(document.querySelectorAll('main [role="listitem"], main li')).find(
        (row) => {
          if (!isVisible(row)) return false;
          const text = normalize(row.innerText || row.textContent);
          return text.includes(target);
        }
      );
      if (matchingRow) {
        const interactionTarget =
          matchingRow.querySelector('[tabindex="0"], button, [role="button"], a') || matchingRow;
        interactionTarget.click();
        return { clicked: true, href: resolveThreadHref(matchingRow) };
      }

      return { clicked: false, href: null };
    })()
  `);

  if (!matchResult.clicked) {
    return null;
  }

  await sleep(1_000);
  const currentThreadId = extractThreadId(await currentUrl(page));
  if (currentThreadId && currentThreadId !== baselineThreadId) {
    return await currentUrl(page);
  }
  return matchResult.href;
}

async function fillMessagingSearch(page: LinkedinPage, query: string): Promise<void> {
  await waitForSelector(page, MESSAGING_SEARCH_SELECTOR, 8_000);
  await page.inputText(MESSAGING_SEARCH_SELECTOR, query);
  await sleep(1_000);
  await page.pressKey("Enter", "Enter", 13);
  await sleep(1_500);
}

async function readProfileDisplayName(page: LinkedinPage): Promise<string | null> {
  const displayName = await page.evaluateByValue<string>(`
    (() => {
      const normalize = (value) => (value || "").replace(/\\s+/g, " ").trim();
      const heading = document.querySelector("main h1");
      if (heading) {
        const headingText = normalize(heading.innerText || heading.textContent || "");
        if (headingText) return headingText;
      }

      const main = document.querySelector("main");
      if (!main) return "";
      const lines = (main.innerText || "")
        .split("\\n")
        .map(normalize)
        .filter(Boolean);
      return lines[0] || "";
    })()
  `);
  return displayName.trim() || null;
}

async function resolveMessageComposeHref(page: LinkedinPage): Promise<string | null> {
  const href = await page.evaluateByValue<string | null>(`
    (() => {
      const isVisible = (element) =>
        !!(element && (element.offsetWidth || element.offsetHeight || element.getClientRects().length));
      const anchor = Array.from(document.querySelectorAll(${JSON.stringify(MESSAGING_COMPOSE_LINK_SELECTOR)})).find(
        isVisible
      );
      return anchor ? anchor.getAttribute("href") || anchor.href || null : null;
    })()
  `);

  if (!href) {
    return null;
  }
  return new URL(href, LINKEDIN_HOST).toString();
}

async function waitForMessageSurface(
  page: LinkedinPage,
): Promise<"composer" | "recipient_picker" | null> {
  if (await waitForVisibleSelector(page, MESSAGING_RECIPIENT_PICKER_SELECTOR, 2_000)) {
    return "recipient_picker";
  }
  if (await resolveMessageComposeBoxSelector(page, 10_000)) {
    return "composer";
  }
  return null;
}

async function waitForVisibleSelector(
  page: LinkedinPage,
  selector: string,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isSelectorVisible(page, selector)) {
      return true;
    }
    await sleep(250);
  }
  return false;
}

async function resolveMessageComposeBoxSelector(
  page: LinkedinPage,
  timeoutMs = 10_000,
): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const selector of MESSAGING_COMPOSE_FALLBACK_SELECTORS) {
      if (await isSelectorVisible(page, selector)) {
        return selector;
      }
    }
    await sleep(250);
  }
  return null;
}

async function selectMessageRecipient(
  page: LinkedinPage,
  ...candidates: string[]
): Promise<boolean> {
  const normalizedCandidates = candidates.map((value) => value.trim()).filter(Boolean);
  if (normalizedCandidates.length === 0) {
    return false;
  }

  const selected = await page.evaluateByValue<boolean>(`
    (() => {
      const candidates = ${JSON.stringify(normalizedCandidates)};
      const normalize = (value) => (value || "").replace(/\\s+/g, " ").trim().toLowerCase();
      const isVisible = (element) =>
        !!(element && (element.offsetWidth || element.offsetHeight || element.getClientRects().length));

      const pickerInput = Array.from(document.querySelectorAll("input")).find((element) =>
        isVisible(element) &&
        /type a name|multiple names/i.test(
          \`\${element.placeholder || ""} \${element.getAttribute("aria-label") || ""}\`
        )
      );
      const pickerRoot =
        pickerInput?.closest("section, dialog, [role='dialog'], aside, div") || document.body;
      const rows = Array.from(
        pickerRoot.querySelectorAll('[role="option"], [role="listitem"], li, button, a, div')
      ).filter((element) => {
        if (!isVisible(element)) return false;
        const text = normalize(element.innerText || element.textContent);
        return text.length > 0 && text !== "new message";
      });

      for (const candidate of candidates.map(normalize)) {
        const exact = rows.find((element) => normalize(element.innerText || element.textContent) === candidate);
        if (exact) {
          exact.click();
          return true;
        }
      }

      for (const candidate of candidates.map(normalize)) {
        const partial = rows.find((element) =>
          normalize(element.innerText || element.textContent).includes(candidate)
        );
        if (partial) {
          partial.click();
          return true;
        }
      }

      return false;
    })()
  `);

  if (selected) {
    await sleep(750);
  }
  return selected;
}

async function composePageMatchesRecipient(
  page: LinkedinPage,
  ...candidates: string[]
): Promise<boolean> {
  const normalizedCandidates = candidates.map((value) => value.trim()).filter(Boolean);
  if (normalizedCandidates.length === 0) {
    return false;
  }

  return await page.evaluateByValue<boolean>(`
    (() => {
      const candidates = ${JSON.stringify(normalizedCandidates)};
      const normalize = (value) => (value || "").replace(/\\s+/g, " ").trim().toLowerCase();
      const isVisible = (element) =>
        !!(element && (element.offsetWidth || element.offsetHeight || element.getClientRects().length));
      const targetValues = candidates.map(normalize).filter(Boolean);
      const root = document.querySelector("main") || document.body;
      const entries = Array.from(root.querySelectorAll("button, [role='button'], a, span, div, li, p, h1, h2, h3"))
        .filter(isVisible)
        .flatMap((element) =>
          [
            normalize(element.innerText || element.textContent || ""),
            normalize(element.getAttribute("aria-label") || ""),
          ].filter(Boolean)
        );

      return targetValues.some((candidate) =>
        entries.some((entry) => entry === candidate || entry.includes(candidate))
      );
    })()
  `);
}

async function dismissMessageUi(page: LinkedinPage): Promise<void> {
  if (await isSelectorVisible(page, MESSAGING_CLOSE_SELECTOR)) {
    try {
      await page.clickElement(MESSAGING_CLOSE_SELECTOR);
      await sleep(500);
    } catch {
      // Best effort.
    }
  }
}

async function waitForEnabledSend(page: LinkedinPage, timeoutMs = 8_000): Promise<boolean> {
  return await waitForVisibleSelector(page, MESSAGING_ENABLED_SEND_SELECTOR, timeoutMs);
}

async function waitForVisibleMessageText(
  page: LinkedinPage,
  message: string,
  timeoutMs = 10_000,
): Promise<boolean> {
  const expected = normalizeInlineWhitespace(message);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const bodyText = normalizeInlineWhitespace(await page.evaluateByValue<string>("document.body?.innerText || ''"));
    if (bodyText.includes(expected)) {
      return true;
    }
    await sleep(300);
  }
  return false;
}

async function getMainText(page: LinkedinPage): Promise<string> {
  return stripLinkedinNoise(
    await page.evaluateByValue<string>(
      "(document.querySelector('main') || document.body)?.innerText || ''",
    ),
  );
}

function extractThreadId(url: string): string | null {
  const match = /\/messaging\/thread\/([^/?#]+)\/?/u.exec(url);
  return match?.[1] ?? null;
}

async function currentUrl(page: LinkedinPage): Promise<string> {
  return await page.evaluateByValue<string>("location.href");
}

function normalizeInlineWhitespace(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

function requireString(args: Record<string, unknown>, keys: string[]): string {
  const value = optionalString(args, keys);
  if (!value) {
    throw new Error(`${keys[0]} is required`);
  }
  return value;
}

function optionalString(args: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = args[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function requireBoolean(args: Record<string, unknown>, keys: string[]): boolean {
  const value = optionalBoolean(args, keys);
  if (typeof value !== "boolean") {
    throw new Error(`${keys[0]} is required`);
  }
  return value;
}

function optionalBoolean(args: Record<string, unknown>, keys: string[]): boolean | undefined {
  for (const key of keys) {
    const value = args[key];
    if (typeof value === "boolean") {
      return value;
    }
  }
  return undefined;
}

function optionalNumber(args: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = args[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  return undefined;
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, Math.trunc(value)));
}

function connectionResult(
  url: string,
  status: string,
  message: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    url,
    status,
    message,
    note_sent: false,
    ...extra,
  };
}

function messageActionResult(
  url: string,
  status: string,
  message: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    url,
    status,
    message,
    recipient_selected: false,
    sent: false,
    ...extra,
  };
}

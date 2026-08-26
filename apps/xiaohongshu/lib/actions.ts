import { stat } from "node:fs/promises";
import type {
  Action,
  ActionConfig,
  ActionResult,
  BrowserCapabilityDiscovery,
} from "@rome-os/app-runtime";

import {
  connectToPersistentPage,
  downloadRemoteFile,
  openBrowserPage,
  resolveBrowserEndpoint,
  resolveFileInputPath,
  sleep,
  type XhsPage,
} from "./browser.js";
import {
  clearPersistentPageTarget,
  loadPersistentPageTarget,
  savePersistentPageTarget,
} from "./session-state.js";
import { calcTitleLength } from "./title-utils.js";

const HOME_URL = "https://www.xiaohongshu.com";
const EXPLORE_URL = "https://www.xiaohongshu.com/explore";
const PUBLISH_URL = "https://creator.xiaohongshu.com/publish/publish?source=official";

const FILTER_BUTTON = "div.filter";
const FILTER_PANEL = "div.filter-panel";
const COMMENTS_CONTAINER = ".comments-container";
const PARENT_COMMENT = ".parent-comment";
const END_CONTAINER = ".end-container";
const SHOW_MORE_BUTTON = ".show-more";
const ACCESS_ERROR_WRAPPER =
  ".access-wrapper, .error-wrapper, .not-found-wrapper, .blocked-wrapper";
const COMMENT_INPUT_TRIGGER = "div.input-box div.content-edit span";
const COMMENT_INPUT_FIELD = "div.input-box div.content-edit p.content-input";
const COMMENT_SUBMIT_BUTTON = "div.bottom button.submit";
const REPLY_BUTTON = ".right .interactions .reply";
const LIKE_BUTTON = ".interact-container .left .like-lottie";
const COLLECT_BUTTON = ".interact-container .left .reds-icon.collect-icon";
const CREATOR_TAB = "div.creator-tab";
const UPLOAD_INPUT = ".upload-input";
const FILE_INPUT = 'input[type="file"]';
const TITLE_INPUT = "div.d-input input";
const CONTENT_EDITOR = "div.ql-editor";
const IMAGE_PREVIEW = ".img-preview-area .pr";
const PUBLISH_BUTTON = ".publish-page-publish-btn button.bg-red";
const SCHEDULE_SWITCH = ".post-time-wrapper .d-switch";
const DATETIME_INPUT = ".date-picker-container input";
const VISIBILITY_DROPDOWN = "div.permission-card-wrapper div.d-select-content";
const VISIBILITY_OPTIONS = "div.d-options-wrapper div.d-grid-item div.custom-option";
const ORIGINAL_SWITCH_CARD = "div.custom-switch-card";
const ORIGINAL_SWITCH = "div.d-switch";
const TAG_TOPIC_CONTAINER = "#creator-editor-topic-container";
const TAG_FIRST_ITEM = ".item";
const POPOVER = "div.d-popover";
const LONG_ARTICLE_TITLE = 'textarea.d-text[placeholder="输入标题"]';
const TEMPLATE_CARD = ".template-card";
const TEMPLATE_TITLE = ".template-card .template-title";

const INACCESSIBLE_KEYWORDS = [
  "当前笔记暂时无法浏览",
  "该内容因违规已被删除",
  "该笔记已被删除",
  "内容不存在",
  "笔记不存在",
  "已失效",
  "私密笔记",
  "仅作者可见",
  "因用户设置，你无法查看",
  "因违规无法查看",
  "Isn't Available",
  "isn't available",
];

const FILTER_OPTIONS: Record<number, Array<[number, string]>> = {
  1: [
    [1, "综合"],
    [2, "最新"],
    [3, "最多点赞"],
    [4, "最多评论"],
    [5, "最多收藏"],
  ],
  2: [
    [1, "不限"],
    [2, "视频"],
    [3, "图文"],
  ],
  3: [
    [1, "不限"],
    [2, "一天内"],
    [3, "一周内"],
    [4, "半年内"],
  ],
  4: [
    [1, "不限"],
    [2, "已看过"],
    [3, "未看过"],
    [4, "已关注"],
  ],
  5: [
    [1, "不限"],
    [2, "同城"],
    [3, "附近"],
  ],
};

export interface XhsActionDeps {
  capabilityDiscovery: BrowserCapabilityDiscovery;
}

type OperationDefinition = {
  inputSchema: Record<string, unknown>;
  sideEffects?: ActionConfig["sideEffects"];
  execute: (args: Record<string, unknown>, deps: XhsActionDeps) => Promise<unknown>;
};

const OPERATIONS: Record<string, OperationDefinition> = {
  "list-feeds": {
    inputSchema: {
      type: "object",
      properties: {},
    },
    sideEffects: "read-only",
    execute: async (_args, deps) =>
      await withTemporaryPage(deps.capabilityDiscovery, async (page) => {
        await page.navigate(HOME_URL);
        await page.waitDomStable();
        await sleep(1_000);
        const feeds = await readInitialStateArray(page, "feed.feeds", "没有捕获到 feeds 数据");
        return {
          feeds: feeds.map(formatFeed),
          count: feeds.length,
        };
      }),
  },
  "search-feeds": {
    inputSchema: {
      type: "object",
      properties: {
        keyword: { type: "string", description: "Search keyword" },
        sortBy: { type: "string", description: "综合|最新|最多点赞|最多评论|最多收藏" },
        noteType: { type: "string", description: "不限|视频|图文" },
        publishTime: { type: "string", description: "不限|一天内|一周内|半年内" },
        searchScope: { type: "string", description: "不限|已看过|未看过|已关注" },
        location: { type: "string", description: "不限|同城|附近" },
      },
      required: ["keyword"],
    },
    sideEffects: "read-only",
    execute: async (args, deps) => {
      const keyword = requireString(args.keyword, "keyword");
      return await withTemporaryPage(deps.capabilityDiscovery, async (page) => {
        await page.navigate(makeSearchUrl(keyword));
        await page.waitDomStable();
        await waitForInitialState(page);
        await applySearchFilters(page, {
          sortBy: optionalString(args.sortBy),
          noteType: optionalString(args.noteType),
          publishTime: optionalString(args.publishTime),
          searchScope: optionalString(args.searchScope),
          location: optionalString(args.location),
        });
        const feeds = await readInitialStateArray(page, "search.feeds", "没有捕获到搜索结果");
        return {
          feeds: feeds.map(formatFeed),
          count: feeds.length,
        };
      });
    },
  },
  "get-feed-detail": {
    inputSchema: {
      type: "object",
      properties: {
        feedId: { type: "string", description: "Feed ID" },
        xsecToken: { type: "string", description: "xsec_token" },
        loadAllComments: { type: "boolean", description: "Whether to scroll and load comments" },
        clickMoreReplies: { type: "boolean", description: "Expand nested replies while loading" },
        maxRepliesThreshold: { type: "number", description: "Skip reply expand buttons above this count" },
        maxCommentItems: { type: "number", description: "Maximum comment items to load; 0 means unlimited" },
      },
      required: ["feedId", "xsecToken"],
    },
    sideEffects: "read-only",
    execute: async (args, deps) => {
      const feedId = requireString(args.feedId, "feedId");
      const xsecToken = requireString(args.xsecToken, "xsecToken");
      const loadAllComments = args.loadAllComments === true;
      const clickMoreReplies = args.clickMoreReplies === true;
      const maxRepliesThreshold = positiveIntegerOrDefault(args.maxRepliesThreshold, 10);
      const maxCommentItems = nonNegativeIntegerOrDefault(args.maxCommentItems, 0);
      return await withTemporaryPage(deps.capabilityDiscovery, async (page) => {
        await page.navigate(makeFeedDetailUrl(feedId, xsecToken));
        await page.waitDomStable();
        await sleep(1_000);
        await assertFeedPageAccessible(page);
        if (loadAllComments) {
          await loadAllCommentsIntoState(page, {
            clickMoreReplies,
            maxRepliesThreshold,
            maxCommentItems,
          });
        }
        const detailMap = await readInitialStateObject<Record<string, any>>(
          page,
          "note.noteDetailMap",
          "没有捕获到 feed 详情数据",
        );
        const detail = detailMap[feedId];
        if (!detail?.note) {
          throw new Error("没有捕获到 feed 详情数据");
        }
        return {
          note: formatFeedDetail(detail.note),
          comments: {
            list: (detail.comments?.list ?? []).map(formatComment),
            cursor: detail.comments?.cursor ?? "",
            hasMore: detail.comments?.hasMore ?? false,
          },
        };
      });
    },
  },
  "user-profile": {
    inputSchema: {
      type: "object",
      properties: {
        userId: { type: "string", description: "User ID" },
        xsecToken: { type: "string", description: "xsec_token" },
      },
      required: ["userId", "xsecToken"],
    },
    sideEffects: "read-only",
    execute: async (args, deps) => {
      const userId = requireString(args.userId, "userId");
      const xsecToken = requireString(args.xsecToken, "xsecToken");
      return await withTemporaryPage(deps.capabilityDiscovery, async (page) => {
        await page.navigate(makeUserProfileUrl(userId, xsecToken));
        await page.waitDomStable();
        await waitForInitialState(page);
        const userPageData = await readInitialStateObject<any>(
          page,
          "user.userPageData",
          "未找到用户主页数据",
        );
        const rawNotes = await readInitialStateValue<any[]>(
          page,
          "user.notes",
          "未找到用户笔记数据",
        );
        const flattenedNotes = rawNotes.flatMap((entry) => (Array.isArray(entry) ? entry : [entry]));
        return {
          userBasicInfo: {
            userId: userPageData.basicInfo?.userId ?? "",
            nickname: userPageData.basicInfo?.nickname ?? userPageData.basicInfo?.nickName ?? "",
            avatar: userPageData.basicInfo?.images ?? userPageData.basicInfo?.image ?? "",
            desc: userPageData.basicInfo?.desc ?? "",
            ipLocation: userPageData.basicInfo?.ipLocation ?? "",
          },
          interactions: (userPageData.interactions ?? []).map((interaction: any) => ({
            type: interaction.type ?? "",
            count: interaction.count ?? "",
          })),
          feeds: flattenedNotes.filter(Boolean).map(formatFeed),
          count: flattenedNotes.length,
        };
      });
    },
  },
  "post-comment": {
    inputSchema: {
      type: "object",
      properties: {
        feedId: { type: "string" },
        xsecToken: { type: "string" },
        content: { type: "string" },
      },
      required: ["feedId", "xsecToken", "content"],
    },
    execute: async (args, deps) => {
      const feedId = requireString(args.feedId, "feedId");
      const xsecToken = requireString(args.xsecToken, "xsecToken");
      const content = requireString(args.content, "content");
      return await withTemporaryPage(deps.capabilityDiscovery, async (page) => {
        await page.navigate(makeFeedDetailUrl(feedId, xsecToken));
        await page.waitDomStable();
        await sleep(1_000);
        await assertFeedPageAccessible(page);
        if (!(await page.hasElement(COMMENT_INPUT_TRIGGER))) {
          throw new Error("未找到评论输入框，该帖子可能不支持评论或网页端不可访问");
        }
        await page.clickElement(COMMENT_INPUT_TRIGGER);
        await sleep(500);
        await page.waitForElement(COMMENT_INPUT_FIELD, 5_000);
        await page.inputContentEditable(COMMENT_INPUT_FIELD, content);
        await sleep(800);
        await page.clickElement(COMMENT_SUBMIT_BUTTON);
        await sleep(1_500);
        return { success: true, message: "评论发送成功" };
      });
    },
  },
  "reply-comment": {
    inputSchema: {
      type: "object",
      properties: {
        feedId: { type: "string" },
        xsecToken: { type: "string" },
        content: { type: "string" },
        commentId: { type: "string" },
        userId: { type: "string" },
      },
      required: ["feedId", "xsecToken", "content"],
    },
    execute: async (args, deps) => {
      const feedId = requireString(args.feedId, "feedId");
      const xsecToken = requireString(args.xsecToken, "xsecToken");
      const content = requireString(args.content, "content");
      const commentId = optionalString(args.commentId);
      const userId = optionalString(args.userId);
      if (!commentId && !userId) {
        throw new Error("commentId or userId is required");
      }
      return await withTemporaryPage(deps.capabilityDiscovery, async (page) => {
        await page.navigate(makeFeedDetailUrl(feedId, xsecToken));
        await page.waitDomStable();
        await sleep(1_500);
        await assertFeedPageAccessible(page);
        const found = await findAndScrollToComment(page, commentId, userId);
        if (!found) {
          throw new Error(`未找到评论 (commentId: ${commentId ?? ""}, userId: ${userId ?? ""})`);
        }
        await sleep(1_000);
        const replySelector = commentId ? `#comment-${commentId} ${REPLY_BUTTON}` : REPLY_BUTTON;
        await page.clickElement(replySelector);
        await sleep(800);
        await page.waitForElement(COMMENT_INPUT_FIELD, 5_000);
        await page.inputContentEditable(COMMENT_INPUT_FIELD, content);
        await sleep(800);
        await page.clickElement(COMMENT_SUBMIT_BUTTON);
        await sleep(1_500);
        return { success: true, message: "回复成功" };
      });
    },
  },
  "like-feed": {
    inputSchema: {
      type: "object",
      properties: {
        feedId: { type: "string" },
        xsecToken: { type: "string" },
        unlike: { type: "boolean" },
      },
      required: ["feedId", "xsecToken"],
    },
    execute: async (args, deps) => {
      const feedId = requireString(args.feedId, "feedId");
      const xsecToken = requireString(args.xsecToken, "xsecToken");
      const unlike = args.unlike === true;
      return await toggleInteractState(
        deps.capabilityDiscovery,
        feedId,
        xsecToken,
        likeStateTarget(unlike),
      );
    },
  },
  "favorite-feed": {
    inputSchema: {
      type: "object",
      properties: {
        feedId: { type: "string" },
        xsecToken: { type: "string" },
        unfavorite: { type: "boolean" },
      },
      required: ["feedId", "xsecToken"],
    },
    execute: async (args, deps) => {
      const feedId = requireString(args.feedId, "feedId");
      const xsecToken = requireString(args.xsecToken, "xsecToken");
      const unfavorite = args.unfavorite === true;
      return await toggleInteractState(
        deps.capabilityDiscovery,
        feedId,
        xsecToken,
        favoriteStateTarget(unfavorite),
      );
    },
  },
  "publish": {
    inputSchema: publishImageSchema(),
    execute: async (args, deps) => {
      const input = await parsePublishImageArgs(args);
      return await withTemporaryPage(deps.capabilityDiscovery, async (page) => {
        await fillPublishImageForm(page, input);
        await clickPublishAndSettle(page);
        return {
          success: true,
          title: input.title,
          images: input.imagePaths.length,
          status: "发布完成",
        };
      });
    },
  },
  "fill-publish": {
    inputSchema: publishImageSchema(),
    execute: async (args, deps) => {
      const input = await parsePublishImageArgs(args);
      return await withReplacedPersistentPage(deps.capabilityDiscovery, async (page) => {
        await fillPublishImageForm(page, input);
        return {
          success: true,
          title: input.title,
          images: input.imagePaths.length,
          status: "表单已填写，等待确认发布",
        };
      });
    },
  },
  "publish-video": {
    inputSchema: publishVideoSchema(),
    execute: async (args, deps) => {
      const input = await parsePublishVideoArgs(args);
      return await withTemporaryPage(deps.capabilityDiscovery, async (page) => {
        await fillPublishVideoForm(page, input);
        await clickPublishAndSettle(page, true);
        return {
          success: true,
          title: input.title,
          video: input.videoPath,
          status: "发布完成",
        };
      });
    },
  },
  "fill-publish-video": {
    inputSchema: publishVideoSchema(),
    execute: async (args, deps) => {
      const input = await parsePublishVideoArgs(args);
      return await withReplacedPersistentPage(deps.capabilityDiscovery, async (page) => {
        await fillPublishVideoForm(page, input);
        return {
          success: true,
          title: input.title,
          video: input.videoPath,
          status: "视频表单已填写，等待确认发布",
        };
      });
    },
  },
  "click-publish": {
    inputSchema: { type: "object", properties: {} },
    execute: async (_args, deps) =>
      await withPersistentPage(deps.capabilityDiscovery, async (page, endpoint) => {
        await clickPublishAndSettle(page, true);
        await clearPersistentPageTarget(endpoint.browserUrl);
        await page.closeTarget();
        return { success: true, status: "发布完成" };
      }),
  },
  "save-draft": {
    inputSchema: { type: "object", properties: {} },
    execute: async (_args, deps) =>
      await withPersistentPage(deps.capabilityDiscovery, async (page, endpoint) => {
        const clicked = await page.evaluateByValue<boolean>(`
          (() => {
            const buttons = document.querySelectorAll("button.custom-button");
            for (const button of buttons) {
              if (button.textContent?.trim() === "暂存离开") {
                button.click();
                return true;
              }
            }
            return false;
          })()
        `);
        if (!clicked) {
          throw new Error("未找到「暂存离开」按钮");
        }
        await sleep(2_000);
        await clearPersistentPageTarget(endpoint.browserUrl);
        await page.closeTarget();
        return { success: true, status: "内容已保存到草稿箱" };
      }),
  },
  "long-article": {
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        content: { type: "string" },
        images: {
          type: "array",
          items: { type: "string" },
          description: "Optional local image paths to insert into the editor",
        },
      },
      required: ["title", "content"],
    },
    execute: async (args, deps) => {
      const title = requireString(args.title, "title");
      const content = requireString(args.content, "content");
      const images = await resolveLocalMediaList(optionalStringArray(args.images));
      return await withReplacedPersistentPage(deps.capabilityDiscovery, async (page) => {
        await navigateToPublishPage(page);
        await clickPublishTab(page, "写长文");
        await sleep(1_000);
        await clickButtonByText(page, "新的创作");
        await sleep(2_000);
        await page.waitForElement(LONG_ARTICLE_TITLE, 10_000);
        await page.evaluate(`
          (() => {
            const el = document.querySelector(${JSON.stringify(LONG_ARTICLE_TITLE)});
            if (!el) return false;
            const descriptor = Object.getOwnPropertyDescriptor(
              window.HTMLTextAreaElement.prototype,
              "value",
            );
            descriptor?.set?.call(el, ${JSON.stringify(title)});
            el.dispatchEvent(new Event("input", { bubbles: true }));
            el.dispatchEvent(new Event("change", { bubbles: true }));
            return true;
          })()
        `);
        await sleep(500);
        await page.inputContentEditable(await findContentElement(page), content);
        if (images.length > 0) {
          for (const image of images) {
            const fileUri = `file://${image}`;
            await page.evaluate(`
              (() => {
                const editor = document.querySelector(${JSON.stringify(CONTENT_EDITOR)});
                if (!editor) return false;
                const img = document.createElement("img");
                img.src = ${JSON.stringify(fileUri)};
                editor.appendChild(img);
                editor.dispatchEvent(new Event("input", { bubbles: true }));
                return true;
              })()
            `);
          }
        }
        await sleep(1_000);
        await clickButtonByText(page, "一键排版");
        await sleep(3_000);
        await waitForTemplates(page);
        return {
          success: true,
          templates: await getTemplateNames(page),
          status: "长文已填写，请选择模板",
        };
      });
    },
  },
  "select-template": {
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Template name" },
      },
      required: ["name"],
    },
    execute: async (args, deps) => {
      const name = requireString(args.name, "name");
      return await withPersistentPage(deps.capabilityDiscovery, async (page) => {
        const clicked = await page.evaluateByValue<boolean>(`
          (() => {
            const cards = document.querySelectorAll(${JSON.stringify(TEMPLATE_CARD)});
            for (const card of cards) {
              const title = card.querySelector(${JSON.stringify(TEMPLATE_TITLE)});
              if (title?.textContent?.trim() === ${JSON.stringify(name)}) {
                card.click();
                return true;
              }
            }
            return false;
          })()
        `);
        if (!clicked) {
          throw new Error(`未找到模板: ${name}`);
        }
        await sleep(1_000);
        await page.disconnect();
        return { success: true, template: name, status: "模板已选择" };
      });
    },
  },
  "next-step": {
    inputSchema: {
      type: "object",
      properties: {
        content: { type: "string", description: "Publish page description content" },
      },
      required: ["content"],
    },
    execute: async (args, deps) => {
      const content = requireString(args.content, "content");
      return await withPersistentPage(deps.capabilityDiscovery, async (page) => {
        await clickButtonByText(page, "下一步");
        await sleep(3_000);
        const truncated = content.length > 1000 ? content.slice(0, 800) : content;
        await page.inputContentEditable(await findContentElement(page), truncated);
        await page.disconnect();
        return { success: true, status: "已进入发布页，等待确认发布" };
      });
    },
  },
};

export function createXiaohongshuAction(
  actionName: string,
  config: ActionConfig,
  deps: XhsActionDeps,
): Action {
  const definition = OPERATIONS[actionName];
  if (!definition) {
    throw new Error(`Unsupported Xiaohongshu action: ${actionName}`);
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
  run: (page: XhsPage) => Promise<TResult>,
): Promise<TResult> {
  const page = await openBrowserPage(capabilityDiscovery);
  try {
    return await run(page);
  } finally {
    await page.closeTarget();
  }
}

async function withReplacedPersistentPage<TResult>(
  capabilityDiscovery: BrowserCapabilityDiscovery,
  run: (page: XhsPage) => Promise<TResult>,
): Promise<TResult> {
  const endpoint = await resolveBrowserEndpoint(capabilityDiscovery);
  const existingTargetId = await loadPersistentPageTarget(endpoint.browserUrl);
  if (existingTargetId) {
    try {
      const existingPage = await connectToPersistentPage(capabilityDiscovery, existingTargetId);
      await existingPage.closeTarget();
    } catch {
      // Ignore stale targets.
    }
    await clearPersistentPageTarget(endpoint.browserUrl);
  }

  const page = await openBrowserPage(capabilityDiscovery, { persist: true });
  await savePersistentPageTarget(page.endpoint.browserUrl, page.targetId);

  try {
    const result = await run(page);
    await page.disconnect();
    return result;
  } catch (error) {
    await clearPersistentPageTarget(page.endpoint.browserUrl);
    await page.closeTarget();
    throw error;
  }
}

async function withPersistentPage<TResult>(
  capabilityDiscovery: BrowserCapabilityDiscovery,
  run: (page: XhsPage, endpoint: { browserUrl: string; name: string }) => Promise<TResult>,
): Promise<TResult> {
  const endpoint = await resolveBrowserEndpoint(capabilityDiscovery);
  const targetId = await loadPersistentPageTarget(endpoint.browserUrl);
  if (!targetId) {
    throw new Error("No active Xiaohongshu draft page is available");
  }
  const page = await connectToPersistentPage(capabilityDiscovery, targetId);
  try {
    return await run(page, endpoint);
  } catch (error) {
    await clearPersistentPageTarget(endpoint.browserUrl);
    await page.closeTarget();
    throw error;
  }
}

async function applySearchFilters(
  page: XhsPage,
  filters: {
    sortBy?: string;
    noteType?: string;
    publishTime?: string;
    searchScope?: string;
    location?: string;
  },
): Promise<void> {
  const entries = convertFilters(filters);
  if (entries.length === 0) {
    return;
  }

  await page.hoverElement(FILTER_BUTTON);
  await page.waitForElement(FILTER_PANEL, 5_000);
  for (const [filtersIndex, tagsIndex] of entries) {
    await page.clickElement(
      `div.filter-panel div.filters:nth-child(${filtersIndex}) div.tags:nth-child(${tagsIndex})`,
    );
    await sleep(500);
  }
  await page.waitDomStable();
  await waitForInitialState(page);
}

async function readInitialStateArray(
  page: XhsPage,
  path: string,
  errorMessage: string,
): Promise<any[]> {
  const value = await readInitialStateValue<any[]>(page, path, errorMessage);
  if (!Array.isArray(value)) {
    throw new Error(errorMessage);
  }
  return value;
}

async function readInitialStateObject<TValue extends Record<string, any>>(
  page: XhsPage,
  path: string,
  errorMessage: string,
): Promise<TValue> {
  const value = await readInitialStateValue<TValue>(page, path, errorMessage);
  if (!value || typeof value !== "object") {
    throw new Error(errorMessage);
  }
  return value;
}

async function readInitialStateValue<TValue>(
  page: XhsPage,
  path: string,
  errorMessage: string,
): Promise<TValue> {
  const serialized = await page.evaluateByValue<string>(`
    (() => {
      const root = window.__INITIAL_STATE__;
      if (!root) return "";
      let current = root;
      for (const segment of ${JSON.stringify(path.split("."))}) {
        current = current?.[segment];
        if (current === undefined || current === null) return "";
      }
      const value = current?.value !== undefined ? current.value : current?._value ?? current;
      return value === undefined ? "" : JSON.stringify(value);
    })()
  `);
  if (!serialized) {
    throw new Error(errorMessage);
  }
  return JSON.parse(serialized) as TValue;
}

async function waitForInitialState(page: XhsPage, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ready = await page.evaluateByValue<boolean>("window.__INITIAL_STATE__ !== undefined");
    if (ready) {
      return;
    }
    await sleep(500);
  }
}

function formatFeed(feed: any): Record<string, unknown> {
  return {
    id: feed?.id ?? "",
    xsecToken: feed?.xsecToken ?? "",
    modelType: feed?.modelType ?? "",
    index: feed?.index ?? 0,
    displayTitle: feed?.noteCard?.displayTitle ?? "",
    type: feed?.noteCard?.type ?? "",
    user: {
      userId: feed?.noteCard?.user?.userId ?? "",
      nickname: feed?.noteCard?.user?.nickname ?? feed?.noteCard?.user?.nickName ?? "",
    },
    interactInfo: {
      likedCount: feed?.noteCard?.interactInfo?.likedCount ?? "",
      collectedCount: feed?.noteCard?.interactInfo?.collectedCount ?? "",
      commentCount: feed?.noteCard?.interactInfo?.commentCount ?? "",
      sharedCount: feed?.noteCard?.interactInfo?.sharedCount ?? "",
    },
    cover: feed?.noteCard?.cover?.url || feed?.noteCard?.cover?.urlDefault || undefined,
    video: feed?.noteCard?.video
      ? {
          duration: feed.noteCard.video?.capa?.duration ?? 0,
        }
      : undefined,
  };
}

function formatFeedDetail(detail: any): Record<string, unknown> {
  return {
    noteId: detail?.noteId ?? "",
    title: detail?.title ?? "",
    desc: detail?.desc ?? "",
    type: detail?.type ?? "",
    time: detail?.time ?? 0,
    ipLocation: detail?.ipLocation ?? "",
    user: {
      userId: detail?.user?.userId ?? "",
      nickname: detail?.user?.nickname ?? detail?.user?.nickName ?? "",
    },
    interactInfo: {
      liked: detail?.interactInfo?.liked ?? false,
      likedCount: detail?.interactInfo?.likedCount ?? "",
      collectedCount: detail?.interactInfo?.collectedCount ?? "",
      collected: detail?.interactInfo?.collected ?? false,
      commentCount: detail?.interactInfo?.commentCount ?? "",
      sharedCount: detail?.interactInfo?.sharedCount ?? "",
    },
    imageList: (detail?.imageList ?? []).map((image: any) => ({
      width: image.width ?? 0,
      height: image.height ?? 0,
      urlDefault: image.urlDefault ?? "",
    })),
  };
}

function formatComment(comment: any): Record<string, unknown> {
  return {
    id: comment?.id ?? "",
    content: comment?.content ?? "",
    likeCount: comment?.likeCount ?? "",
    createTime: comment?.createTime ?? 0,
    ipLocation: comment?.ipLocation ?? "",
    user: {
      userId: comment?.userInfo?.userId ?? "",
      nickname: comment?.userInfo?.nickname ?? comment?.userInfo?.nickName ?? "",
    },
    subCommentCount: comment?.subCommentCount ?? "",
    subComments: (comment?.subComments ?? []).map(formatComment),
  };
}

async function assertFeedPageAccessible(page: XhsPage): Promise<void> {
  const text = (await page.getElementText(ACCESS_ERROR_WRAPPER)).trim();
  if (!text) {
    return;
  }
  const matched = INACCESSIBLE_KEYWORDS.find((keyword) => text.includes(keyword));
  if (matched) {
    throw new Error(`笔记不可访问: ${matched}`);
  }
  throw new Error(`笔记不可访问: ${text}`);
}

async function loadAllCommentsIntoState(
  page: XhsPage,
  options: {
    clickMoreReplies: boolean;
    maxRepliesThreshold: number;
    maxCommentItems: number;
  },
): Promise<void> {
  await page.scrollElementIntoView(COMMENTS_CONTAINER);
  await sleep(1_000);
  let lastCount = 0;
  let stagnantRounds = 0;

  for (let index = 0; index < 120; index += 1) {
    if (await page.hasElement(END_CONTAINER)) {
      return;
    }

    if (options.clickMoreReplies) {
      await page.evaluate(`
        (() => {
          const buttons = document.querySelectorAll(${JSON.stringify(SHOW_MORE_BUTTON)});
          for (const button of buttons) {
            const text = button.textContent?.trim() ?? "";
            const match = text.match(/展开\\s*(\\d+)\\s*条回复/);
            if (match && Number(match[1]) > ${options.maxRepliesThreshold}) continue;
            button.click();
          }
        })()
      `);
    }

    const currentCount = await page.getElementsCount(PARENT_COMMENT);
    if (options.maxCommentItems > 0 && currentCount >= options.maxCommentItems) {
      return;
    }
    if (currentCount > 0) {
      await page.scrollNthElementIntoView(PARENT_COMMENT, currentCount - 1);
    }
    await page.evaluate("window.scrollBy(0, window.innerHeight * 0.8)");
    await sleep(stagnantRounds > 5 ? 1_200 : 700);

    if (currentCount === lastCount) {
      stagnantRounds += 1;
    } else {
      lastCount = currentCount;
      stagnantRounds = 0;
    }
    if (stagnantRounds >= 10) {
      return;
    }
  }
}

async function findAndScrollToComment(
  page: XhsPage,
  commentId?: string,
  userId?: string,
): Promise<boolean> {
  await page.scrollElementIntoView(COMMENTS_CONTAINER);
  await sleep(1_000);

  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (commentId && (await page.hasElement(`#comment-${commentId}`))) {
      await page.scrollElementIntoView(`#comment-${commentId}`);
      return true;
    }

    if (userId) {
      const found = await page.evaluateByValue<boolean>(`
        (() => {
          const comments = document.querySelectorAll(".parent-comment, .comment-item, .comment");
          for (const comment of comments) {
            if (comment.querySelector(${JSON.stringify(`[data-user-id="${userId}"]`)})) {
              comment.scrollIntoView({ behavior: "smooth", block: "center" });
              return true;
            }
          }
          return false;
        })()
      `);
      if (found) {
        return true;
      }
    }

    if (await page.hasElement(END_CONTAINER)) {
      return false;
    }

    const count = await page.getElementsCount(PARENT_COMMENT);
    if (count > 0) {
      await page.scrollNthElementIntoView(PARENT_COMMENT, count - 1);
      await sleep(300);
    }
    await page.evaluate("window.scrollBy(0, window.innerHeight * 0.8)");
    await sleep(800);
  }

  return false;
}

function likeStateTarget(unlike: boolean): ToggleTarget {
  return {
    buttonSelector: LIKE_BUTTON,
    actionName: unlike ? "取消点赞" : "点赞",
    desiredState: !unlike,
    readState: (detail) => detail?.liked ?? false,
  };
}

function favoriteStateTarget(unfavorite: boolean): ToggleTarget {
  return {
    buttonSelector: COLLECT_BUTTON,
    actionName: unfavorite ? "取消收藏" : "收藏",
    desiredState: !unfavorite,
    readState: (detail) => detail?.collected ?? false,
  };
}

type ToggleTarget = {
  buttonSelector: string;
  actionName: string;
  desiredState: boolean;
  readState: (detail: any) => boolean;
};

async function toggleInteractState(
  capabilityDiscovery: BrowserCapabilityDiscovery,
  feedId: string,
  xsecToken: string,
  target: ToggleTarget,
): Promise<unknown> {
  return await withTemporaryPage(capabilityDiscovery, async (page) => {
    await page.navigate(makeFeedDetailUrl(feedId, xsecToken));
    await page.waitDomStable();
    await sleep(1_000);
    const readCurrent = async (): Promise<boolean | null> => {
      try {
        const detailMap = await readInitialStateObject<Record<string, any>>(
          page,
          "note.noteDetailMap",
          "没有捕获到 feed 详情数据",
        );
        return target.readState(detailMap[feedId]?.note?.interactInfo);
      } catch {
        return null;
      }
    };

    const current = await readCurrent();
    if (current === target.desiredState) {
      return {
        feedId,
        success: true,
        message: `已${target.actionName}`,
      };
    }

    await page.clickElement(target.buttonSelector);
    await sleep(3_000);
    const next = await readCurrent();
    if (next !== target.desiredState) {
      await page.clickElement(target.buttonSelector);
      await sleep(2_000);
    }
    return {
      feedId,
      success: true,
      message: `${target.actionName}已执行`,
    };
  });
}

async function parsePublishImageArgs(args: Record<string, unknown>): Promise<PublishImageInput> {
  const title = requireString(args.title, "title");
  const content = requireString(args.content, "content");
  const imagePaths = await resolveUploadMedia(optionalStringArray(args.images), true);
  if (imagePaths.length === 0) {
    throw new Error("images is required");
  }
  return {
    title,
    content,
    imagePaths,
    tags: optionalStringArray(args.tags),
    scheduleAt: optionalString(args.scheduleAt),
    original: args.original === true,
    visibility: optionalString(args.visibility),
  };
}

async function parsePublishVideoArgs(args: Record<string, unknown>): Promise<PublishVideoInput> {
  const title = requireString(args.title, "title");
  const content = requireString(args.content, "content");
  const video = requireString(args.video, "video");
  const videoPath = resolveFileInputPath(video);
  await assertLocalFileExists(videoPath, "video");
  return {
    title,
    content,
    videoPath,
    tags: optionalStringArray(args.tags),
    scheduleAt: optionalString(args.scheduleAt),
    visibility: optionalString(args.visibility),
  };
}

type PublishImageInput = {
  title: string;
  content: string;
  imagePaths: string[];
  tags: string[];
  scheduleAt?: string;
  original: boolean;
  visibility?: string;
};

type PublishVideoInput = {
  title: string;
  content: string;
  videoPath: string;
  tags: string[];
  scheduleAt?: string;
  visibility?: string;
};

async function fillPublishImageForm(page: XhsPage, input: PublishImageInput): Promise<void> {
  await navigateToPublishPage(page);
  await clickPublishTab(page, "上传图文");
  await sleep(1_000);
  for (let index = 0; index < input.imagePaths.length; index += 1) {
    await page.setFileInput(index === 0 ? UPLOAD_INPUT : FILE_INPUT, [input.imagePaths[index]!]);
    await waitForImageUpload(page, index + 1);
    await sleep(1_000);
  }
  await fillCommonPublishForm(page, input);
}

async function fillPublishVideoForm(page: XhsPage, input: PublishVideoInput): Promise<void> {
  await navigateToPublishPage(page);
  await clickPublishTab(page, "上传视频");
  await sleep(1_000);
  await page.setFileInput((await page.hasElement(UPLOAD_INPUT)) ? UPLOAD_INPUT : FILE_INPUT, [
    input.videoPath,
  ]);
  await waitForPublishButtonClickable(page, 600_000);
  await fillCommonPublishForm(page, input);
}

async function fillCommonPublishForm(
  page: XhsPage,
  input: {
    title: string;
    content: string;
    tags: string[];
    scheduleAt?: string;
    visibility?: string;
    original?: boolean;
  },
): Promise<void> {
  const tagsFromContent = extractTagsFromContent(input.content, input.tags);
  if (calcTitleLength(input.title) > 20) {
    throw new Error(`当前输入长度为${calcTitleLength(input.title)}，最大长度为20`);
  }

  await page.inputText(TITLE_INPUT, input.title);
  await sleep(500);
  const contentSelector = await findContentElement(page);
  await page.inputContentEditable(contentSelector, tagsFromContent.cleanedContent);
  await sleep(1_000);
  await page.clickElement(TITLE_INPUT);
  if (tagsFromContent.tags.length > 0) {
    await inputTags(page, contentSelector, tagsFromContent.tags.slice(0, 10));
  }
  if (input.scheduleAt) {
    await setSchedulePublish(page, input.scheduleAt);
  }
  await setVisibility(page, input.visibility);
  if (input.original) {
    await setOriginal(page);
  }
}

async function navigateToPublishPage(page: XhsPage): Promise<void> {
  await page.navigate(PUBLISH_URL);
  await sleep(3_000);
  await page.waitDomStable();
  await sleep(2_000);
}

async function clickPublishTab(page: XhsPage, tabName: string): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const result = await page.evaluateByValue<string>(`
      (() => {
        const tabs = document.querySelectorAll(${JSON.stringify(CREATOR_TAB)});
        for (const tab of tabs) {
          const titleSpan = tab.querySelector("span.title");
          const tabText = titleSpan ? titleSpan.textContent?.trim() : tab.textContent?.trim();
          if (tabText !== ${JSON.stringify(tabName)}) continue;
          const rect = tab.getBoundingClientRect();
          const style = window.getComputedStyle(tab);
          if (!rect.width || !rect.height) continue;
          if (style.display === "none" || style.visibility === "hidden") continue;
          tab.click();
          return "clicked";
        }

        const allElements = document.querySelectorAll("*");
        for (const element of allElements) {
          if (element.children.length === 0 && element.textContent?.trim() === ${JSON.stringify(tabName)}) {
            const rect = element.getBoundingClientRect();
            const style = window.getComputedStyle(element);
            if (!rect.width || !rect.height) continue;
            if (style.display === "none" || style.visibility === "hidden") continue;
            element.click();
            return "clicked";
          }
        }
        return "not_found";
      })()
    `);
    if (result === "clicked") {
      return;
    }
    if (await page.hasElement(POPOVER)) {
      await page.removeElement(POPOVER);
    }
    await sleep(200);
  }
  throw new Error(`没有找到发布 TAB - ${tabName}`);
}

async function waitForImageUpload(page: XhsPage, expectedCount: number): Promise<void> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if ((await page.getElementsCount(IMAGE_PREVIEW)) >= expectedCount) {
      return;
    }
    await sleep(500);
  }
  throw new Error(`第${expectedCount}张图片上传超时(60s)`);
}

async function waitForPublishButtonClickable(page: XhsPage, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const clickable = await page.evaluateByValue<boolean>(`
      (() => {
        const button = document.querySelector(${JSON.stringify(PUBLISH_BUTTON)});
        if (!button) return false;
        const rect = button.getBoundingClientRect();
        if (!rect.width || !rect.height) return false;
        if (button.disabled) return false;
        return !button.classList.contains("disabled");
      })()
    `);
    if (clickable) {
      return;
    }
    await sleep(1_000);
  }
  throw new Error("等待发布按钮可点击超时");
}

async function clickPublishAndSettle(page: XhsPage, waitClickable = false): Promise<void> {
  if (waitClickable) {
    await waitForPublishButtonClickable(page, 600_000);
  }
  await page.clickElement(PUBLISH_BUTTON);
  await sleep(3_000);
}

function extractTagsFromContent(
  content: string,
  tags: string[],
): { cleanedContent: string; tags: string[] } {
  const lines = content.trimEnd().split("\n");
  const lastLine = lines.at(-1)?.trim() ?? "";
  if (!/^(#\S+\s*)+$/.test(lastLine)) {
    return { cleanedContent: content, tags: [...tags] };
  }
  const extracted = Array.from(lastLine.matchAll(/#(\S+)/g)).map((match) => match[1]!);
  const merged = [...tags];
  const seen = new Set(tags.map((entry) => entry.replace(/^#/, "")));
  for (const entry of extracted) {
    if (seen.has(entry)) {
      continue;
    }
    seen.add(entry);
    merged.push(entry);
  }
  return {
    cleanedContent: lines.slice(0, -1).join("\n").trimEnd(),
    tags: merged,
  };
}

async function findContentElement(page: XhsPage): Promise<string> {
  if (await page.hasElement(CONTENT_EDITOR)) {
    return CONTENT_EDITOR;
  }
  const found = await page.evaluateByValue<boolean>(`
    (() => {
      const paragraphs = document.querySelectorAll("p");
      for (const paragraph of paragraphs) {
        const placeholder = paragraph.getAttribute("data-placeholder");
        if (!placeholder?.includes("输入正文描述")) continue;
        let current = paragraph;
        for (let index = 0; index < 5; index += 1) {
          current = current.parentElement;
          if (!current) break;
          if (current.getAttribute("role") === "textbox") {
            return true;
          }
        }
      }
      return false;
    })()
  `);
  if (!found) {
    throw new Error("没有找到内容输入框");
  }
  return "[role='textbox']";
}

async function inputTags(page: XhsPage, contentSelector: string, tags: string[]): Promise<void> {
  await page.clickElement(contentSelector);
  await sleep(300);
  for (let index = 0; index < 20; index += 1) {
    await page.pressKey("ArrowDown", "ArrowDown", 40);
    await sleep(10);
  }
  await page.pressKey("Enter", "Enter", 13);
  await page.pressKey("Enter", "Enter", 13);
  await sleep(1_000);
  for (const rawTag of tags) {
    const tag = rawTag.replace(/^#/, "");
    await page.typeText("#", 0);
    await sleep(300);
    for (const character of tag) {
      await page.typeText(character, 0);
      await sleep(50 + Math.floor(Math.random() * 70));
    }
    await sleep(500);
    const itemSelector = `${TAG_TOPIC_CONTAINER} ${TAG_FIRST_ITEM}`;
    if (await page.hasElement(itemSelector)) {
      await page.clickElement(itemSelector);
    } else {
      await page.typeText(" ", 0);
    }
    await sleep(800);
  }
}

async function setSchedulePublish(page: XhsPage, scheduleAt: string): Promise<void> {
  const parsed = new Date(scheduleAt);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("scheduleAt must be a valid ISO8601 datetime");
  }
  const formatted = `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}-${String(
    parsed.getDate(),
  ).padStart(2, "0")} ${String(parsed.getHours()).padStart(2, "0")}:${String(
    parsed.getMinutes(),
  ).padStart(2, "0")}`;
  await page.clickElement(SCHEDULE_SWITCH);
  await sleep(800);
  await page.selectAllText(DATETIME_INPUT);
  await page.inputText(DATETIME_INPUT, formatted);
  await sleep(500);
}

async function setVisibility(page: XhsPage, visibility?: string): Promise<void> {
  if (!visibility || visibility === "公开可见") {
    return;
  }
  if (!["仅自己可见", "仅互关好友可见"].includes(visibility)) {
    throw new Error(
      "visibility must be one of 公开可见, 仅自己可见, 仅互关好友可见",
    );
  }
  await page.clickElement(VISIBILITY_DROPDOWN);
  await sleep(500);
  const clicked = await page.evaluateByValue<boolean>(`
    (() => {
      const options = document.querySelectorAll(${JSON.stringify(VISIBILITY_OPTIONS)});
      for (const option of options) {
        if (option.textContent?.includes(${JSON.stringify(visibility)})) {
          option.click();
          return true;
        }
      }
      return false;
    })()
  `);
  if (!clicked) {
    throw new Error(`未找到可见范围选项: ${visibility}`);
  }
  await sleep(200);
}

async function setOriginal(page: XhsPage): Promise<void> {
  const result = await page.evaluateByValue<string>(`
    (() => {
      const cards = document.querySelectorAll(${JSON.stringify(ORIGINAL_SWITCH_CARD)});
      for (const card of cards) {
        if (!card.textContent?.includes("原创声明")) continue;
        const switchElement = card.querySelector(${JSON.stringify(ORIGINAL_SWITCH)});
        if (!switchElement) continue;
        const input = switchElement.querySelector('input[type="checkbox"]');
        if (input?.checked) return "already_on";
        switchElement.click();
        return "clicked";
      }
      return "not_found";
    })()
  `);
  if (result === "not_found") {
    throw new Error("未找到原创声明选项");
  }
  if (result === "clicked") {
    await sleep(800);
    const confirmed = await page.evaluateByValue<string>(`
      (() => {
        const footers = document.querySelectorAll("div.footer");
        for (const footer of footers) {
          if (!footer.textContent?.includes("原创声明")) continue;
          const checkbox = footer.querySelector('div.d-checkbox input[type="checkbox"]');
          if (checkbox && !checkbox.checked) {
            checkbox.click();
          }
          const button = footer.querySelector("button.custom-button");
          if (button && !button.disabled && !button.classList.contains("disabled")) {
            button.click();
            return "clicked";
          }
        }
        return "not_found";
      })()
    `);
    if (confirmed !== "clicked") {
      throw new Error("未找到声明原创按钮");
    }
    await sleep(500);
  }
}

async function waitForTemplates(page: XhsPage): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if ((await page.getElementsCount(TEMPLATE_CARD)) > 0) {
      return;
    }
    await sleep(1_000);
  }
  throw new Error("等待模板卡片超时");
}

async function getTemplateNames(page: XhsPage): Promise<string[]> {
  return await page.evaluateByValue<string[]>(`
    (() => {
      const cards = document.querySelectorAll(${JSON.stringify(TEMPLATE_CARD)});
      return Array.from(cards).map((card, index) => {
        const title = card.querySelector(${JSON.stringify(TEMPLATE_TITLE)});
        return title?.textContent?.trim() || ("Template " + index);
      });
    })()
  `);
}

async function clickButtonByText(page: XhsPage, text: string): Promise<void> {
  const clicked = await page.evaluateByValue<boolean>(`
    (() => {
      const elements = document.querySelectorAll('button, [role="button"], span, div, a, [class*="btn"]');
      for (const element of elements) {
        if (element.textContent?.trim() !== ${JSON.stringify(text)}) continue;
        const rect = element.getBoundingClientRect();
        if (!rect.width || !rect.height) continue;
        element.click();
        return true;
      }
      return false;
    })()
  `);
  if (!clicked) {
    throw new Error(`未找到'${text}'按钮，页面结构可能已变化`);
  }
}

async function resolveUploadMedia(inputs: string[], allowRemote: boolean): Promise<string[]> {
  const resolved: string[] = [];
  for (const input of inputs) {
    const path = resolveFileInputPath(input);
    if (path.startsWith("http://") || path.startsWith("https://")) {
      if (!allowRemote) {
        throw new Error("Remote media URLs are not supported for this action");
      }
      resolved.push(await downloadRemoteFile(path));
      continue;
    }
    await assertLocalFileExists(path, "media file");
    resolved.push(path);
  }
  return resolved;
}

async function resolveLocalMediaList(inputs: string[]): Promise<string[]> {
  const resolved: string[] = [];
  for (const input of inputs) {
    const path = resolveFileInputPath(input);
    if (path.startsWith("http://") || path.startsWith("https://")) {
      throw new Error("long-article images must be local file paths");
    }
    await assertLocalFileExists(path, "image");
    resolved.push(path);
  }
  return resolved;
}

async function assertLocalFileExists(path: string, label: string): Promise<void> {
  try {
    await stat(path);
  } catch {
    throw new Error(`${label} does not exist: ${path}`);
  }
}

function publishImageSchema(): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      title: { type: "string" },
      content: { type: "string" },
      images: { type: "array", items: { type: "string" } },
      tags: { type: "array", items: { type: "string" } },
      scheduleAt: { type: "string" },
      original: { type: "boolean" },
      visibility: { type: "string" },
    },
    required: ["title", "content", "images"],
  };
}

function publishVideoSchema(): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      title: { type: "string" },
      content: { type: "string" },
      video: { type: "string" },
      tags: { type: "array", items: { type: "string" } },
      scheduleAt: { type: "string" },
      visibility: { type: "string" },
    },
    required: ["title", "content", "video"],
  };
}

function makeSearchUrl(keyword: string): string {
  const params = new URLSearchParams({
    keyword,
    source: "web_explore_feed",
  });
  return `https://www.xiaohongshu.com/search_result?${params.toString()}`;
}

function makeFeedDetailUrl(feedId: string, xsecToken: string): string {
  return `https://www.xiaohongshu.com/explore/${feedId}?xsec_token=${encodeURIComponent(
    xsecToken,
  )}&xsec_source=pc_feed`;
}

function makeUserProfileUrl(userId: string, xsecToken: string): string {
  return `https://www.xiaohongshu.com/user/profile/${userId}?xsec_token=${encodeURIComponent(
    xsecToken,
  )}&xsec_source=pc_note`;
}

function convertFilters(filters: {
  sortBy?: string;
  noteType?: string;
  publishTime?: string;
  searchScope?: string;
  location?: string;
}): Array<[number, number]> {
  const result: Array<[number, number]> = [];
  if (filters.sortBy) {
    result.push(findFilterOption(1, filters.sortBy));
  }
  if (filters.noteType) {
    result.push(findFilterOption(2, filters.noteType));
  }
  if (filters.publishTime) {
    result.push(findFilterOption(3, filters.publishTime));
  }
  if (filters.searchScope) {
    result.push(findFilterOption(4, filters.searchScope));
  }
  if (filters.location) {
    result.push(findFilterOption(5, filters.location));
  }
  return result;
}

function findFilterOption(groupIndex: number, text: string): [number, number] {
  const options = FILTER_OPTIONS[groupIndex];
  if (!options) {
    throw new Error(`筛选组 ${groupIndex} 不存在`);
  }
  const option = options.find((entry) => entry[1] === text);
  if (!option) {
    throw new Error(
      `在筛选组 ${groupIndex} 中未找到 '${text}'，有效值: ${options.map((entry) => entry[1]).join(", ")}`,
    );
  }
  return [groupIndex, option[0]];
}

function requireString(value: unknown, fieldName: string): string {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed) {
    throw new Error(`${fieldName} is required`);
  }
  return trimmed;
}

function optionalString(value: unknown): string | undefined {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed || undefined;
}

function optionalStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function positiveIntegerOrDefault(value: unknown, defaultValue: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return defaultValue;
  }
  return Math.floor(value);
}

function nonNegativeIntegerOrDefault(value: unknown, defaultValue: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return defaultValue;
  }
  return Math.floor(value);
}

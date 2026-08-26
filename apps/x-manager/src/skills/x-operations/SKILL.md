---
name: x-operations
description: Guide for managing X (Twitter) accounts — checking login status, learning brand voice, creating content, replying to comments, and monitoring metrics. Use this skill when the user asks about X/Twitter operations, content creation, or social media management.
tools: [Read, Write, Edit, Glob, Grep, Bash]
---

# X (Twitter) Operations Guide

## Overview

This skill covers the full X (Twitter) account management workflow using browser automation
via `opencli twitter` commands. The app provides actions for login checking, brand voice
learning, content creation, comment replies, and metrics polling.

## Prerequisites

Before any X operation, the user must be logged in to X in the desktop browser.
Use `x_check_login` to verify. If not logged in, direct the user to [desktop browser](/desktop)
to log in at https://x.com.

## Available Actions

| Action | Purpose | Side Effects |
|--------|---------|--------------|
| `x_check_login` | Check if user is logged in to X | read-only |
| `x_learn_brand_voice` | Analyze tweets and save brand voice to memory | write |
| `x_fetch_tweets` | Fetch recent tweets from a user | read-only |
| `x_post_tweet` | Post a new tweet | write |
| `x_reply_tweet` | Reply to a specific tweet | write |
| `x_fetch_notifications` | Fetch recent notifications | read-only |
| `x_poll_metrics` | Poll tweet metrics and process new comments | write |

## Available Agents

### Content Editor (`content-editor`)
Creates and edits tweets/threads based on topics or reference material. Always loads
the brand voice file first and never posts without user approval.

### Comment Reply (`comment-reply`)
Drafts replies to incoming comments and mentions. Loads brand voice for tone matching.
Presents drafts for user review before posting.

## Workflow: First-Time Setup

1. **Check login**: Run `x_check_login`
2. **Learn brand voice**: Run `x_learn_brand_voice` to analyze the account and create a
   memory file at `memory/x-{username}-brand-voice.md`
3. **Set up polling**: Run `x_poll_metrics` with `setupSchedule: true` to start 15-minute
   recurring checks

## Workflow: Content Creation

1. Load brand voice from `memory/x-{username}-brand-voice.md`
2. Create content matching the user's voice and style
3. Present draft to user for review
4. On approval, post via `x_post_tweet`

## Workflow: Comment Management

The `x_poll_metrics` action runs every 15 minutes and:
1. Fetches latest tweet metrics (views, likes, retweets, replies)
2. Checks for new notifications
3. For new reply/mention notifications, invokes the `comment-reply` agent
4. The agent drafts a reply and presents it to the user
5. User reviews and approves/edits before posting

## Brand Voice Memory File

The brand voice file (`memory/x-{username}-brand-voice.md`) contains:
- Voice & tone analysis
- Common topics and themes
- Writing style patterns
- Engagement metrics insights
- Language preferences
- Content format preferences
- Key phrases and expressions

All agents load this file before creating content or replies.

## OpenCLI Twitter Commands Reference

The app wraps `opencli twitter` which provides:
- `profile [username]` — user profile info
- `tweets <username>` — recent tweets
- `notifications` — notification feed
- `post <text>` — post a tweet
- `reply <url> <text>` — reply to a tweet
- `timeline` — home timeline
- `search <query>` — search tweets
- `thread <tweet-id>` — get a full thread
- `followers [user]` — follower list
- `following [user]` — following list
- `trending` — trending topics
- `likes [user]` — liked tweets
- `bookmarks` — saved bookmarks

## Metrics Storage

Poll results are stored in `~/.rome/default/apps/data/x/`:
- `last-poll.json` — last poll state (notification IDs to avoid dupes)
- `metrics-log.jsonl` — append-only log of all polled metrics over time

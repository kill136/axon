---
description: Create promo videos, GIFs, and distribute to social media (Twitter/X, Reddit, Discord). Captures screenshots from a web app, generates MP4/GIF, and posts with user confirmation. Use when user wants to make demo videos, promo materials, or post project announcements.
user-invocable: true
argument-hint: "[capture|video|gif|distribute <platform>]"
---

# Promo Video Pipeline

## Subcommands

| Argument | Action |
|----------|--------|
| `capture` | Screenshot a running web app |
| `video` | Screenshots -> MP4 promo video |
| `gif` | Screenshots -> animated GIF |
| `distribute twitter` | Post video to Twitter/X |
| `distribute reddit <sub>` | Post to Reddit subreddit |
| `distribute discord` | Post to Discord channels |
| (no args) | Full pipeline: capture -> video -> gif |

## Templates

All scripts live in `templates/` alongside this file. **Do not write from scratch** — copy the template, then modify the project-specific parts (marked below).

| Template | What to customize |
|----------|-------------------|
| `capture-demo.cjs` | `DEMO_URL`, Chrome path, page-specific selectors and navigation steps |
| `make-video.py` | Scene text (title, subtitle, features, GitHub URL), `SCENES` list, screenshot filenames |
| `make-gif.py` | `frames_config` list, title bar text |
| `distribute.cjs` | Tweet/post text, `CDP_URL` |
| `discord-post.cjs` | `MESSAGE` text, `CHROME_USER_DATA` path, target servers/channels |

## Step 1: Gather Project Info

Before doing anything, ask the user for:
1. **Project name and tagline**
2. **Web app URL** (for capture) or **existing screenshot paths** (for video/gif)
3. **Key features** (3-6 bullet points for video feature scene)
4. **GitHub URL** (for closing scene and posts)
5. **Target platforms** (for distribute)

## Step 2: Check Dependencies

```bash
# For capture
node -e "require('playwright-core')" 2>&1 || echo "MISSING: npm i -g playwright-core"

# For video
python -c "from PIL import Image; from moviepy import ImageSequenceClip" 2>&1 || echo "MISSING: pip install Pillow moviepy"

# For gif (Pillow only)
python -c "from PIL import Image" 2>&1 || echo "MISSING: pip install Pillow"
```

Report missing deps to user. Don't proceed until resolved.

## Step 3: Execute

### capture

1. Read `templates/capture-demo.cjs`
2. Copy to `{output_dir}/capture-demo.cjs`
3. Replace `DEMO_URL` with user's app URL
4. Replace Chrome executable path (auto-detect from platform)
5. Replace page navigation steps with user-specified pages (or use Browser tool snapshot to discover interactive elements)
6. Run: `node {output_dir}/capture-demo.cjs`
7. Verify output PNGs exist

### video

1. Read `templates/make-video.py`
2. Copy to `{output_dir}/make-video.py`
3. Replace all project-specific text:
   - `scene_opening`: project name, version, tagline, stats
   - `scene_screenshot` entries in `SCENES`: screenshot filenames, titles, subtitles
   - `scene_features`: feature list tuples
   - `scene_architecture`: box labels and connections (or remove if not relevant)
   - `scene_closing`: GitHub URL, Discord/community link
4. Run: `python {output_dir}/make-video.py`
5. Verify `promo-video.mp4` exists, report file size

### gif

1. Read `templates/make-gif.py`
2. Copy to `{output_dir}/make-gif.py`
3. Replace `frames_config` with actual screenshot files + captions
4. Replace title bar text (GitHub URL, stats)
5. Run: `python {output_dir}/make-gif.py`
6. Verify `demo.gif` exists, report file size

### distribute

Use the Browser tool (not the template scripts) for distribution. The templates are reference for selector patterns, but **always use Browser snapshot to find current refs** since social media sites change selectors frequently.

**Twitter/X:**
1. Browser start (profileName: 'default') -> goto `https://x.com/compose/post`
2. Browser snapshot -> find file upload input -> upload video
3. Wait 30s+ for processing
4. Browser snapshot -> find text area -> type post
5. Browser screenshot (for audit log, saved to demo-screenshots/)
6. Click post button

**Reddit:**
1. Browser start -> goto `https://www.reddit.com/r/{subreddit}/submit`
2. Browser snapshot -> find upload area -> upload video/image
3. Wait 45s+ for processing
4. Fill title and body
5. Browser screenshot -> **show to user, ask for confirmation**
6. Only after user says yes -> submit

**Discord:**
1. Browser start (with persistent profile for login)
2. Navigate to target server/channel
3. Browser snapshot -> find textbox (Slate editor, `[role="textbox"]`)
4. Type message line by line (Shift+Enter for newlines within Discord)
5. Browser screenshot -> **show to user, ask for confirmation**
6. Only after user says yes -> press Enter to send

## Hard Rules

1. **Use templates as base, don't generate scripts from scratch**
2. **Use Browser tool snapshot for social media selectors, not hardcoded selectors from templates**
3. **Default output directory: `demo-screenshots/` in project root**
4. **Automated posting (via ScheduleTask) skips user confirmation — take a screenshot for audit but post directly**

#!/usr/bin/env python3
"""
Claude Code Open — Professional Promo Video Generator
Generates a 60s MP4 (1920x1080, 30fps) from screenshots + Pillow graphics.
"""

import os, sys, math
from PIL import Image, ImageDraw, ImageFont, ImageFilter

# ── paths ──────────────────────────────────────────────
BASE   = os.path.dirname(os.path.abspath(__file__))
FRAMES = os.path.join(BASE, "video-frames")
OUT    = os.path.join(BASE, "promo-video.mp4")
os.makedirs(FRAMES, exist_ok=True)

# ── constants ──────────────────────────────────────────
W, H   = 1920, 1080
FPS    = 30
BG     = (13, 17, 30)        # dark navy (#0d111e)
ACCENT = (99, 102, 241)      # indigo-500
ACCENT2= (168, 85, 247)      # purple-500
WHITE  = (255, 255, 255)
GRAY   = (156, 163, 175)
DARK   = (30, 35, 55)

# ── font helpers ───────────────────────────────────────
def get_font(size, bold=False):
    """Try several common fonts, fall back to default."""
    candidates = [
        "C:/Windows/Fonts/seguisb.ttf" if bold else "C:/Windows/Fonts/segoeui.ttf",
        "C:/Windows/Fonts/arialbd.ttf" if bold else "C:/Windows/Fonts/arial.ttf",
        "C:/Windows/Fonts/calibrib.ttf" if bold else "C:/Windows/Fonts/calibri.ttf",
    ]
    for p in candidates:
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()

def get_cjk_font(size):
    """Get a font that supports CJK characters."""
    candidates = [
        "C:/Windows/Fonts/msyh.ttc",     # Microsoft YaHei
        "C:/Windows/Fonts/msyhbd.ttc",    # Microsoft YaHei Bold
        "C:/Windows/Fonts/simhei.ttf",    # SimHei
        "C:/Windows/Fonts/simsun.ttc",    # SimSun
    ]
    for p in candidates:
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return get_font(size, bold=True)

FONT_HUGE  = get_font(72, bold=True)
FONT_BIG   = get_font(48, bold=True)
FONT_MED   = get_font(36, bold=False)
FONT_SMALL = get_font(24, bold=False)
FONT_TAG   = get_font(28, bold=True)
FONT_CJK   = get_cjk_font(32)

# ── screenshot cache ───────────────────────────────────
_img_cache = {}
def load_screenshot(name):
    if name not in _img_cache:
        path = os.path.join(BASE, name)
        img = Image.open(path).convert("RGB")
        # fit to 1920x1080 keeping aspect
        img.thumbnail((W, H), Image.LANCZOS)
        _img_cache[name] = img
    return _img_cache[name]

# ── drawing helpers ────────────────────────────────────
def new_frame():
    return Image.new("RGB", (W, H), BG)

def center_text(draw, y, text, font, fill=WHITE):
    bbox = draw.textbbox((0, 0), text, font=font)
    tw = bbox[2] - bbox[0]
    draw.text(((W - tw) // 2, y), text, font=font, fill=fill)

def draw_gradient_bar(draw, y, width, height, color1, color2):
    """Draw a horizontal gradient bar."""
    x0 = (W - width) // 2
    for i in range(width):
        t = i / width
        r = int(color1[0] * (1 - t) + color2[0] * t)
        g = int(color1[1] * (1 - t) + color2[1] * t)
        b = int(color1[2] * (1 - t) + color2[2] * t)
        draw.rectangle([x0 + i, y, x0 + i + 1, y + height], fill=(r, g, b))

def draw_rounded_rect(draw, xy, radius, fill):
    x0, y0, x1, y1 = xy
    draw.rounded_rectangle(xy, radius=radius, fill=fill)

def paste_screenshot_centered(frame, img, y_offset=0):
    """Paste screenshot centered on frame."""
    x = (W - img.width) // 2
    y = (H - img.height) // 2 + y_offset
    frame.paste(img, (x, y))

def ease_in_out(t):
    """Smooth ease in-out."""
    return t * t * (3 - 2 * t)

# ── scene generators ──────────────────────────────────

def scene_opening(frame_idx, total_frames):
    """Scene 1: Opening title with animated elements (0-4s)"""
    img = new_frame()
    draw = ImageDraw.Draw(img)
    t = frame_idx / total_frames  # 0..1

    # animated gradient bar at top
    bar_w = int(W * ease_in_out(min(t * 2, 1.0)))
    if bar_w > 0:
        draw_gradient_bar(draw, 0, bar_w, 4, ACCENT, ACCENT2)

    # title fade in
    alpha = min(t * 3, 1.0)
    title_color = tuple(int(c * alpha) for c in WHITE)

    # main title
    center_text(draw, 320, "Claude Code Open", FONT_HUGE, fill=title_color)

    # version tag
    if t > 0.3:
        tag_alpha = min((t - 0.3) * 3, 1.0)
        tag_color = tuple(int(c * tag_alpha) for c in ACCENT)
        center_text(draw, 410, "v2.1.34  |  MIT License", FONT_MED, fill=tag_color)

    # subtitle
    if t > 0.5:
        sub_alpha = min((t - 0.5) * 3, 1.0)
        sub_color = tuple(int(c * sub_alpha) for c in GRAY)
        center_text(draw, 490, "The Open-Source Claude Code CLI Reimplementation", FONT_MED, fill=sub_color)

    # GitHub stats
    if t > 0.7:
        stat_alpha = min((t - 0.7) * 3, 1.0)
        stat_color = tuple(int(c * stat_alpha) for c in WHITE)
        center_text(draw, 580, "126+ Stars  |  47 Forks  |  37+ Tools", FONT_TAG, fill=stat_color)

    # bottom gradient bar
    if t > 0.4:
        bot_w = int(W * 0.3 * ease_in_out(min((t - 0.4) * 2, 1.0)))
        if bot_w > 0:
            draw_gradient_bar(draw, H - 4, bot_w, 4, ACCENT2, ACCENT)

    return img


def scene_screenshot(frame_idx, total_frames, screenshot_name, title, subtitle):
    """Generic screenshot showcase scene with zoom-in effect."""
    img = new_frame()
    draw = ImageDraw.Draw(img)
    t = frame_idx / total_frames

    # load and prepare screenshot
    ss = load_screenshot(screenshot_name)

    # zoom effect: start at 90% scale, end at 100%
    scale = 0.88 + 0.12 * ease_in_out(min(t * 1.5, 1.0))
    sw = int(ss.width * scale)
    sh = int(ss.height * scale)
    ss_scaled = ss.resize((sw, sh), Image.LANCZOS)

    # add shadow
    shadow = Image.new("RGB", (sw + 20, sh + 20), BG)
    shadow_draw = ImageDraw.Draw(shadow)
    shadow_draw.rounded_rectangle([0, 0, sw + 19, sh + 19], radius=12, fill=(0, 0, 0))

    # position: centered, slightly below top for title space
    y_top = 110
    x_center = (W - sw) // 2
    y_center = y_top + (H - y_top - sh) // 2

    # paste shadow then screenshot
    img.paste(shadow, (x_center - 10, y_center - 5))

    # add rounded corner mask to screenshot
    mask = Image.new("L", (sw, sh), 0)
    mask_draw = ImageDraw.Draw(mask)
    mask_draw.rounded_rectangle([0, 0, sw - 1, sh - 1], radius=8, fill=255)
    img.paste(ss_scaled, (x_center, y_center), mask)

    # title bar at top
    title_alpha = min(t * 4, 1.0)
    tc = tuple(int(c * title_alpha) for c in WHITE)
    sc = tuple(int(c * title_alpha) for c in ACCENT)

    center_text(draw, 20, title, FONT_BIG, fill=tc)
    center_text(draw, 72, subtitle, FONT_SMALL, fill=sc)

    # gradient accent line under title
    line_w = int(400 * ease_in_out(min(t * 2, 1.0)))
    if line_w > 0:
        draw_gradient_bar(draw, 105, line_w, 3, ACCENT, ACCENT2)

    return img


def scene_features(frame_idx, total_frames):
    """Scene: Feature list with staggered animation."""
    img = new_frame()
    draw = ImageDraw.Draw(img)
    t = frame_idx / total_frames

    # title
    center_text(draw, 60, "Why Claude Code Open?", FONT_BIG, fill=WHITE)
    draw_gradient_bar(draw, 120, 300, 3, ACCENT, ACCENT2)

    features = [
        ("37+ Tools",       "Bash, Read, Write, Edit, Glob, Grep, WebFetch, Browser, MCP..."),
        ("Multi-Agent",     "Blueprint system with Lead Agent + Worker swarm architecture"),
        ("Web IDE",         "Full-featured web interface with Monaco editor & real-time streaming"),
        ("Self-Evolution",  "AI can modify its own source code and hot-reload on the fly"),
        ("MCP Protocol",    "Full Model Context Protocol support for external tool servers"),
        ("One-Click Setup", "npm install && npm run dev — works on Windows, macOS, Linux"),
    ]

    for i, (title, desc) in enumerate(features):
        # stagger: each item starts 0.1 later
        item_t = max(0, (t - i * 0.1) * 2)
        if item_t <= 0:
            continue

        alpha = min(item_t, 1.0)
        # slide from right
        x_offset = int(60 * (1 - ease_in_out(min(item_t, 1.0))))

        y = 170 + i * 130
        x = 240 + x_offset

        # bullet dot
        dot_color = tuple(int(c * alpha) for c in ACCENT)
        draw.ellipse([x - 30, y + 8, x - 14, y + 24], fill=dot_color)

        # title
        tc = tuple(int(c * alpha) for c in WHITE)
        draw.text((x, y), title, font=FONT_TAG, fill=tc)

        # description
        dc = tuple(int(c * alpha) for c in GRAY)
        draw.text((x, y + 40), desc, font=FONT_SMALL, fill=dc)

        # separator line
        if i < len(features) - 1:
            lc = tuple(int(c * alpha) for c in (40, 45, 65))
            draw.line([(x, y + 110), (W - 240, y + 110)], fill=lc, width=1)

    return img


def scene_architecture(frame_idx, total_frames):
    """Scene: Architecture diagram."""
    img = new_frame()
    draw = ImageDraw.Draw(img)
    t = frame_idx / total_frames

    center_text(draw, 40, "Architecture Overview", FONT_BIG, fill=WHITE)
    draw_gradient_bar(draw, 100, 300, 3, ACCENT, ACCENT2)

    # boxes
    boxes = [
        # (x, y, w, h, label, color)
        (160, 180, 300, 80, "CLI / Web UI", ACCENT),
        (560, 180, 300, 80, "Core Engine", ACCENT2),
        (960, 180, 300, 80, "Claude API", (59, 130, 246)),
        (160, 340, 300, 80, "Tool Registry", (236, 72, 153)),
        (560, 340, 300, 80, "37+ Tools", (234, 179, 8)),
        (960, 340, 300, 80, "MCP Servers", (16, 185, 129)),
        (160, 500, 300, 80, "Blueprint", (249, 115, 22)),
        (560, 500, 300, 80, "Lead Agent", (139, 92, 246)),
        (960, 500, 300, 80, "Worker Swarm", (244, 63, 94)),
        (360, 660, 600, 80, "Session & Memory Persistence", (75, 85, 99)),
    ]

    for i, (x, y, w, h, label, color) in enumerate(boxes):
        item_t = max(0, (t - i * 0.06) * 2.5)
        if item_t <= 0:
            continue

        alpha = min(item_t, 1.0)
        scale = ease_in_out(min(item_t, 1.0))

        # actual position with scale
        cx, cy = x + w // 2, y + h // 2
        aw = int(w * scale)
        ah = int(h * scale)
        ax = cx - aw // 2
        ay = cy - ah // 2

        # box
        box_color = tuple(int(c * alpha * 0.3) for c in color)
        border_color = tuple(int(c * alpha) for c in color)
        draw.rounded_rectangle([ax, ay, ax + aw, ay + ah], radius=10, fill=box_color, outline=border_color, width=2)

        # label
        tc = tuple(int(c * alpha) for c in WHITE)
        bbox = draw.textbbox((0, 0), label, font=FONT_TAG)
        tw = bbox[2] - bbox[0]
        th = bbox[3] - bbox[1]
        draw.text((cx - tw // 2, cy - th // 2), label, font=FONT_TAG, fill=tc)

    # connection arrows (simple lines)
    if t > 0.3:
        arrow_alpha = min((t - 0.3) * 3, 1.0)
        ac = tuple(int(c * arrow_alpha) for c in (80, 85, 105))
        # row 1 connections
        draw.line([(460, 220), (560, 220)], fill=ac, width=2)
        draw.line([(860, 220), (960, 220)], fill=ac, width=2)
        # vertical connections
        draw.line([(310, 260), (310, 340)], fill=ac, width=2)
        draw.line([(710, 260), (710, 340)], fill=ac, width=2)
        draw.line([(1110, 260), (1110, 340)], fill=ac, width=2)
        # row 2 connections
        draw.line([(460, 380), (560, 380)], fill=ac, width=2)
        draw.line([(860, 380), (960, 380)], fill=ac, width=2)
        # to row 3
        draw.line([(310, 420), (310, 500)], fill=ac, width=2)
        draw.line([(710, 420), (710, 500)], fill=ac, width=2)
        draw.line([(1110, 420), (1110, 500)], fill=ac, width=2)
        # to bottom
        draw.line([(660, 580), (660, 660)], fill=ac, width=2)

    return img


def scene_closing(frame_idx, total_frames):
    """Scene: Closing CTA."""
    img = new_frame()
    draw = ImageDraw.Draw(img)
    t = frame_idx / total_frames

    # gradient background accent
    for y in range(H):
        yt = y / H
        r = int(BG[0] + (ACCENT[0] - BG[0]) * yt * 0.15)
        g = int(BG[1] + (ACCENT[1] - BG[1]) * yt * 0.15)
        b = int(BG[2] + (ACCENT[2] - BG[2]) * yt * 0.15)
        draw.line([(0, y), (W, y)], fill=(r, g, b))

    alpha = min(t * 2, 1.0)
    tc = tuple(int(c * alpha) for c in WHITE)
    ac = tuple(int(c * alpha) for c in ACCENT)
    gc = tuple(int(c * alpha) for c in GRAY)

    center_text(draw, 280, "Get Started Today", FONT_HUGE, fill=tc)

    # GitHub URL
    center_text(draw, 400, "github.com/kill136/claude-code-open", FONT_BIG, fill=ac)

    # features summary
    center_text(draw, 500, "MIT License  |  Free & Open Source  |  Community Driven", FONT_MED, fill=gc)

    # CTA button-like element
    if t > 0.4:
        btn_alpha = min((t - 0.4) * 3, 1.0)
        btn_w, btn_h = 500, 70
        bx = (W - btn_w) // 2
        by = 600
        btn_fill = tuple(int(c * btn_alpha) for c in ACCENT)
        draw.rounded_rectangle([bx, by, bx + btn_w, by + btn_h], radius=35, fill=btn_fill)
        # star text
        stc = (int(255 * btn_alpha), int(255 * btn_alpha), int(255 * btn_alpha))
        center_text(draw, by + 15, "Star on GitHub", FONT_TAG, fill=stc)

    # Discord
    if t > 0.6:
        disc_alpha = min((t - 0.6) * 3, 1.0)
        dc = tuple(int(c * disc_alpha) for c in GRAY)
        center_text(draw, 720, "Join our Discord: discord.gg/bNyJKk6PVZ", FONT_SMALL, fill=dc)

    # bottom gradient bar
    draw_gradient_bar(draw, H - 4, W, 4, ACCENT, ACCENT2)

    return img


# ── scene timeline ─────────────────────────────────────
# (generator_fn, duration_seconds, extra_args)
SCENES = [
    (scene_opening,     4, {}),
    (scene_screenshot,  5, {"screenshot_name": "01-main.png",
                            "title": "Web IDE Interface",
                            "subtitle": "Full-featured chat with Monaco editor, model selection & tool controls"}),
    (scene_screenshot,  5, {"screenshot_name": "02-blueprint.png",
                            "title": "Blueprint System",
                            "subtitle": "AI-powered project planning with structured requirements & task breakdown"}),
    (scene_screenshot,  5, {"screenshot_name": "05-typing.png",
                            "title": "Real-Time AI Streaming",
                            "subtitle": "Watch Claude think and code in real-time with streaming responses"}),
    (scene_features,    8, {}),
    (scene_architecture,7, {}),
    (scene_closing,     5, {}),
]

# ── transition: cross-fade between scenes ──────────────
TRANSITION_FRAMES = int(FPS * 0.5)  # 0.5s cross-fade

def generate_all_frames():
    """Generate all frames and save to disk."""
    total = sum(dur for _, dur, _ in SCENES)
    print(f"Generating {total}s video at {FPS}fps = {total * FPS} frames")
    print(f"Output: {OUT}")

    all_scene_frames = []

    for scene_idx, (gen_fn, duration, kwargs) in enumerate(SCENES):
        n_frames = duration * FPS
        print(f"  Scene {scene_idx + 1}/{len(SCENES)}: {gen_fn.__name__} ({duration}s, {n_frames} frames)")

        scene_frames = []
        for fi in range(n_frames):
            frame = gen_fn(fi, n_frames, **kwargs)
            scene_frames.append(frame)

        all_scene_frames.append(scene_frames)

    # apply cross-fade transitions
    print("Applying cross-fade transitions...")
    final_frames = []

    for scene_idx, frames in enumerate(all_scene_frames):
        if scene_idx == 0:
            final_frames.extend(frames)
        else:
            # cross-fade: blend last N frames of prev scene with first N of this scene
            n_blend = min(TRANSITION_FRAMES, len(final_frames), len(frames))
            # remove last n_blend from final
            base_tail = final_frames[-n_blend:]
            final_frames = final_frames[:-n_blend]

            for bi in range(n_blend):
                alpha = bi / n_blend
                blended = Image.blend(base_tail[bi], frames[bi], alpha)
                final_frames.append(blended)

            # add remaining frames from this scene
            final_frames.extend(frames[n_blend:])

    # save frames to disk
    print(f"Saving {len(final_frames)} frames to {FRAMES}/...")
    for i, frame in enumerate(final_frames):
        frame.save(os.path.join(FRAMES, f"frame_{i:05d}.png"))
        if (i + 1) % 100 == 0:
            print(f"    saved {i + 1}/{len(final_frames)}")

    return len(final_frames)


def compile_video(n_frames):
    """Compile frames into MP4 using moviepy."""
    print("Compiling MP4 with moviepy...")

    from moviepy import ImageSequenceClip

    # collect frame paths
    frame_paths = [os.path.join(FRAMES, f"frame_{i:05d}.png") for i in range(n_frames)]

    clip = ImageSequenceClip(frame_paths, fps=FPS)
    clip.write_videofile(
        OUT,
        codec="libx264",
        bitrate="5000k",
        preset="medium",
        logger="bar",
    )
    print(f"\nDone! Video saved to: {OUT}")
    size_mb = os.path.getsize(OUT) / (1024 * 1024)
    print(f"File size: {size_mb:.1f} MB")


if __name__ == "__main__":
    n = generate_all_frames()
    compile_video(n)

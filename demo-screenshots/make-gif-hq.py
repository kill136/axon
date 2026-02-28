"""Create a high-quality animated GIF for Discord promotion."""
from PIL import Image, ImageDraw, ImageFont, ImageSequence
import os

OUT_DIR = os.path.dirname(os.path.abspath(__file__))

# Screenshots in order, with captions
frames_config = [
    ('01-main.png', 'Axon - Web IDE'),
    ('05-typing.png', 'AI-Powered Coding Assistant'),
    ('02-blueprint.png', 'Blueprint Multi-Agent System'),
    ('03-swarm.png', 'Swarm Console - Agent Monitoring'),
]

TARGET_W = 1000
TARGET_H = 571  # maintain ~16:9

BANNER_H = 48
TITLE_H = 36

def add_overlays(img, caption, is_first=False):
    """Add title bar and caption banner."""
    draw = ImageDraw.Draw(img, 'RGBA')
    
    # Top title bar
    draw.rectangle(
        [(0, 0), (img.width, TITLE_H)],
        fill=(15, 15, 30, 200)
    )
    
    try:
        title_font = ImageFont.truetype("C:\\Windows\\Fonts\\arialbd.ttf", 16)
        caption_font = ImageFont.truetype("C:\\Windows\\Fonts\\arial.ttf", 22)
    except:
        title_font = ImageFont.load_default()
        caption_font = ImageFont.load_default()
    
    # Title text
    title = "github.com/kill136/axon  |  126 Stars  |  MIT License"
    bbox = draw.textbbox((0, 0), title, font=title_font)
    text_w = bbox[2] - bbox[0]
    draw.text(
        ((img.width - text_w) // 2, (TITLE_H - (bbox[3] - bbox[1])) // 2),
        title, fill=(200, 200, 255, 220), font=title_font
    )
    
    # Bottom caption banner
    banner_y = img.height - BANNER_H
    draw.rectangle(
        [(0, banner_y), (img.width, img.height)],
        fill=(0, 0, 0, 200)
    )
    
    bbox = draw.textbbox((0, 0), caption, font=caption_font)
    text_w = bbox[2] - bbox[0]
    text_x = (img.width - text_w) // 2
    text_y = banner_y + (BANNER_H - (bbox[3] - bbox[1])) // 2
    draw.text((text_x, text_y), caption, fill=(255, 255, 255, 245), font=caption_font)
    
    return img

frames = []
for i, (filename, caption) in enumerate(frames_config):
    filepath = os.path.join(OUT_DIR, filename)
    if not os.path.exists(filepath):
        print(f'  Skipping {filename}')
        continue
    
    print(f'  Processing {filename}...')
    img = Image.open(filepath).convert('RGBA')
    img = img.resize((TARGET_W, TARGET_H), Image.LANCZOS)
    img = add_overlays(img, caption, is_first=(i == 0))
    
    # Quantize to 256 colors for GIF but use better dithering
    rgb = img.convert('RGB')
    frames.append(rgb)

if not frames:
    print('No frames!')
    exit(1)

# Method 1: Standard GIF
gif_path = os.path.join(OUT_DIR, 'demo.gif')
frames[0].save(
    gif_path,
    save_all=True,
    append_images=frames[1:],
    duration=3000,  # 3 seconds per frame
    loop=0,
    optimize=False,  # better quality
)
print(f'GIF: {gif_path} ({os.path.getsize(gif_path) / 1024:.0f} KB, {len(frames)} frames)')

# Method 2: Also save individual PNGs for GitHub README / higher quality
for i, frame in enumerate(frames):
    png_path = os.path.join(OUT_DIR, f'slide-{i+1}.png')
    frame.save(png_path, optimize=True)
    print(f'PNG: {png_path} ({os.path.getsize(png_path) / 1024:.0f} KB)')

print('\nDone!')

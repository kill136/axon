"""Combine screenshots into an animated GIF for Discord promotion."""
from PIL import Image, ImageDraw, ImageFont
import os

OUT_DIR = os.path.dirname(os.path.abspath(__file__))

# Screenshots in order, with captions
frames_config = [
    ('01-main.png', 'Web IDE - Full Browser Experience'),
    ('05-typing.png', 'AI-Powered Coding Assistant'),
    ('02-blueprint.png', 'Blueprint Multi-Agent System'),
    ('03-swarm.png', 'Swarm Console - Real-time Monitoring'),
]

TARGET_W = 800
TARGET_H = 450
BANNER_H = 40

def add_caption(img, caption):
    """Add a semi-transparent caption banner at the bottom."""
    draw = ImageDraw.Draw(img, 'RGBA')
    
    # Semi-transparent banner at bottom
    banner_y = img.height - BANNER_H
    draw.rectangle(
        [(0, banner_y), (img.width, img.height)],
        fill=(0, 0, 0, 180)
    )
    
    # Try to use a nice font, fallback to default
    try:
        font = ImageFont.truetype("arial.ttf", 20)
    except:
        try:
            font = ImageFont.truetype("C:\\Windows\\Fonts\\arial.ttf", 20)
        except:
            font = ImageFont.load_default()
    
    # Center text
    bbox = draw.textbbox((0, 0), caption, font=font)
    text_w = bbox[2] - bbox[0]
    text_x = (img.width - text_w) // 2
    text_y = banner_y + (BANNER_H - (bbox[3] - bbox[1])) // 2
    
    draw.text((text_x, text_y), caption, fill=(255, 255, 255, 240), font=font)
    return img

frames = []
for filename, caption in frames_config:
    filepath = os.path.join(OUT_DIR, filename)
    if not os.path.exists(filepath):
        print(f'  Skipping {filename} (not found)')
        continue
    
    print(f'  Processing {filename}...')
    img = Image.open(filepath).convert('RGBA')
    
    # Resize to target
    img = img.resize((TARGET_W, TARGET_H), Image.LANCZOS)
    
    # Add caption
    img = add_caption(img, caption)
    
    # Convert to RGB for GIF (no alpha)
    frames.append(img.convert('RGB'))

if not frames:
    print('No frames found!')
    exit(1)

# Save as animated GIF
gif_path = os.path.join(OUT_DIR, 'demo.gif')
frames[0].save(
    gif_path,
    save_all=True,
    append_images=frames[1:],
    duration=2500,  # 2.5 seconds per frame
    loop=0,  # infinite loop
    optimize=True,
)

file_size = os.path.getsize(gif_path)
print(f'\nGIF saved: {gif_path}')
print(f'Size: {file_size / 1024:.0f} KB')
print(f'Frames: {len(frames)}')

# Also save a smaller version for Discord (max 8MB for free, 50MB for Nitro)
if file_size > 8 * 1024 * 1024:
    print('Warning: GIF is over 8MB, creating smaller version...')
    small_frames = []
    for frame in frames:
        small = frame.resize((600, 338), Image.LANCZOS)
        small_frames.append(small)
    
    small_path = os.path.join(OUT_DIR, 'demo-small.gif')
    small_frames[0].save(
        small_path,
        save_all=True,
        append_images=small_frames[1:],
        duration=2500,
        loop=0,
        optimize=True,
    )
    print(f'Small GIF saved: {small_path} ({os.path.getsize(small_path) / 1024:.0f} KB)')

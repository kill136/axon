---
description: "Control the webcam as Claude's eye - capture images, detect motion, recognize faces, and observe the physical world. Use when the user asks Claude to look, see, observe, watch, or interact with the physical environment through the camera."
user-invocable: true
argument-hint: "<command> [options]"
allowed-tools: Bash(camera-eye:*), Read
---

# Camera Eye - Claude's Vision

This skill gives Claude the ability to "see" the physical world through the computer's webcam, simulating human eye perception.

## CRITICAL RULES

1. **Absolute honesty about what you see.** After reading a captured image, describe ONLY what is actually visible in the image. NEVER fabricate, hallucinate, or assume content. If the image is dark, blurry, shows a test pattern, or you cannot determine the content, say exactly that. Saying "I see a person" when there is no person is a serious violation.
2. **Verify camera type.** Virtual cameras (OBS, ManyCam, etc.) may output test patterns or synthetic content. If the captured image looks like a test pattern, solid color, or synthetic content, explicitly tell the user it may be a virtual camera and suggest trying a different `--camera N` index.
3. **Auto-detect script path.** The script location varies by installation. ALWAYS use the absolute path to `camera.py`. First check `~/.axon/skills/camera-eye/camera.py`, then fall back to `.axon/skills/camera-eye/camera.py` relative to the project root. NEVER hardcode `.claude/skills/camera-eye/camera.py`.

## Philosophy

The camera is Claude's eye. Each command maps to a natural human visual action:
- **look** = glance at something (single capture for AI analysis)
- **capture** = take a photo (save a snapshot)
- **burst** = scan a scene (multiple quick captures)
- **watch** = stare at something (continuous observation)
- **motion** = peripheral vision (detect movement)
- **faces** = recognize people
- **compare** = spot the difference

## Commands

All commands use the Python script. Locate it with: `find ~/.axon/skills/camera-eye/ -name camera.py` or use the absolute path directly.

### Look (Primary - for AI vision)

Capture a frame and save it for Claude to analyze with the Read tool:

```bash
python ~/.axon/skills/camera-eye/camera.py look
```

Returns a JSON with the image `path`. Then use the **Read** tool to view the image and describe what you see.

### List Cameras

```bash
python ~/.axon/skills/camera-eye/camera.py list
```

### Capture a Photo

```bash
python ~/.axon/skills/camera-eye/camera.py capture
python ~/.axon/skills/camera-eye/camera.py capture --camera 1
python ~/.axon/skills/camera-eye/camera.py capture --output photo.png
```

### Burst Capture (Scan)

```bash
python ~/.axon/skills/camera-eye/camera.py burst --count 5 --interval 0.5
```

### Watch (Continuous)

```bash
python ~/.axon/skills/camera-eye/camera.py watch --duration 10 --fps 2
```

### Motion Detection

```bash
python ~/.axon/skills/camera-eye/camera.py motion --duration 10 --threshold 25
```

### Face Detection

```bash
python ~/.axon/skills/camera-eye/camera.py faces
```

### Compare Two Frames

```bash
python ~/.axon/skills/camera-eye/camera.py compare path1.png path2.png
```

## Typical Workflow

1. **User asks "What do you see?" or "Look at me"**
   ```bash
   python ~/.axon/skills/camera-eye/camera.py look
   ```
   Then use Read tool on the returned image path to view and describe it.

2. **User asks "Is anyone there?" or "Who's in front of the camera?"**
   ```bash
   python ~/.axon/skills/camera-eye/camera.py faces
   ```
   Then Read the output image to see detected faces.

3. **User asks "Watch for movement" or "Tell me if something moves"**
   ```bash
   python ~/.axon/skills/camera-eye/camera.py motion --duration 30
   ```
   Then Read each motion event image to describe what moved.

4. **User asks "What changed?"**
   Capture two frames at different times, then:
   ```bash
   python ~/.axon/skills/camera-eye/camera.py compare frame1.png frame2.png
   ```

## Output

All commands output JSON to stdout. Images are saved to `~/.claude/camera/` by default.

## Requirements

- Python 3.x with OpenCV (`pip install opencv-python`)
- A connected webcam/camera
- Windows: Uses DirectShow (CAP_DSHOW) backend

## Notes

- The camera needs ~15 frames to warm up (auto-exposure/white balance), this is handled automatically
- On first use, Windows may prompt for camera permission
- Multiple cameras are supported via `--camera N` parameter

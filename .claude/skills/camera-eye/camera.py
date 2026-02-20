#!/usr/bin/env python3
"""
Camera Eye - Claude's vision through the webcam.
Captures images from the camera, simulating human eye perception.
"""

import cv2
import sys
import os
import json
import base64
import time
import argparse
from pathlib import Path
from datetime import datetime


def get_output_dir():
    """Get the output directory for captured images."""
    out = Path(os.environ.get("CAMERA_OUTPUT_DIR", os.path.join(os.path.expanduser("~"), ".claude", "camera")))
    out.mkdir(parents=True, exist_ok=True)
    return out


def list_cameras(max_check=5):
    """List available camera devices."""
    cameras = []
    for i in range(max_check):
        cap = cv2.VideoCapture(i, cv2.CAP_DSHOW)
        if cap.isOpened():
            w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
            h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
            cameras.append({"index": i, "resolution": f"{w}x{h}"})
            cap.release()
    return cameras


def capture(camera_index=0, output_path=None, warmup_frames=15):
    """Capture a single frame from the camera (like blinking an eye)."""
    cap = cv2.VideoCapture(camera_index, cv2.CAP_DSHOW)
    if not cap.isOpened():
        return {"error": f"Cannot open camera {camera_index}"}

    # Warm up the camera (auto-exposure, white balance)
    for _ in range(warmup_frames):
        cap.read()

    ret, frame = cap.read()
    cap.release()

    if not ret:
        return {"error": "Failed to capture frame"}

    if output_path is None:
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        output_path = str(get_output_dir() / f"eye_{ts}.png")

    cv2.imwrite(output_path, frame)
    h, w = frame.shape[:2]
    return {"path": output_path, "resolution": f"{w}x{h}", "timestamp": datetime.now().isoformat()}


def capture_burst(camera_index=0, count=5, interval=0.5):
    """Capture a burst of frames (like scanning a scene with your eyes)."""
    cap = cv2.VideoCapture(camera_index, cv2.CAP_DSHOW)
    if not cap.isOpened():
        return {"error": f"Cannot open camera {camera_index}"}

    # Warm up
    for _ in range(15):
        cap.read()

    results = []
    out_dir = get_output_dir()
    ts_base = datetime.now().strftime("%Y%m%d_%H%M%S")

    for i in range(count):
        ret, frame = cap.read()
        if ret:
            path = str(out_dir / f"eye_{ts_base}_{i:03d}.png")
            cv2.imwrite(path, frame)
            h, w = frame.shape[:2]
            results.append({"path": path, "resolution": f"{w}x{h}", "frame": i})
        if i < count - 1:
            time.sleep(interval)

    cap.release()
    return {"frames": results, "count": len(results)}


def capture_base64(camera_index=0, warmup_frames=15, max_width=1280):
    """Capture a frame and return as base64 (for direct AI vision input)."""
    cap = cv2.VideoCapture(camera_index, cv2.CAP_DSHOW)
    if not cap.isOpened():
        return {"error": f"Cannot open camera {camera_index}"}

    for _ in range(warmup_frames):
        cap.read()

    ret, frame = cap.read()
    cap.release()

    if not ret:
        return {"error": "Failed to capture frame"}

    # Resize if too large
    h, w = frame.shape[:2]
    if w > max_width:
        scale = max_width / w
        frame = cv2.resize(frame, (max_width, int(h * scale)))
        h, w = frame.shape[:2]

    # Also save to file for Read tool
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    output_path = str(get_output_dir() / f"eye_{ts}.png")
    cv2.imwrite(output_path, frame)

    return {"path": output_path, "resolution": f"{w}x{h}", "timestamp": datetime.now().isoformat()}


def watch(camera_index=0, duration=10, fps=2):
    """Watch continuously for a duration, saving key frames (like staring at something)."""
    cap = cv2.VideoCapture(camera_index, cv2.CAP_DSHOW)
    if not cap.isOpened():
        return {"error": f"Cannot open camera {camera_index}"}

    for _ in range(15):
        cap.read()

    out_dir = get_output_dir()
    ts_base = datetime.now().strftime("%Y%m%d_%H%M%S")
    interval = 1.0 / fps
    results = []
    start = time.time()
    frame_idx = 0

    while time.time() - start < duration:
        ret, frame = cap.read()
        if ret:
            path = str(out_dir / f"watch_{ts_base}_{frame_idx:04d}.png")
            cv2.imwrite(path, frame)
            h, w = frame.shape[:2]
            results.append({"path": path, "resolution": f"{w}x{h}", "time_offset": round(time.time() - start, 2)})
            frame_idx += 1
        time.sleep(interval)

    cap.release()
    return {"frames": results, "count": len(results), "duration": round(time.time() - start, 2)}


def detect_motion(camera_index=0, duration=10, threshold=25, min_area=500):
    """Detect motion in the camera feed (like noticing movement with peripheral vision)."""
    cap = cv2.VideoCapture(camera_index, cv2.CAP_DSHOW)
    if not cap.isOpened():
        return {"error": f"Cannot open camera {camera_index}"}

    for _ in range(15):
        cap.read()

    ret, prev_frame = cap.read()
    if not ret:
        cap.release()
        return {"error": "Failed to read initial frame"}

    prev_gray = cv2.cvtColor(prev_frame, cv2.COLOR_BGR2GRAY)
    prev_gray = cv2.GaussianBlur(prev_gray, (21, 21), 0)

    out_dir = get_output_dir()
    ts_base = datetime.now().strftime("%Y%m%d_%H%M%S")
    events = []
    start = time.time()
    frame_idx = 0

    while time.time() - start < duration:
        ret, frame = cap.read()
        if not ret:
            continue

        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        gray = cv2.GaussianBlur(gray, (21, 21), 0)

        delta = cv2.absdiff(prev_gray, gray)
        thresh = cv2.threshold(delta, threshold, 255, cv2.THRESH_BINARY)[1]
        thresh = cv2.dilate(thresh, None, iterations=2)

        contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        motion_detected = False

        for contour in contours:
            if cv2.contourArea(contour) >= min_area:
                motion_detected = True
                (x, y, w, h) = cv2.boundingRect(contour)
                cv2.rectangle(frame, (x, y), (x + w, y + h), (0, 255, 0), 2)

        if motion_detected:
            path = str(out_dir / f"motion_{ts_base}_{frame_idx:04d}.png")
            cv2.imwrite(path, frame)
            fh, fw = frame.shape[:2]
            events.append({
                "path": path,
                "resolution": f"{fw}x{fh}",
                "time_offset": round(time.time() - start, 2),
            })
            frame_idx += 1

        prev_gray = gray
        time.sleep(0.1)

    cap.release()
    return {"motion_events": events, "count": len(events), "duration": round(time.time() - start, 2)}


def detect_faces(camera_index=0):
    """Detect faces in the current camera view (like recognizing people)."""
    cap = cv2.VideoCapture(camera_index, cv2.CAP_DSHOW)
    if not cap.isOpened():
        return {"error": f"Cannot open camera {camera_index}"}

    for _ in range(15):
        cap.read()

    ret, frame = cap.read()
    cap.release()

    if not ret:
        return {"error": "Failed to capture frame"}

    cascade_path = cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
    face_cascade = cv2.CascadeClassifier(cascade_path)
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    faces = face_cascade.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=5, minSize=(30, 30))

    for (x, y, w, h) in faces:
        cv2.rectangle(frame, (x, y), (x + w, y + h), (0, 255, 0), 2)

    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    output_path = str(get_output_dir() / f"faces_{ts}.png")
    cv2.imwrite(output_path, frame)
    fh, fw = frame.shape[:2]

    face_list = [{"x": int(x), "y": int(y), "w": int(w), "h": int(h)} for (x, y, w, h) in faces]
    return {"path": output_path, "resolution": f"{fw}x{fh}", "faces": face_list, "face_count": len(face_list)}


def compare_frames(path1, path2):
    """Compare two captured frames (like noticing what changed)."""
    img1 = cv2.imread(path1)
    img2 = cv2.imread(path2)
    if img1 is None or img2 is None:
        return {"error": "Cannot read one or both images"}

    # Resize to same dimensions
    h1, w1 = img1.shape[:2]
    h2, w2 = img2.shape[:2]
    if (h1, w1) != (h2, w2):
        img2 = cv2.resize(img2, (w1, h1))

    gray1 = cv2.cvtColor(img1, cv2.COLOR_BGR2GRAY)
    gray2 = cv2.cvtColor(img2, cv2.COLOR_BGR2GRAY)

    diff = cv2.absdiff(gray1, gray2)
    _, thresh = cv2.threshold(diff, 30, 255, cv2.THRESH_BINARY)
    changed_pixels = cv2.countNonZero(thresh)
    total_pixels = h1 * w1
    change_pct = round(changed_pixels / total_pixels * 100, 2)

    # Save diff visualization
    diff_color = cv2.cvtColor(diff, cv2.COLOR_GRAY2BGR)
    diff_color[:, :, 0] = 0  # Remove blue
    diff_color[:, :, 2] = 0  # Remove red, keep green channel for diff

    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    diff_path = str(get_output_dir() / f"diff_{ts}.png")
    cv2.imwrite(diff_path, diff_color)

    return {"diff_path": diff_path, "change_percent": change_pct, "changed_pixels": changed_pixels}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Camera Eye - Claude's vision")
    sub = parser.add_subparsers(dest="command")

    # list
    sub.add_parser("list", help="List available cameras")

    # capture
    cap_p = sub.add_parser("capture", help="Capture a single frame")
    cap_p.add_argument("--camera", type=int, default=0)
    cap_p.add_argument("--output", type=str, default=None)

    # burst
    burst_p = sub.add_parser("burst", help="Capture burst of frames")
    burst_p.add_argument("--camera", type=int, default=0)
    burst_p.add_argument("--count", type=int, default=5)
    burst_p.add_argument("--interval", type=float, default=0.5)

    # base64
    b64_p = sub.add_parser("look", help="Capture and return for AI vision")
    b64_p.add_argument("--camera", type=int, default=0)

    # watch
    watch_p = sub.add_parser("watch", help="Watch continuously")
    watch_p.add_argument("--camera", type=int, default=0)
    watch_p.add_argument("--duration", type=int, default=10)
    watch_p.add_argument("--fps", type=float, default=2)

    # motion
    motion_p = sub.add_parser("motion", help="Detect motion")
    motion_p.add_argument("--camera", type=int, default=0)
    motion_p.add_argument("--duration", type=int, default=10)
    motion_p.add_argument("--threshold", type=int, default=25)

    # faces
    face_p = sub.add_parser("faces", help="Detect faces")
    face_p.add_argument("--camera", type=int, default=0)

    # compare
    cmp_p = sub.add_parser("compare", help="Compare two frames")
    cmp_p.add_argument("path1", type=str)
    cmp_p.add_argument("path2", type=str)

    args = parser.parse_args()

    if args.command == "list":
        result = list_cameras()
    elif args.command == "capture":
        result = capture(args.camera, args.output)
    elif args.command == "burst":
        result = capture_burst(args.camera, args.count, args.interval)
    elif args.command == "look":
        result = capture_base64(args.camera)
    elif args.command == "watch":
        result = watch(args.camera, args.duration, args.fps)
    elif args.command == "motion":
        result = detect_motion(args.camera, args.duration, args.threshold)
    elif args.command == "faces":
        result = detect_faces(args.camera)
    elif args.command == "compare":
        result = compare_frames(args.path1, args.path2)
    else:
        parser.print_help()
        sys.exit(0)

    print(json.dumps(result, ensure_ascii=False, indent=2))

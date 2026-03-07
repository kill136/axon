#!/usr/bin/env python3
"""
Perception Daemon — unified sensory system.

A single process that keeps devices open in memory and serves frames/audio
on demand via a local HTTP API. No continuous disk writes.

Endpoints:
  GET /eye         → capture current frame, write to disk, return path + metadata
  GET /eye/status  → daemon and camera status
  GET /ear         → (future) return recent speech-to-text transcription
  GET /status      → overall daemon status
  POST /stop       → graceful shutdown

The daemon also manages its own PID file for lifecycle management.

Usage (managed by TypeScript, not called directly):
  python camera.py --port 7890 --camera 0
"""

import cv2
import sys
import os
import json
import time
import signal
import threading
import argparse
from pathlib import Path
from datetime import datetime
from http.server import HTTPServer, BaseHTTPRequestHandler

import numpy as np

# ── Config ─────────────────────────────────────────────────────────────────

EYE_DIR = Path(os.environ.get("AXON_EYE_DIR", os.path.join(os.path.expanduser("~"), ".axon", "eye")))


def ensure_dir():
    EYE_DIR.mkdir(parents=True, exist_ok=True)
    return EYE_DIR


# ── Virtual camera detection ───────────────────────────────────────────────

def _is_virtual_camera(cap, warmup=10):
    for _ in range(warmup):
        cap.read()
    ret, frame = cap.read()
    if not ret or frame is None:
        return True
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    if len(np.unique(gray)) < 30:
        return True
    hist = cv2.calcHist([gray], [0], None, [256], [0, 256])
    if hist.max() / (gray.shape[0] * gray.shape[1]) > 0.85:
        return True
    return False


def find_real_camera(max_check=5):
    backend = cv2.CAP_DSHOW if sys.platform == "win32" else 0
    for i in range(max_check):
        cap = cv2.VideoCapture(i, backend)
        if not cap.isOpened():
            continue
        if not _is_virtual_camera(cap):
            cap.release()
            return i
        cap.release()
    return -1


def resolve_camera(requested_index):
    if requested_index != 0:
        return requested_index
    backend = cv2.CAP_DSHOW if sys.platform == "win32" else 0
    cap = cv2.VideoCapture(0, backend)
    if not cap.isOpened():
        return 0
    is_virtual = _is_virtual_camera(cap)
    cap.release()
    if not is_virtual:
        return 0
    real = find_real_camera()
    return real if real >= 0 else 0


def list_cameras(max_check=5):
    cameras = []
    backend = cv2.CAP_DSHOW if sys.platform == "win32" else 0
    for i in range(max_check):
        cap = cv2.VideoCapture(i, backend)
        if cap.isOpened():
            w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
            h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
            is_virtual = _is_virtual_camera(cap)
            cameras.append({"index": i, "resolution": f"{w}x{h}", "virtual": is_virtual})
            cap.release()
    return cameras


# ── PID management ─────────────────────────────────────────────────────────

def pid_file():
    return ensure_dir() / "eye.pid"


def port_file():
    return ensure_dir() / "eye.port"


def write_pid():
    pid_file().write_text(str(os.getpid()))


def write_port(port):
    port_file().write_text(str(port))


def remove_pid():
    for f in [pid_file(), port_file()]:
        if f.exists():
            try:
                f.unlink()
            except OSError:
                pass


# ── Camera capture thread ──────────────────────────────────────────────────

class CameraThread:
    """Keeps the camera open and continuously reads frames into memory."""

    def __init__(self, camera_index, interval=0.5):
        self.camera_index = camera_index
        self.interval = interval
        self._frame = None
        self._frame_time = None
        self._frame_count = 0
        self._lock = threading.Lock()
        self._running = False
        self._thread = None
        self._resolution = None
        self._error = None

    def start(self):
        self._running = True
        self._thread = threading.Thread(target=self._loop, daemon=True)
        self._thread.start()

    def stop(self):
        self._running = False
        if self._thread:
            self._thread.join(timeout=3)

    def _loop(self):
        backend = cv2.CAP_DSHOW if sys.platform == "win32" else 0
        cap = cv2.VideoCapture(self.camera_index, backend)
        if not cap.isOpened():
            self._error = f"Cannot open camera {self.camera_index}"
            return

        # Warm up
        for _ in range(15):
            cap.read()

        error_streak = 0
        while self._running:
            ret, frame = cap.read()
            if not ret:
                error_streak += 1
                if error_streak > 20:
                    self._error = "20 consecutive read failures"
                    break
                time.sleep(self.interval)
                continue

            error_streak = 0
            with self._lock:
                self._frame = frame
                self._frame_time = time.time()
                self._frame_count += 1
                if self._resolution is None:
                    h, w = frame.shape[:2]
                    self._resolution = f"{w}x{h}"

            time.sleep(self.interval)

        cap.release()

    def get_frame(self):
        """Get the latest frame (thread-safe). Returns (frame, timestamp, count) or (None, None, 0)."""
        with self._lock:
            return self._frame, self._frame_time, self._frame_count

    @property
    def resolution(self):
        with self._lock:
            return self._resolution

    @property
    def frame_count(self):
        with self._lock:
            return self._frame_count

    @property
    def error(self):
        return self._error

    @property
    def is_alive(self):
        return self._running and self._thread and self._thread.is_alive()


# ── HTTP API ───────────────────────────────────────────────────────────────

camera_thread: CameraThread = None
http_server: HTTPServer = None


class PerceptionHandler(BaseHTTPRequestHandler):
    """HTTP request handler for the perception daemon."""

    def log_message(self, format, *args):
        # Suppress default request logging
        pass

    def _json_response(self, data, status=200):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(data, ensure_ascii=False).encode("utf-8"))

    def do_GET(self):
        if self.path == "/eye":
            self._handle_eye()
        elif self.path == "/eye/status":
            self._handle_eye_status()
        elif self.path == "/status":
            self._handle_status()
        elif self.path == "/list":
            self._json_response(list_cameras())
        else:
            self._json_response({"error": "Not found"}, 404)

    def do_POST(self):
        if self.path == "/stop":
            self._json_response({"status": "stopping"})
            # Schedule shutdown in a separate thread to let the response complete
            threading.Thread(target=self._shutdown, daemon=True).start()
        else:
            self._json_response({"error": "Not found"}, 404)

    def _handle_eye(self):
        """Capture current frame from memory, write to disk, return path."""
        global camera_thread
        if camera_thread is None or not camera_thread.is_alive:
            self._json_response({"error": "Camera not running", "detail": camera_thread.error if camera_thread else None}, 503)
            return

        frame, frame_time, count = camera_thread.get_frame()
        if frame is None:
            self._json_response({"error": "No frame available yet"}, 503)
            return

        # Write to disk (only when requested — not continuously)
        d = ensure_dir()
        latest_path = str(d / "latest.png")
        tmp_path = str(d / "latest_tmp.png")
        cv2.imwrite(tmp_path, frame)
        try:
            if os.path.exists(latest_path):
                os.remove(latest_path)
            os.rename(tmp_path, latest_path)
        except OSError:
            cv2.imwrite(latest_path, frame)

        h, w = frame.shape[:2]
        self._json_response({
            "path": latest_path,
            "resolution": f"{w}x{h}",
            "timestamp": datetime.fromtimestamp(frame_time).isoformat() if frame_time else None,
            "frame_count": count,
            "age_ms": round((time.time() - frame_time) * 1000) if frame_time else None,
        })

    def _handle_eye_status(self):
        global camera_thread
        alive = camera_thread is not None and camera_thread.is_alive
        result = {
            "running": alive,
            "resolution": camera_thread.resolution if camera_thread else None,
            "frame_count": camera_thread.frame_count if camera_thread else 0,
            "error": camera_thread.error if camera_thread else None,
            "camera_index": camera_thread.camera_index if camera_thread else None,
        }
        self._json_response(result)

    def _handle_status(self):
        global camera_thread
        self._json_response({
            "daemon": "running",
            "pid": os.getpid(),
            "eye": {
                "running": camera_thread is not None and camera_thread.is_alive,
                "resolution": camera_thread.resolution if camera_thread else None,
                "frame_count": camera_thread.frame_count if camera_thread else 0,
                "error": camera_thread.error if camera_thread else None,
            },
            "ear": {
                "running": False,
                "note": "Not implemented yet",
            },
        })

    def _shutdown(self):
        time.sleep(0.5)  # Let response finish
        global http_server, camera_thread
        if camera_thread:
            camera_thread.stop()
        if http_server:
            http_server.shutdown()


# ── Main daemon ────────────────────────────────────────────────────────────

def run_daemon(port, camera_index, interval):
    global camera_thread, http_server

    ensure_dir()
    log_path = str(EYE_DIR / "eye.log")

    def log(msg):
        ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        with open(log_path, "a", encoding="utf-8") as f:
            f.write(f"[{ts}] {msg}\n")

    camera_index = resolve_camera(camera_index)
    log(f"Perception daemon starting: port={port}, camera={camera_index}, interval={interval}s, pid={os.getpid()}")

    # Start camera thread
    camera_thread = CameraThread(camera_index, interval)
    camera_thread.start()

    # Wait for camera to initialize
    time.sleep(2)
    if camera_thread.error:
        log(f"ERROR: {camera_thread.error}")
        print(json.dumps({"error": camera_thread.error}))
        sys.exit(1)

    # Write PID and port files
    write_pid()
    write_port(port)

    # Start HTTP server
    http_server = HTTPServer(("127.0.0.1", port), PerceptionHandler)
    log(f"HTTP server listening on 127.0.0.1:{port}")

    def signal_handler(sig, frame):
        log("Received shutdown signal")
        camera_thread.stop()
        http_server.shutdown()

    signal.signal(signal.SIGTERM, signal_handler)
    signal.signal(signal.SIGINT, signal_handler)
    if sys.platform == "win32":
        signal.signal(signal.SIGBREAK, signal_handler)

    try:
        http_server.serve_forever()
    except Exception as e:
        log(f"Server error: {e}")
    finally:
        camera_thread.stop()
        remove_pid()
        log(f"Perception daemon stopped after {camera_thread.frame_count} frames")


# ── Entry point ────────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Perception Daemon")
    parser.add_argument("--port", type=int, default=7890)
    parser.add_argument("--camera", type=int, default=0)
    parser.add_argument("--interval", type=float, default=0.5)
    parser.add_argument("--list", action="store_true", help="List cameras and exit")

    args = parser.parse_args()

    if args.list:
        print(json.dumps(list_cameras(), ensure_ascii=False, indent=2))
    else:
        run_daemon(args.port, args.camera, args.interval)

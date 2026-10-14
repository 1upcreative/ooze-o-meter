"""Writes ~/.claude/ooze/transfer.json for the Ooze-o-Meter pane.

  ooze_feed.py counting|done|error <total> [code]   one-shot state write
  ooze_feed.py running <total>                      reads rsync --progress on stdin

Progress lines look like "   3000000 100%  301.67MB/s  00:00:00 ..." and repaint with \\r.
A line at 100% closes that file; the running byte count is closed files + the open one.
"""
import json
import os
import re
import sys
import time

STATE, TOTAL = sys.argv[1], int(sys.argv[2] or 0)
CODE = int(sys.argv[3]) if len(sys.argv) > 3 else 0
OUT = os.path.join(os.environ["OOZE_DIR"], "transfer.json")
LINE = re.compile(rb"^\s*([\d,]+)\s+(\d+)%")
STARTED = time.time()


def tidy(line):
    """rsync's complaint, short: no pid prefix, paths cut to their file name, no 'in <cwd>'."""
    line = re.sub(r"^rsync(\(\d+\))?:\s*", "", line)
    line = re.sub(r"\s+in\s+/\S+?:", ":", line)
    line = re.sub(r"(/[^\s:]+)+/([^\s:/]+)", r"\2", line)
    return line[:90]


def last_progress():
    """Bytes moved before a failure, from the running feed this transfer last wrote."""
    try:
        with open(OUT) as f:
            prev = json.load(f)
        return prev.get("done", 0) if prev.get("id") == os.environ["OOZE_ID"] else 0
    except (OSError, ValueError):
        return 0


def notes(state):
    """Pre-flight notes from the wrapper, plus rsync's own complaints once it has finished."""
    out = []
    for line in os.environ.get("OOZE_NOTES", "").splitlines():
        level, _, text = line.partition("|")
        if text:
            out.append({"level": level, "text": text})
    if state in ("done", "error"):
        if state == "done" and TOTAL == 0:
            out.append({"level": "info", "text": "NOTHING TO MOVE — ALREADY IN SYNC"})
        try:
            with open(os.environ.get("OOZE_ERRF", ""), errors="replace") as f:
                said = [l.strip() for l in f if l.strip()]
        except OSError:
            said = []
        # The detail lines first (what failed, where); rsync's closing summary is covered by the exit code.
        detail = [l for l in said if not l.startswith("rsync error:")] or said
        for line in detail[-3:]:
            out.append({"level": "warn" if state == "done" else "error", "text": tidy(line)})
    return out


def write(state, done, current_file="", code=0):
    now = time.time()
    elapsed = max(now - STARTED, 0.001)
    rate = done / elapsed if state == "running" else 0
    remaining = (TOTAL - done) / rate if rate > 0 and TOTAL > done else 0
    pct = 100.0 if state == "done" else (min(done / TOTAL * 100, 99.9) if TOTAL else 0.0)
    body = {
        "id": os.environ["OOZE_ID"],
        "label": os.environ.get("OOZE_LABEL", ""),
        "direction": os.environ.get("OOZE_DIRECTION", "local"),
        "state": state,
        "pct": round(pct, 1),
        "done": done,
        "total": TOTAL,
        "rate": round(rate),
        "eta": round(remaining),
        "file": current_file[-80:],
        "code": code,
        "updatedAt": int(now * 1000),
        "startedAt": int(os.environ.get("OOZE_START", int(now))) * 1000,
        "notes": notes(state),
    }
    tmp = OUT + ".tmp"
    with open(tmp, "w") as f:
        json.dump(body, f)
    os.replace(tmp, OUT)


if STATE != "running":
    write(STATE, TOTAL if STATE == "done" else last_progress() if STATE == "error" else 0, code=CODE)
    sys.exit(0)

closed, open_bytes, current, last_write = 0, 0, "", 0.0
buf = b""
stream = sys.stdin.buffer
while True:
    chunk = stream.read1(65536) if hasattr(stream, "read1") else stream.read(65536)
    if not chunk:
        break
    buf += chunk
    parts = re.split(rb"[\r\n]", buf)
    buf = parts.pop()
    for raw in parts:
        m = LINE.match(raw)
        if m:
            n = int(m.group(1).replace(b",", b""))
            if m.group(2) == b"100":
                closed += n
                open_bytes = 0
            else:
                open_bytes = n
        elif raw.strip() and not raw.startswith((b"sending ", b"receiving ", b"sent ", b"total size")):
            current = raw.decode("utf-8", "replace").strip()
    now = time.time()
    if now - last_write >= 0.25:
        write("running", closed + open_bytes, current)
        last_write = now

write("running", closed + open_bytes, current)

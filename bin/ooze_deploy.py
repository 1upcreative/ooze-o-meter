"""Writes ~/.claude/ooze/deploy.json for the Ooze-o-Meter's deploy light.

  ooze_deploy.py start <label> [note]   a new deploy, lamp amber
  ooze_deploy.py step <text>            the current step
  ooze_deploy.py done [note]            lamp green
  ooze_deploy.py fail [note]            lamp red

The last few finished deploys are kept under "history", newest first.
"""
import json
import os
import sys
import time

OUT = os.path.join(os.environ["OOZE_DIR"], "deploy.json")
KEEP_STEPS = 12
KEEP_HISTORY = 5


def load():
    try:
        with open(OUT) as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def save(body):
    body["updatedAt"] = int(time.time() * 1000)
    tmp = OUT + ".tmp"
    with open(tmp, "w") as f:
        json.dump(body, f)
    os.replace(tmp, OUT)


def tidy(text):
    return " ".join(text.replace("→", " ").replace("==>", " ").split())[:80]


cmd = sys.argv[1]
arg = sys.argv[2] if len(sys.argv) > 2 else ""
now = int(time.time() * 1000)
d = load()

if cmd == "start":
    save({
        "id": f"{int(time.time())}-{os.getppid()}",
        "label": arg[:40],
        "note": (sys.argv[3] if len(sys.argv) > 3 else "")[:40],
        "state": "running",
        "step": "",
        "steps": [],
        "startedAt": now,
        "endedAt": 0,
        "history": d.get("history", []),
    })
elif cmd == "step" and d.get("state") == "running":
    text = tidy(arg)
    if text:
        d["step"] = text
        d["steps"] = (d.get("steps", []) + [{"at": now, "text": text}])[-KEEP_STEPS:]
        save(d)
elif cmd in ("done", "fail") and d.get("state") == "running":
    d["state"] = "done" if cmd == "done" else "error"
    if arg:
        d["note"] = arg[:40]
    d["endedAt"] = now
    entry = {k: d.get(k) for k in ("label", "note", "state", "startedAt", "endedAt")}
    d["history"] = ([entry] + d.get("history", []))[:KEEP_HISTORY]
    save(d)

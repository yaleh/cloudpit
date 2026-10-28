#!/usr/bin/env python3
"""E2 inputs: the CURRENT asking sessions (observation store, read-only) + each transcript's text tail."""
import json, os, sqlite3, time
HOME = os.path.expanduser("~")
DB = f"{HOME}/.cloudcli/auth.db"
TX = f"{HOME}/.claude/projects/-data-home-yale-work-claudecodeui"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "tmp", "cockpit-briefing", "e2-items.json")
c = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
rows = c.execute("select uri,title,digest_json,updated_at from observed_objects where kind='session' and status_state='attention' order by updated_at desc limit 20").fetchall()
items = []
for uri, title, dj, up in rows:
    sid = uri.split("/")[-1]
    row = c.execute("select jsonl_path from sessions where session_id=?", (sid,)).fetchone()
    p = row[0] if row and row[0] else f"{TX}/{sid}.jsonl"
    if not p or not os.path.exists(p):
        continue
    turns = []
    with open(p, errors="replace") as f:
        for line in f:
            try: r = json.loads(line)
            except Exception: continue
            t = r.get("type"); cc = r.get("message", {}).get("content")
            if t not in ("user", "assistant") or r.get("isSidechain"): continue
            if isinstance(cc, list):
                if any(isinstance(x, dict) and x.get("type") == "tool_result" for x in cc): continue
                cc = " ".join(x.get("text", "") for x in cc if isinstance(x, dict) and x.get("type") == "text")
            if not isinstance(cc, str) or not cc.strip() or cc.startswith("<"): continue
            turns.append((t, cc.strip()))
    tail = turns[-6:]
    ctx = "\n\n".join(f"[{t}] {txt[:1800]}" for t, txt in tail)[-7000:]
    d = json.loads(dj)
    items.append({"itemRef": f"{uri}#{int(up)}", "sessionId": sid, "title": title, "ageH": round((time.time() * 1000 - up) / 3.6e6, 1),
                  "digest": {k: d.get(k) for k in ("conclusion", "changedFiles", "tests", "turnCount", "askingYou")}, "context": ctx})
    if len(items) >= 12: break
json.dump(items, open(OUT, "w"), ensure_ascii=False, indent=1)
print(len(items), "items;", [i["title"][:18] for i in items])

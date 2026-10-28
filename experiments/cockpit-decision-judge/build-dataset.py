#!/usr/bin/env python3
"""E1 dataset: ask -> answer pairs mined from this project's Claude transcripts.

Writes tmp/cockpit-judge/asks.jsonl (gitignored: it contains transcript text).
Only human sessions are used (machine prompts such as per-task workers are skipped).
Run: python3 -I experiments/cockpit-decision-judge/build-dataset.py [days=30]
"""
import datetime, glob, json, os, re, sys, time

HOME = os.path.expanduser("~")
SRC = f"{HOME}/.claude/projects/-data-home-yale-work-claudecodeui"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "tmp", "cockpit-judge", "asks.jsonl")
DAYS = int(sys.argv[1]) if len(sys.argv) > 1 else 30
MACHINE = re.compile(r"^(You are |Say the single|Reply with exactly)")
NOISE = re.compile(r"^(<|Caveat|\[Request)")
ASK = re.compile(r"([?？]\s*$)|要不要|是否|你(来)?定|请(确认|裁定|选择)|同意吗|可以吗|确认吗|哪(个|种|一)|还是你|你想")
ACCEPT = re.compile(r"^(同意|确认|好的?|可以|对|是的?|行|推进|执行|按(这个|你的|上面|建议)|批准|做吧|动手|OK|ok|Yes|yes)")
NEGATE = re.compile(r"^(不|先不|暂时不|别|不要|否|No|no|而是|改成|我倾向|我更倾向)")
INVEST = re.compile(r"(检查|查一下|看一下|看看|核实|展示|给我看|分析|验证|复现|确认一下)")
DISCUSS = re.compile(r"(讨论|怎么看|为什么|如何|能不能|有没有|是不是|你觉得|进一步)")


def ts(s):
    try:
        return datetime.datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()
    except Exception:
        return None


def label(reply):
    r = reply.strip()
    if ACCEPT.match(r):
        return "ACCEPT" if len(r) <= 40 else "ACCEPT_WITH_CHANGES"
    if NEGATE.match(r):
        return "ALTERNATIVE"
    if INVEST.search(r[:60]):
        return "INVESTIGATE"
    if DISCUSS.search(r[:80]) or r.endswith(("?", "？")):
        return "DISCUSS"
    return "OTHER"


def main():
    cut = time.time() - DAYS * 86400
    rows = []
    for path in sorted(glob.glob(SRC + "/*.jsonl")):
        if os.path.getmtime(path) < cut:
            continue
        sid = os.path.basename(path)[:-6]
        last = None
        first = True
        cwd = None
        try:
            with open(path, errors="replace") as f:
                for line in f:
                    try:
                        r = json.loads(line)
                    except Exception:
                        continue
                    cwd = cwd or r.get("cwd")
                    t = r.get("type")
                    c = r.get("message", {}).get("content")
                    if t == "assistant" and isinstance(c, list):
                        tx = " ".join(x.get("text", "") for x in c if isinstance(x, dict) and x.get("type") == "text").strip()
                        if tx:
                            last = (tx, ts(r.get("timestamp") or ""))
                    elif t == "user" and not r.get("isMeta") and not r.get("isSidechain"):
                        if isinstance(c, list):
                            if any(isinstance(x, dict) and x.get("type") == "tool_result" for x in c):
                                continue
                            c = " ".join(x.get("text", "") for x in c if isinstance(x, dict) and x.get("type") == "text")
                        if not isinstance(c, str) or not c.strip():
                            continue
                        c = c.strip()
                        if first and MACHINE.match(c):
                            break
                        first = False
                        if NOISE.match(c):
                            last = None
                            continue
                        if last and last[1] and ASK.search(last[0][-240:]):
                            rt = ts(r.get("timestamp") or "")
                            rows.append({
                                "id": f"{sid[:8]}-{len(rows)}", "sid": sid, "at": rt,
                                "project": os.path.basename(cwd or "") or None,
                                "ask": last[0][-1500:], "ask_len": len(last[0]),
                                "reply": c[:400], "reply_len": len(c),
                                "latency_s": (rt - last[1]) if rt else None,
                                "label": label(c),
                            })
                        last = None
        except Exception:
            continue
    rows.sort(key=lambda x: x["at"] or 0)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    from collections import Counter
    print(len(rows), "pairs ->", os.path.relpath(OUT), dict(Counter(r["label"] for r in rows)))


main()

#!/usr/bin/env python3
"""Aggregate E2 per-item JSON into the numbers REPORT.md quotes (no model calls)."""
import json, glob, os, statistics, collections
T = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "tmp", "cockpit-briefing")
items = json.load(open(os.path.join(T, "e2-items.json")))
corr = json.load(open(os.path.join(T, "b1-token-correction.json")))["per_item"]
def ev(doc):
    e = (doc or {}).get("evidence", []); m = sum(1 for x in e if x.get("mechanical")); return m, len(e) - m
def canvas(doc): return [b.get("rationale") for b in (doc or {}).get("blocks", []) if b.get("type") == "canvas"]
def blocks(doc): return [b.get("type") for b in (doc or {}).get("blocks", [])]
def axes(doc):
    r = [b for b in (doc or {}).get("blocks", []) if b.get("type") == "radar"]; return [a["label"] for a in r[0]["axes"]] if r else []
rows = []; first_fail = {"b1": collections.Counter(), "b2": collections.Counter()}
for arm in ("b1", "b2"):
    for f in sorted(glob.glob(os.path.join(T, f"e2-{arm}-*.json")), key=lambda p: int(p.rsplit("-", 1)[1][:-5])):
        r = json.load(open(f)); k = r["item"]; d = r.get("doc")
        if arm == "b1":
            rounds = len(r["rounds"]); tok = corr.get(str(k), [0, 0])[1] if str(k) in corr else sum(x["in"] + x["out"] for x in r["rounds"])
            for rule in (r["rounds"][0]["rules"] if r["rounds"] else []): first_fail[arm][rule] += 1
            sub = "-"
        else:
            rounds = r.get("checkCalls"); tok = r.get("tokens"); sub = r.get("subtype")
            for rule in (r.get("rules") or []): first_fail[arm][rule] += 1
        m, l = ev(d)
        rows.append({"arm": arm, "item": k, "title": items[k]["title"][:14], "pass": r.get("pass"), "e2e": r.get("e2e"), "rounds": rounds, "tokens": tok, "subtype": sub, "evMech": m, "evLlm": l, "canvas": canvas(d), "blocks": blocks(d), "axes": axes(d)})
out = {"rows": rows, "firstFail": {a: dict(c) for a, c in first_fail.items()}}
for arm in ("b1", "b2"):
    R = [x for x in rows if x["arm"] == arm]; L = sorted(x["e2e"] for x in R if x["e2e"] is not None); P = [x for x in R if x["pass"]]
    q = lambda p: L[min(len(L) - 1, int(round(p * (len(L) - 1))))] if L else None
    out[arm] = {"n": len(R), "pass": len(P), "lat_p50": q(.5), "lat_p90": q(.9), "lat_max": max(L) if L else None, "under120": sum(1 for x in L if x <= 120), "tok_mean": round(statistics.mean(x["tokens"] for x in R)) if R else None, "evMech": sum(x["evMech"] for x in P), "evLlm": sum(x["evLlm"] for x in P), "canvasUsed": sum(1 for x in P if x["canvas"])}
json.dump(out, open(os.path.join(T, "e2-summary.json"), "w"), ensure_ascii=False, indent=1)
print(json.dumps({a: out[a] for a in ("b1", "b2")}, ensure_ascii=False)); print(json.dumps(out["firstFail"], ensure_ascii=False))
for x in rows: print(x["arm"], x["item"], x["title"], x["pass"], x["e2e"], x["rounds"], x["tokens"], x["subtype"], f'ev {x["evMech"]}/{x["evLlm"]}', x["blocks"], x["axes"][:6])

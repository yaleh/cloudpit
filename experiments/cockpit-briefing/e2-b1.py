#!/usr/bin/env python3
"""E2 arm B1: one gateway call per round (v4.1flash, thinking disabled), host check, ≤3 rounds.
Run (key sourced, never printed):
  bash -c 'set -a; source ~/.local/etc/fjdac-api-key; set +a; export ANTHROPIC_BASE_URL=$(grep -E "^export ANTHROPIC_BASE_URL=" ~/.local/bin/claude-fjdac | sed -E "s/^export ANTHROPIC_BASE_URL=\\"?([^\\"]+)\\"?/\\1/"); exec python3 -I experiments/cockpit-briefing/e2-b1.py <indices>'
"""
import json, os, subprocess, sys, time, urllib.request
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
TMP = os.path.join(ROOT, "tmp", "cockpit-briefing")
BASE = os.environ["ANTHROPIC_BASE_URL"].rstrip("/"); KEY = os.environ["FJDAC_API_KEY"]; MODEL = "v4.1flash"
items = json.load(open(os.path.join(TMP, "e2-items.json")))
example = json.load(open(os.path.join(TMP, "briefs.json")))["docs"]["ac"]
schema = subprocess.run(["node", os.path.join(ROOT, "experiments/cockpit-briefing/brief-cli.mjs"), "schema"], capture_output=True, text=True).stdout
radar_in = subprocess.run(["node", os.path.join(ROOT, "experiments/cockpit-briefing/brief-cli.mjs"), "schema", "radar"], capture_output=True, text=True).stdout
LEDGER = os.path.join(TMP, "ledger.json")

SYSTEM = f"""You write a BRIEF for one decision a developer must make. The brief is JSON (BriefSpec v0) that a cockpit renders.
Write SEMANTICS only; the host turns them into structure and runs a mechanical checker.

Limits and presets:
{schema}
Radar semantic input (put it in the top-level key "radarSemantic"; the host builds the block; axes are YOUR choice for this item, but MUST include ids "rev" and "evid"; 3–6 axes; integer scores 0–100 for EVERY option on EVERY axis; a "mechanical" axis must cite evidence ids that are mechanical:true):
{radar_in}
Rules:
- headline: one line, what is being decided (Chinese if the conversation is Chinese).
- options: 2–4 real alternatives taken from the conversation; each: id, label, does (what happens if chosen), consequence[] tags (kind ∈ reversible|irreversible|costs|blocks|no-effect).
- recommendation: the assistant's own recommendation if the conversation states one, else your judgement; why: 1–3 short reasons.
- evidence: facts with ids. mechanical:true ONLY for facts with a concrete ref (command, file:line, sha) and observedAt; everything else mechanical:false.
- other blocks optional: compare-table, checklist, timeline, diffstat, graph, callout; or "canvas" only if no preset fits (needs alt + rationale).
- Do not invent facts that are not in the conversation.
Output ONLY the JSON object, no prose, no code fence.
Example of a valid brief (structure only; its radar block shows what the host builds from radarSemantic):
{json.dumps(example, ensure_ascii=False)[:6000]}"""

def call(messages):
    body = json.dumps({"model": MODEL, "max_tokens": 4000, "system": SYSTEM, "messages": messages, "thinking": {"type": "disabled"}}).encode()
    req = urllib.request.Request(BASE + "/v1/messages", data=body, headers={"content-type": "application/json", "x-api-key": KEY, "anthropic-version": "2023-06-01"})
    t = time.time()
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                p = json.loads(r.read())
            text = "".join(b.get("text", "") for b in p.get("content", []) if b.get("type") == "text")
            return text, p.get("usage", {}), time.time() - t
        except Exception as e:
            err = type(e).__name__
            time.sleep(2)
    raise RuntimeError("gateway failed: " + err)

def parse(text):
    s = text.strip()
    if s.startswith("```"): s = s.split("\n", 1)[1].rsplit("```", 1)[0]
    i, j = s.find("{"), s.rfind("}")
    return json.loads(s[i:j + 1])

def host_check(doc):
    out = subprocess.run(["node", os.path.join(ROOT, "experiments/cockpit-briefing/e2-check.mjs")], input=json.dumps({"doc": doc}), capture_output=True, text=True)
    return json.loads(out.stdout)

def ledger_add(tokens):
    L = json.load(open(LEDGER)) if os.path.exists(LEDGER) else {"total": 0, "b1": 0, "b2": 0}
    L["total"] += tokens; L["b1"] += tokens; json.dump(L, open(LEDGER, "w")); return L["total"]

idx = [int(x) for x in sys.argv[1:]]
for k in idx:
    it = items[k]
    user = f"itemRef: {it['itemRef']}\nSession: {it['title']}\nObservation digest: {json.dumps(it['digest'], ensure_ascii=False)[:1500]}\n\nConversation tail (newest last):\n{it['context']}"
    msgs = [{"role": "user", "content": user}]
    rec = {"item": k, "title": it["title"], "rounds": [], "pass": False}
    t0 = time.time()
    for rnd in range(3):
        text, usage, dt = call(msgs)
        tok = usage.get("input_tokens", 0) + usage.get("cache_read_input_tokens", 0) + usage.get("cache_creation_input_tokens", 0) + usage.get("output_tokens", 0)
        total = ledger_add(tok)
        try:
            doc = parse(text); doc["itemRef"] = it["itemRef"]
            chk = host_check(doc); res = chk["result"]; doc = chk["doc"]
        except Exception as e:
            res = {"ok": False, "errors": [{"rule": "unparseable-json", "path": "$", "message": str(e)[:200], "fix": "output one JSON object only"}]}; doc = None
        rec["rounds"].append({"latency": round(dt, 1), "usage": usage, "in": usage.get("input_tokens", 0) + usage.get("cache_read_input_tokens", 0) + usage.get("cache_creation_input_tokens", 0), "out": usage.get("output_tokens", 0), "ok": res["ok"], "rules": [e["rule"] for e in res["errors"]][:12]})
        if res["ok"]:
            rec["pass"] = True; rec["doc"] = doc; break
        msgs += [{"role": "assistant", "content": text}, {"role": "user", "content": "The mechanical checker rejected it. Fix exactly these and output the whole corrected JSON object only:\n" + json.dumps(res["errors"][:20], ensure_ascii=False)}]
        if total > 1_800_000: break
    rec["e2e"] = round(time.time() - t0, 1)
    json.dump(rec, open(os.path.join(TMP, f"e2-b1-{k}.json"), "w"), ensure_ascii=False, indent=1)
    print(json.dumps({k2: rec[k2] for k2 in ("item", "pass", "e2e")} | {"rounds": [(r["ok"], r["in"], r["out"], r["latency"], r["rules"][:4]) for r in rec["rounds"]]}, ensure_ascii=False))
    if total > 1_800_000: print("BUDGET STOP"); break

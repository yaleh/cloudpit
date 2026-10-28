#!/usr/bin/env python3
"""E2 arm B2: a short read-only Claude Code session (claude-fjdac, v4.1flash, --max-turns 8) that must pass
`brief-cli check -` and print the brief JSON last; the host re-checks. Isolated: fresh CLAUDE_CONFIG_DIR, cwd outside the repo."""
import json, os, subprocess, sys, tempfile, time, glob
ROOT = "/data/home/yale/work/claudecodeui"
TMP = os.path.join(ROOT, "tmp", "cockpit-briefing")
CLI = os.path.join(ROOT, "experiments/cockpit-briefing/brief-cli.mjs")
PROJ = os.path.expanduser("~/.claude/projects/-data-home-yale-work-claudecodeui")
LEDGER = os.path.join(TMP, "ledger.json")
items = json.load(open(os.path.join(TMP, "e2-items.json")))
ALLOWED = ",".join(["Read", "Grep", "Glob", "Write(./brief.json)", "Edit(./brief.json)", f"Bash(node {CLI}:*)", f"Bash(git -C {ROOT} log:*)", f"Bash(git -C {ROOT} diff:*)", f"Bash(git -C {ROOT} show:*)", f"Bash(git -C {ROOT} status:*)"])

SCHEMA = subprocess.run(["node", CLI, "schema"], capture_output=True, text=True).stdout
RADAR = subprocess.run(["node", CLI, "schema", "radar"], capture_output=True, text=True).stdout
SKELETON = subprocess.run(["node", CLI, "skeleton"], capture_output=True, text=True).stdout
EXAMPLE = json.dumps(json.load(open(os.path.join(TMP, "briefs.json")))["docs"]["ac"], ensure_ascii=False)[:6000]

def prompt(it):
    return f"""You produce a BRIEF (BriefSpec v0 JSON) for ONE decision a developer must make, so a cockpit can render it. Read-only: never edit anything in the repository. The ONLY file you may write is ./brief.json in your working directory.
Tools you may use: `node {CLI} schema`, `node {CLI} schema radar`, `node {CLI} skeleton`, `node {CLI} check brief.json`, read-only git via `git -C {ROOT} log|diff|show|status …`, and Read/Grep/Glob under {ROOT}.
Schema (already read for you — do NOT call schema/skeleton):
{SCHEMA}
Document skeleton (top-level shape; v MUST be 0):
{SKELETON}
A complete valid example (its radar block is what the checker builds from radarSemantic):
{EXAMPLE}
Radar: put {{"axes":[…],"scores":{{optionId:{{axisId:int}}}}}} in the top-level key "radarSemantic"; the checker builds the block. Format:
{RADAR}
TURN BUDGET: you have 8 turns in total. Use at most 2 turns for evidence; WRITE ./brief.json by your 4th turn at the latest; then `check brief.json` and fix (Edit) until ok:true. Do not explore unrelated files.
Steps: 1) optionally gather NEW evidence (git, files) that bears on the decision — mechanical:true evidence needs a concrete ref (the command or file:line) and observedAt (ISO now); 3) write the brief: headline, 2–4 options from the conversation with consequence tags, recommendation (the assistant's own if stated), evidence, ONE radar block (axes chosen for this item, MUST include ids rev and evid, integer 0–100 for every option on every axis), other preset blocks if useful; canvas only if no preset fits; 4) write it to ./brief.json and run `node {CLI} check brief.json` until ok:true (at most 3 times); 5) finish with the single word DONE.
itemRef: {it['itemRef']}
Session: {it['title']}
Observation digest: {json.dumps(it['digest'], ensure_ascii=False)[:1500]}
Conversation tail (newest last):
{it['context']}"""

def ledger_add(t):
    L = json.load(open(LEDGER)) if os.path.exists(LEDGER) else {"total": 0, "b1": 0, "b2": 0}
    L["total"] += t; L["b2"] += t; json.dump(L, open(LEDGER, "w")); return L["total"]

for k in [int(x) for x in sys.argv[1:]]:
    it = items[k]
    cfg = tempfile.mkdtemp(prefix="e2cfg-"); cwd = tempfile.mkdtemp(prefix="e2cwd-")
    before = set(glob.glob(PROJ + "/*.jsonl"))
    env = dict(os.environ, CLAUDE_CONFIG_DIR=cfg)
    t0 = time.time()
    p = subprocess.run([os.path.expanduser("~/.local/bin/claude-fjdac"), "-p", prompt(it), "--output-format", "json", "--model", "v4.1flash", "--max-turns", "8",
                        "--allowedTools", ALLOWED, "--disallowedTools", "NotebookEdit,WebFetch,WebSearch,Task", "--add-dir", ROOT],
                       cwd=cwd, env=env, capture_output=True, text=True, timeout=600)
    e2e = time.time() - t0
    leaked = sorted(set(glob.glob(PROJ + "/*.jsonl")) - before)
    rec = {"item": k, "title": it["title"], "e2e": round(e2e, 1), "exit": p.returncode, "leakedTranscripts": len(leaked)}
    try:
        j = json.loads(p.stdout)
    except Exception:
        j = {}; rec["stderr"] = p.stderr[-400:]
    u = j.get("usage", {})
    tok = u.get("input_tokens", 0) + u.get("cache_read_input_tokens", 0) + u.get("cache_creation_input_tokens", 0) + u.get("output_tokens", 0)
    rec |= {"subtype": j.get("subtype"), "turns": j.get("num_turns"), "models": list((j.get("modelUsage") or {}).keys()), "tokens": tok, "in": u.get("input_tokens", 0) + u.get("cache_read_input_tokens", 0) + u.get("cache_creation_input_tokens", 0), "out": u.get("output_tokens", 0)}
    total = ledger_add(tok)
    text = j.get("result") or ""
    try:
        doc = json.load(open(os.path.join(cwd, "brief.json"))); doc["itemRef"] = it["itemRef"]
        chk = json.loads(subprocess.run(["node", os.path.join(ROOT, "experiments/cockpit-briefing/e2-check.mjs")], input=json.dumps({"doc": doc}), capture_output=True, text=True).stdout)
        rec["pass"] = chk["result"]["ok"]; rec["rules"] = [e["rule"] for e in chk["result"]["errors"]][:12]; rec["doc"] = chk["doc"]
    except Exception as e:
        rec["pass"] = False; rec["rules"] = ["unparseable-final-message"]; rec["tail"] = text[-300:]
    # how many times did it call the checker? read the isolated transcript
    calls = 0
    for f in glob.glob(cfg + "/projects/*/*.jsonl"):
        for line in open(f, errors="replace"):
            if '"tool_use"' in line and "brief-cli.mjs check" in line: calls += 1
    rec["checkCalls"] = calls
    json.dump(rec, open(os.path.join(TMP, f"e2-b2-{k}.json"), "w"), ensure_ascii=False, indent=1)
    print(json.dumps({x: rec.get(x) for x in ("item", "pass", "e2e", "subtype", "turns", "models", "tokens", "checkCalls", "rules", "leakedTranscripts", "exit")}, ensure_ascii=False))
    if total > 1_800_000: print("BUDGET STOP"); break

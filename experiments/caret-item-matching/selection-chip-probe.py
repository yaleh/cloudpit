#!/usr/bin/env python3
"""Selection-anchored chip probe: how long should a generated suggestion be?

For a few (selected passage -> actual draft) turns from PROBE-SET.json, ask the
gateway for 3 chips at three length caps: 40 (one clause), 80 (one sentence),
160 (short full reply). Record latency, tokens, chip lengths, and the closest
chip's overlap with the actual draft the person typed.

This is a feasibility probe, not a judged benchmark: 6 turns x 3 caps = 18 calls.
The full experiment should use reply-suggestions-bench's same/near/different
rubric on ~60 turns.

Run (key sourced, never printed):

  bash -c 'set -a; source ~/.local/etc/fjdac-api-key; set +a; \\
    export ANTHROPIC_BASE_URL=$(grep -E "^export ANTHROPIC_BASE_URL=" ~/.local/bin/claude-fjdac \\
      | sed -E "s/^export ANTHROPIC_BASE_URL=\\"?([^\\"]+)\\"?/\\1/"); \\
    exec python3 -I experiments/caret-item-matching/selection-chip-probe.py'
"""

import concurrent.futures
import json
import os
import re
import statistics
import time
import urllib.request
from pathlib import Path

BASE = os.environ["ANTHROPIC_BASE_URL"].rstrip("/")
KEY = os.environ["FJDAC_API_KEY"]
MODEL = os.environ.get("PROBE_MODEL", "v4.1flash")
HERE = Path(__file__).resolve().parent
SET_PATH = HERE / "PROBE-SET.json"
OUT_PATH = HERE / "SELECTION-CHIP-PROBE.json"
TURNS = int(os.environ.get("PROBE_TURNS", "6"))
CAPS = [40, 80, 160]
MAX_WORKERS = 3

SYSTEM = """你在为用户起草聊天输入框里可直接发送的回复。
用户选中了助手消息里的一段，想回应它。给出 3 条互不相同的完整回复：
第 1 条直接回应这段；第 2、3 条是真正的备选（不同的决定，或更短的确认）。
用用户的语言和简短风格，每条不超过 {cap} 个字符。
不得编造消息里没有的事实、数字或测量值：可以替人做决定，不可以编造事实。
只输出 JSON：{{"chips":["…","…","…"]}}"""


def build_user(turn: dict) -> str:
    return (
        "助手消息（末尾节选）：\n\"\"\"\n"
        + turn.get("sourceTail", "")
        + "\n\"\"\"\n\n用户选中了这一段，想回应它：\n\"\"\"\n"
        + turn.get("selectedText", "")
        + "\n\"\"\""
    )


def parse_chips(text: str) -> list[str]:
    match = re.search(r"\{[\s\S]*\}", text)
    if not match:
        raise ValueError(f"unparseable: {text[:120]}")
    payload = json.loads(match.group(0))
    chips = payload.get("chips")
    if not isinstance(chips, list) or not all(isinstance(chip, str) for chip in chips):
        raise ValueError(f"bad chips: {text[:120]}")
    return [chip.strip() for chip in chips if chip.strip()]


def call(turn: dict, cap: int) -> dict:
    body = {
        "model": MODEL,
        "max_tokens": 300,
        "temperature": 0.3,
        "thinking": {"type": "disabled"},
        "system": SYSTEM.format(cap=cap),
        "messages": [{"role": "user", "content": build_user(turn)}],
    }
    request = urllib.request.Request(
        BASE + "/v1/messages",
        data=json.dumps(body).encode(),
        headers={
            "content-type": "application/json",
            "x-api-key": KEY,
            "anthropic-version": "2023-06-01",
        },
    )
    started = time.perf_counter()
    with urllib.request.urlopen(request, timeout=60) as response:
        raw = response.read().decode()
    ms = (time.perf_counter() - started) * 1000
    payload = json.loads(raw)
    text = "".join(
        block.get("text", "")
        for block in payload.get("content") or []
        if isinstance(block, dict) and block.get("type") == "text"
    )
    usage = payload.get("usage") or {}
    return {"ms": ms, "text": text, "usage": usage}


def bigrams(text: str) -> dict[str, int]:
    counts: dict[str, int] = {}
    for index in range(len(text) - 1):
        gram = text[index:index + 2]
        counts[gram] = counts.get(gram, 0) + 1
    return counts


def normalize(text: str) -> str:
    return re.sub(r"[^0-9a-z一-鿿]+", "", text.lower())


def dice(left: dict[str, int], right: dict[str, int]) -> float:
    total = sum(left.values()) + sum(right.values())
    if total == 0:
        return 0.0
    overlap = sum(min(count, right.get(gram, 0)) for gram, count in left.items())
    return 2 * overlap / total


def one(job: dict) -> dict:
    turn, cap = job["turn"], job["cap"]
    result = {
        "turn": turn["id"],
        "cap": cap,
        "draft": turn["draft"][:200],
        "selected": turn["selectedText"][:200],
    }
    for attempt in range(3):
        try:
            response = call(turn, cap)
            chips = parse_chips(response["text"])
            draft = normalize(turn["draft"])
            draft_grams = bigrams(draft)
            result.update({
                "ms": round(response["ms"], 1),
                "usage": response["usage"],
                "chips": chips,
                "lengths": [len(chip) for chip in chips],
                "maxDiceToDraft": round(
                    max((dice(draft_grams, bigrams(normalize(chip))) for chip in chips), default=0.0), 3
                ),
            })
            return result
        except Exception as error:  # noqa: BLE001
            result["error"] = f"{type(error).__name__}: {error}"
            time.sleep(1.0 * (attempt + 1))
    return result


def percentile(values: list[float], q: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, int(len(ordered) * q))]


def main() -> int:
    data = json.loads(SET_PATH.read_text())
    turns = data["turns"][:TURNS]
    jobs = [{"turn": turn, "cap": cap} for turn in turns for cap in CAPS]
    started = time.perf_counter()
    with concurrent.futures.ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
        results = list(pool.map(one, jobs))
    wall = time.perf_counter() - started

    ok = [row for row in results if "error" not in row]
    by_cap = {}
    for cap in CAPS:
        rows = [row for row in ok if row["cap"] == cap]
        lengths = [length for row in rows for length in row["lengths"]]
        by_cap[str(cap)] = {
            "calls": len(rows),
            "meanChipChars": round(statistics.mean(lengths), 1) if lengths else 0,
            "maxChipChars": max(lengths) if lengths else 0,
            "overCap": sum(1 for length in lengths if length > cap),
            "meanMaxDiceToDraft": round(statistics.mean([row["maxDiceToDraft"] for row in rows]), 3)
            if rows else 0,
            "latencyMs": {
                "p50": round(percentile([row["ms"] for row in rows], 0.5), 1),
                "p95": round(percentile([row["ms"] for row in rows], 0.95), 1),
            },
            "meanInputTokens": round(statistics.mean([
                (row["usage"].get("input_tokens", 0)
                 + row["usage"].get("cache_creation_input_tokens", 0)
                 + row["usage"].get("cache_read_input_tokens", 0)) for row in rows
            ]), 1) if rows else 0,
            "meanOutputTokens": round(statistics.mean([
                row["usage"].get("output_tokens", 0) for row in rows
            ]), 1) if rows else 0,
        }

    report = {
        "schema": "caret-item-matching/selection-chip-probe/1",
        "ranAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "model": MODEL,
        "sample": {"turns": len(turns), "caps": CAPS, "calls": len(jobs), "wallSeconds": round(wall, 1)},
        "errors": len(results) - len(ok),
        "byCap": by_cap,
        "calls": results,
    }
    OUT_PATH.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({key: value for key, value in report.items() if key != "calls"},
                     ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

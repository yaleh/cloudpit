#!/usr/bin/env python3
"""Small gateway probe for the pause-triggered completion experiment.

Reads PROBE-SET.json (16 turns x 2 candidate pools), asks the quay workers'
gateway (v4.1flash, thinking disabled) to pick the passages the draft refers to,
and records latency, tokens, parse failures, and top-1/top-3 against the lexical
baseline on the same sample.

Run (the key is sourced, never printed):

  bash -c 'set -a; source ~/.local/etc/fjdac-api-key; set +a; \
    export ANTHROPIC_BASE_URL=$(grep -E "^export ANTHROPIC_BASE_URL=" ~/.local/bin/claude-fjdac \
      | sed -E "s/^export ANTHROPIC_BASE_URL=\\"?([^\\"]+)\\"?/\\1/"); \
    exec python3 -I experiments/caret-item-matching/gateway-probe.py'

Env:
  PROBE_MODEL   default v4.1flash
  PROBE_TURNS   default all
  PROBE_STREAM  default 1 (measure TTFB on a small subset)
  PRICE_IN_USD_PER_M / PRICE_OUT_USD_PER_M  optional, only for the cost estimate
"""

import concurrent.futures
import json
import os
import re
import statistics
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

BASE = os.environ["ANTHROPIC_BASE_URL"].rstrip("/")
KEY = os.environ["FJDAC_API_KEY"]
MODEL = os.environ.get("PROBE_MODEL", "v4.1flash")
HERE = Path(__file__).resolve().parent
SET_PATH = HERE / "PROBE-SET.json"
OUT_PATH = HERE / "GATEWAY-PROBE-RESULT.json"
MAX_WORKERS = 4
RETRIES = 2

SYSTEM = """You are a completion engine for a chat composer.

The user is writing a message while looking at a transcript. Given the DRAFT
(what they have typed so far) and PASSAGES from the visible transcript, decide
which passage(s) the draft refers to and that should be offered for insertion.

Rules:
- Only use the listed passage ids. Never invent an id.
- Return at most 3, best first, each with a confidence between 0 and 1.
- If the draft does not refer to any passage, return an empty list.
- JSON only, no prose.

Format: {"picks":[{"id":"...","confidence":0.0}]}"""


def build_user(draft: str, passages: list[dict]) -> str:
    lines = [f"[{p['id']}] ({p['role']}) {p['text']}" for p in passages]
    return f"DRAFT:\n{draft}\n\nPASSAGES:\n" + "\n".join(lines)


def request_body(draft: str, passages: list[dict], stream: bool) -> dict:
    return {
        "model": MODEL,
        "max_tokens": 200,
        "temperature": 0,
        "thinking": {"type": "disabled"},
        "stream": stream,
        "system": SYSTEM,
        "messages": [{"role": "user", "content": build_user(draft, passages)}],
    }


def parse_picks(text: str) -> list[str]:
    """Returns pick ids in order; raises ValueError when the payload is unparseable."""
    text = text.strip()
    # Prefer a JSON object with picks; fall back to a bare array.
    match = re.search(r"\{[\s\S]*\}", text)
    if match:
        try:
            payload = json.loads(match.group(0))
            picks = payload.get("picks")
            if isinstance(picks, list):
                ids = []
                for pick in picks:
                    if isinstance(pick, dict) and isinstance(pick.get("id"), str):
                        ids.append(pick["id"])
                    elif isinstance(pick, str):
                        ids.append(pick)
                return ids
        except json.JSONDecodeError:
            pass
    match = re.search(r"\[[\s\S]*\]", text)
    if match:
        try:
            payload = json.loads(match.group(0))
            if isinstance(payload, list):
                return [str(item.get("id") if isinstance(item, dict) else item) for item in payload]
        except json.JSONDecodeError:
            pass
    raise ValueError(f"unparseable: {text[:160]}")


def call(draft: str, passages: list[dict], stream: bool = False) -> dict:
    body = json.dumps(request_body(draft, passages, stream)).encode()
    req = urllib.request.Request(
        BASE + "/v1/messages",
        data=body,
        headers={
            "content-type": "application/json",
            "x-api-key": KEY,
            "anthropic-version": "2023-06-01",
        },
    )
    started = time.perf_counter()
    if not stream:
        with urllib.request.urlopen(req, timeout=60) as response:
            raw = response.read().decode()
            ms = (time.perf_counter() - started) * 1000
        payload = json.loads(raw)
        text = "".join(
            block.get("text", "")
            for block in payload.get("content") or []
            if isinstance(block, dict) and block.get("type") == "text"
        )
        return {"ms": ms, "ttfb": None, "text": text, "usage": payload.get("usage") or {}}

    first = None
    chunks: list[str] = []
    usage: dict = {}
    with urllib.request.urlopen(req, timeout=60) as response:
        for raw_line in response:
            line = raw_line.decode().strip()
            if not line.startswith("data:"):
                continue
            if first is None:
                first = (time.perf_counter() - started) * 1000
            data = line[5:].strip()
            if data == "[DONE]":
                break
            try:
                event = json.loads(data)
            except json.JSONDecodeError:
                continue
            if event.get("type") == "content_block_delta":
                delta = event.get("delta") or {}
                chunks.append(delta.get("text", ""))
            if event.get("type") == "message_delta":
                usage = event.get("usage") or usage
            if event.get("type") == "message_start":
                usage = (event.get("message") or {}).get("usage") or usage
    return {
        "ms": (time.perf_counter() - started) * 1000,
        "ttfb": first,
        "text": "".join(chunks),
        "usage": usage,
    }


def one(job: dict) -> dict:
    turn = job["turn"]
    pool_name = job["pool"]
    pool = turn["pools"][pool_name]
    result = {
        "turn": turn["id"],
        "pool": pool_name,
        "distance": turn["distance"],
        "draftChars": len(turn["draft"]),
        "passages": len(pool["passages"]),
        "truthInPool": pool["truthInPool"],
        "truth": turn["truthPassageId"],
        "lexicalTop3": pool["lexicalTop3"],
        "error": None,
    }
    for attempt in range(RETRIES + 1):
        try:
            response = call(turn["draft"], pool["passages"], stream=job.get("stream", False))
            result.update({
                "ms": round(response["ms"], 1),
                "ttfb": round(response["ttfb"], 1) if response["ttfb"] is not None else None,
                "usage": response["usage"],
                "raw": response["text"][:400],
            })
            try:
                picks = parse_picks(response["text"])
                result["picks"] = picks[:3]
                result["top1"] = bool(picks) and picks[0] == turn["truthPassageId"]
                result["top3"] = turn["truthPassageId"] in picks[:3]
            except ValueError as error:
                result["error"] = str(error)
                result["picks"] = []
                result["top1"] = False
                result["top3"] = False
            return result
        except Exception as error:  # noqa: BLE001 - probe wants the class of failure
            result["error"] = f"{type(error).__name__}: {error}"
            time.sleep(1.5 * (attempt + 1))
    result["top1"] = False
    result["top3"] = False
    result["picks"] = []
    return result


def percentile(values: list[float], q: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, int(len(ordered) * q))]


def input_total(usage: dict) -> int:
    # The gateway reports cache reads separately from the uncached input.
    return (
        usage.get("input_tokens", 0)
        + usage.get("cache_creation_input_tokens", 0)
        + usage.get("cache_read_input_tokens", 0)
    )


def summarize(rows: list[dict]) -> dict:
    ok = [row for row in rows if row.get("error") is None]
    latencies = [row["ms"] for row in ok]
    input_tokens = [input_total(row["usage"]) for row in ok]
    cache_tokens = [row["usage"].get("cache_read_input_tokens", 0) for row in ok]
    output_tokens = [row["usage"].get("output_tokens", 0) for row in ok]
    price_in = float(os.environ.get("PRICE_IN_USD_PER_M", "0"))
    price_out = float(os.environ.get("PRICE_OUT_USD_PER_M", "0"))
    # Upper bound: every input token at the normal price (cache reads are usually cheaper).
    cost = sum(
        input_total(row["usage"]) / 1_000_000 * price_in
        + row["usage"].get("output_tokens", 0) / 1_000_000 * price_out
        for row in ok
    )
    return {
        "calls": len(rows),
        "ok": len(ok),
        "errors": len(rows) - len(ok),
        "top1": round(sum(1 for row in ok if row.get("top1")) / max(1, len(ok)), 3),
        "top3": round(sum(1 for row in ok if row.get("top3")) / max(1, len(ok)), 3),
        "lexicalTop3": round(
            sum(1 for row in ok if row["truth"] in row["lexicalTop3"]) / max(1, len(ok)), 3
        ),
        "latencyMs": {
            "p50": round(percentile(latencies, 0.5), 1),
            "p95": round(percentile(latencies, 0.95), 1),
            "max": round(max(latencies), 1) if latencies else 0,
        },
        "ttfbMs": {
            "p50": round(percentile([row["ttfb"] for row in ok if row.get("ttfb")], 0.5), 1),
            "p95": round(percentile([row["ttfb"] for row in ok if row.get("ttfb")], 0.95), 1),
        },
        "meanInputTokens": round(statistics.mean(input_tokens), 1) if input_tokens else 0,
        "meanCacheReadTokens": round(statistics.mean(cache_tokens), 1) if cache_tokens else 0,
        "meanOutputTokens": round(statistics.mean(output_tokens), 1) if output_tokens else 0,
        "costUsdUpperBound": round(cost, 6),
    }


def main() -> int:
    data = json.loads(SET_PATH.read_text())
    turns = data["turns"]
    limit = int(os.environ.get("PROBE_TURNS", "0")) or len(turns)
    turns = turns[:limit]
    jobs = [
        {"turn": turn, "pool": pool}
        for turn in turns
        for pool in ("oracle-neighbors", "naive-12", "tight-12")
    ]
    if os.environ.get("PROBE_STREAM", "1") == "1":
        for job in jobs[:8]:
            job["stream"] = True

    started = time.perf_counter()
    with concurrent.futures.ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
        results = list(pool.map(one, jobs))
    wall = time.perf_counter() - started

    by_pool = {
        pool: summarize([row for row in results if row["pool"] == pool])
        for pool in ("oracle-neighbors", "naive-12", "tight-12")
    }
    by_distance = {
        bucket: summarize([
            row for row in results
            if (row["distance"] <= 3) == (bucket == "near")
        ])
        for bucket in ("near", "far")
    }
    report = {
        "schema": "caret-item-matching/gateway-probe/1",
        "ranAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "model": MODEL,
        "sample": {"turns": len(turns), "calls": len(jobs), "wallSeconds": round(wall, 1)},
        "overall": summarize(results),
        "byPool": by_pool,
        "byDistance": by_distance,
        "calls": results,
    }
    OUT_PATH.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({k: v for k, v in report.items() if k != "calls"}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())

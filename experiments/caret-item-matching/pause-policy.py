#!/usr/bin/env python3
"""Pause-survival policy for the pause-triggered completion call.

NO MEASURED KEYSTROKE DATA EXISTS YET. This script evaluates the POLICY under a
stated parametric prior, so the shape of the trade-off is explicit and can be
re-run with an empirical distribution once keystroke timestamps are captured.

Prior: a three-component log-normal mixture (within-word / between-word /
thinking pause). Each pause T is drawn once; the policy fires at t0 if T > t0,
the result arrives at t0 + L, and it is shown only if the user is still paused
(T > t0 + L). A fired call that arrives after the user resumed is "wasted".

Run: python3 -I experiments/caret-item-matching/pause-policy.py
"""

import math

# (weight, median seconds, sigma of ln T)
MIXTURE = [
    (0.65, 0.12, 0.50),
    (0.25, 0.45, 0.70),
    (0.10, 2.50, 1.00),
]

def normal_cdf(x: float) -> float:
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))

def survival(t: float) -> float:
    """P(T > t)."""
    total = 0.0
    for weight, median, sigma in MIXTURE:
        mu = math.log(median)
        if t <= 0:
            total += weight
        else:
            total += weight * (1.0 - normal_cdf((math.log(t) - mu) / sigma))
    return total

def conditional_remaining(t0: float, step: float = 0.02, tail: float = 60.0) -> float:
    """E[T - t0 | T > t0] by numerical integration of the survival function."""
    if survival(t0) <= 1e-9:
        return 0.0
    area = 0.0
    t = t0
    while t < tail:
        area += survival(t) * step
        t += step
    return area / survival(t0)

def evaluate(t0: float, latency: float) -> dict:
    fire = survival(t0)
    shown = survival(t0 + latency)
    long_pause = survival(1.0)
    return {
        "t0": t0,
        "latency": latency,
        "fire": fire,
        "shownGivenFire": shown / fire if fire else 0.0,
        "wastedGivenFire": (fire - shown) / fire if fire else 0.0,
        "longPauseCaptured": 1.0 if t0 <= 1.0 else (survival(t0) / long_pause if long_pause else 0.0),
        "expectedRemaining": conditional_remaining(t0),
    }

def main() -> None:
    print("prior: 65% median 0.12s / 25% 0.45s / 10% 2.50s (log-normal mixture)")
    for latency in (0.8, 1.0, 1.1, 1.4):
        print(f"\nlatency L = {latency:.1f}s")
        print("  t0   fire   shown|fire  wasted|fire  long-pause-captured  E[remaining|T>t0]")
        for t0 in (0.2, 0.3, 0.5, 0.7, 0.9, 1.2, 1.5, 2.0):
            row = evaluate(t0, latency)
            print(
                f"  {row['t0']:.1f}   {row['fire']:.3f}   {row['shownGivenFire']:.3f}"
                f"       {row['wastedGivenFire']:.3f}          {row['longPauseCaptured']:.3f}"
                f"                {row['expectedRemaining']:.2f}s"
            )

if __name__ == "__main__":
    main()

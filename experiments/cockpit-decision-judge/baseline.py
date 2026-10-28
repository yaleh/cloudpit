#!/usr/bin/env python3
"""E1 zero-cost baseline: how far does retrieval alone (no LLM) get on the weak regex labels?

Temporal protocol: item i may only retrieve from items BEFORE i. Similarity = cosine of char-bigram TF-IDF
over the ask text. Score(label) = similarity-weighted share of that label among the top-k precedents.
Reports precision at fixed coverage for two targets, against the base rate.
"""
import json, math, os, collections, sys
P = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "tmp", "cockpit-judge", "asks.jsonl")
rows = [json.loads(l) for l in open(P)]
K = 8
def grams(s):
    s = "".join(ch for ch in s if not ch.isspace())[-900:]
    return collections.Counter(s[i:i + 2] for i in range(len(s) - 1))
docs = [grams(r["ask"]) for r in rows]
df = collections.Counter(g for d in docs for g in d)
N = len(docs)
idf = {g: math.log((N + 1) / (c + 1)) + 1 for g, c in df.items()}
vec = []
for d in docs:
    v = {g: (1 + math.log(c)) * idf[g] for g, c in d.items()}
    n = math.sqrt(sum(x * x for x in v.values())) or 1
    vec.append({g: x / n for g, x in v.items()})
def cos(a, b):
    if len(a) > len(b): a, b = b, a
    return sum(x * b.get(g, 0) for g, x in a.items())
TARGETS = {"ACCEPT (plain yes)": {"ACCEPT"}, "INVESTIGATE|DISCUSS (asks for more)": {"INVESTIGATE", "DISCUSS"}}
START = 200
scores = {t: [] for t in TARGETS}
for i in range(START, N):
    sims = sorted(((cos(vec[i], vec[j]), j) for j in range(i)), reverse=True)[:K]
    tot = sum(s for s, _ in sims) or 1
    for t, labs in TARGETS.items():
        sc = sum(s for s, j in sims if rows[j]["label"] in labs) / tot
        scores[t].append((sc, rows[i]["label"] in labs))
print(f"pairs {N}, evaluated {N - START} (temporal), k={K}")
for t, arr in scores.items():
    base = sum(y for _, y in arr) / len(arr)
    arr.sort(key=lambda x: -x[0])
    print(f"\n{t}: base rate {100 * base:.1f}%")
    for cov in (0.05, 0.10, 0.20, 0.40):
        n = max(1, int(len(arr) * cov)); top = arr[:n]
        print(f"  top {int(cov * 100):2d}% by score -> precision {100 * sum(y for _, y in top) / n:5.1f}%  (n={n})")

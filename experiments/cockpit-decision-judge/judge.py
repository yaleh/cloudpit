"""E1 step 2: judge arms on the most recent N pairs (time order). A2 = ask only; A3 = ask + 6 earlier precedents
(char-bigram TF-IDF, same as baseline.py) shown with their LLM label and a reply excerpt."""
import json, math, os, sys, collections, concurrent.futures as cf
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import llm
LABELS = ['ACCEPT', 'ACCEPT_WITH_CHANGES', 'ALTERNATIVE', 'INVESTIGATE', 'DISCUSS', 'OTHER']
def load_labels():
    out = {}
    for l in open(llm.JOURNAL):
        r = json.loads(l)
        if r.get('arm') == 'label' and 'text' in r:
            p = llm.parse_json(r['text']); lab = (p or {}).get('label')
            if lab in LABELS: out[r['item']] = lab
    return out
def grams(s):
    s = ''.join(ch for ch in s if not ch.isspace())[-900:]
    return collections.Counter(s[i:i + 2] for i in range(len(s) - 1))
SYSTEM = """You predict how a software developer will answer the question their coding assistant just asked.
Possible answers:
- ACCEPT: plainly agrees with what the assistant proposed/recommended.
- ACCEPT_WITH_CHANGES: agrees with conditions or modifications.
- ALTERNATIVE: picks another option or declines.
- INVESTIGATE: asks for checks/evidence before deciding.
- DISCUSS: replies with a question, objection, design discussion.
- OTHER: changes topic / unrelated.
Return JSON only: {"dist":{"ACCEPT":p,"ACCEPT_WITH_CHANGES":p,"ALTERNATIVE":p,"INVESTIGATE":p,"DISCUSS":p,"OTHER":p},"confidence":0..1,"reason":"one line","precedents_used":["id",...]}
"confidence" = your probability that your single most likely answer is correct."""
def main():
    n_eval = int(sys.argv[1]) if len(sys.argv) > 1 else 400
    arms = sys.argv[2].split(',') if len(sys.argv) > 2 else ['A2', 'A3']
    rows = [json.loads(l) for l in open(os.path.join(llm.TMP, 'asks.jsonl'))]
    rows.sort(key=lambda r: r['at'] or 0)
    labels = load_labels()
    rows = [r for r in rows if r['id'] in labels]
    docs = [grams(r['ask']) for r in rows]; df = collections.Counter(g for d in docs for g in d); N = len(docs)
    idf = {g: math.log((N + 1) / (c + 1)) + 1 for g, c in df.items()}
    vec = []
    for d in docs:
        v = {g: (1 + math.log(c)) * idf[g] for g, c in d.items()}; nn = math.sqrt(sum(x * x for x in v.values())) or 1
        vec.append({g: x / nn for g, x in v.items()})
    cos = lambda a, b: sum(x * b.get(g, 0) for g, x in (a if len(a) < len(b) else b).items()) if True else 0
    start = N - n_eval
    done = set()
    for l in open(llm.JOURNAL):
        r = json.loads(l)
        if r.get('arm') in ('A2', 'A3') and 'text' in r: done.add((r['arm'], r['item']))
    jobs = []
    for i in range(start, N):
        a = rows[i]; base = f"PROJECT: {a.get('project')}\nASSISTANT (end of its message):\n{a['ask'][-900:]}"
        if 'A2' in arms and ('A2', a['id']) not in done: jobs.append(('A2', a['id'], base))
        if 'A3' in arms and ('A3', a['id']) not in done:
            sims = sorted(((sum(x * vec[j].get(g, 0) for g, x in vec[i].items()), j) for j in range(i)), reverse=True)[:6]
            prec = '\n'.join(f"[{rows[j]['id']}] answered {labels[rows[j]['id']]} — ask: …{rows[j]['ask'][-250:]} — reply: {rows[j]['reply'][:120]}" for _, j in sims)
            jobs.append(('A3', a['id'], base + f"\n\nEARLIER SIMILAR QUESTIONS AND HOW THIS DEVELOPER ANSWERED:\n{prec}"))
    print('jobs', len(jobs))
    with cf.ThreadPoolExecutor(4) as ex:
        futs = [ex.submit(llm.call, arm, iid, SYSTEM, u, 220) for arm, iid, u in jobs]
        for f in cf.as_completed(futs):
            try: f.result()
            except llm.BudgetExceeded: print('budget stop'); break
    json.dump({'eval_ids': [r['id'] for r in rows[start:]], 'labels': labels}, open(os.path.join(llm.TMP, 'eval-set.json'), 'w'))
    print(llm.ledger())
main()

"""E1 offline metrics, computed only from the journal (no upstream calls)."""
import json, math, os, re, sys, random, collections
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
TMP = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'tmp', 'cockpit-judge')
def pj(t):
    s = t.strip(); a, b = s.find('{'), s.rfind('}')
    try: return json.loads(s[a:b + 1])
    except Exception: return None
L = ['ACCEPT', 'ACCEPT_WITH_CHANGES', 'ALTERNATIVE', 'INVESTIGATE', 'DISCUSS', 'OTHER']
rows = {json.loads(l)['id']: json.loads(l) for l in open(os.path.join(TMP, 'asks.jsonl'))}
ev = json.load(open(os.path.join(TMP, 'eval-set.json'))); labels = ev['labels']; E = ev['eval_ids']
J = collections.defaultdict(dict); bad = collections.Counter()
for l in open(os.path.join(TMP, 'journal.jsonl')):
    r = json.loads(l)
    if 'text' not in r: continue
    if r['arm'] in ('A2', 'A3', 'E1b'):
        p = pj(r['text'])
        if p is None: bad[r['arm']] += 1; continue
        J[r['arm']][r['item']] = p
out = {'parse_failures': dict(bad)}
# label distribution
allc = collections.Counter(labels.values()); evc = collections.Counter(labels[i] for i in E)
out['labels_all'] = dict(allc); out['labels_eval'] = dict(evc)
# A0 prior & A1 retrieval vote (same TF-IDF as baseline.py), on LLM labels
order = sorted(labels, key=lambda i: rows[i]['at'] or 0); pos = {i: k for k, i in enumerate(order)}
hist = [i for i in order if i not in set(E)]
prior = collections.Counter(labels[i] for i in hist).most_common(1)[0][0]
def grams(s):
    s = ''.join(ch for ch in s if not ch.isspace())[-900:]; return collections.Counter(s[i:i + 2] for i in range(len(s) - 1))
docs = {i: grams(rows[i]['ask']) for i in order}; df = collections.Counter(g for d in docs.values() for g in d); N = len(docs)
idf = {g: math.log((N + 1) / (c + 1)) + 1 for g, c in df.items()}; vec = {}
for i, d in docs.items():
    v = {g: (1 + math.log(c)) * idf[g] for g, c in d.items()}; n = math.sqrt(sum(x * x for x in v.values())) or 1; vec[i] = {g: x / n for g, x in v.items()}
def cos(a, b):
    if len(a) > len(b): a, b = b, a
    return sum(x * b.get(g, 0) for g, x in a.items())
pred = {'A0': {}, 'A1': {}, 'A2': {}, 'A3': {}}
for i in E:
    pred['A0'][i] = (prior, None)
    sims = sorted(((cos(vec[i], vec[j]), j) for j in order[:pos[i]]), reverse=True)[:8]; tot = sum(s for s, _ in sims) or 1
    vote = collections.Counter();
    for s, j in sims: vote[labels[j]] += s / tot
    lab, share = vote.most_common(1)[0]; pred['A1'][i] = (lab, share)
    for arm in ('A2', 'A3'):
        p = J[arm].get(i)
        if not p or not isinstance(p.get('dist'), dict): continue
        d = {k: float(v) for k, v in p['dist'].items() if k in L}
        if not d: continue
        lab = max(d, key=d.get); conf = p.get('confidence'); conf = float(conf) if isinstance(conf, (int, float)) else d[lab]
        pred[arm][i] = (lab, conf)
KINDS = [('go/no-go', r'(要不要|要我|是否).{0,24}(动手|实现|开始|执行|修复|落地|做)'), ('file-as-task', r'(记成|立.{0,2}任务|立案|建.{0,2}任务|quay 任务|file)'), ('keep-watching/stop', r'(盯|继续|收手|停掉|监控|巡检)'), ('choose-between', r'(还是|A\s*[+＋]|方案\s*[A-D一二三]|你更)'), ('design ruling', r'(设计|原则|契约|架构|表态|方案)')]
def kind(i):
    t = rows[i]['ask'][-240:]
    for k, rx in KINDS:
        if re.search(rx, t): return k
    return 'other'
def cov90(items):  # items: list of (conf, correct); largest confident prefix with precision >= .9
    items = sorted(items, key=lambda x: -x[0]); best = 0; c = 0
    for n, (_, ok) in enumerate(items, 1):
        c += ok
        if n >= 5 and c / n >= 0.9: best = n
    return best
arms = {}
for arm, P in pred.items():
    ids = [i for i in E if i in P]; acc = sum(P[i][0] == labels[i] for i in ids) / max(1, len(ids))
    a = {'n': len(ids), 'accuracy': round(acc, 3)}
    if arm != 'A0':
        cs = [(P[i][1], P[i][0] == labels[i]) for i in ids]
        a['coverage90_any'] = cov90(cs)
        a['per_label'] = {}
        for lab in L:
            sub = [(P[i][1], labels[i] == lab) for i in ids if P[i][0] == lab]
            n90 = cov90(sub); a['per_label'][lab] = {'predicted': len(sub), 'true_in_eval': sum(labels[i] == lab for i in ids), 'covered_at_p90': n90}
        a['per_kind'] = {}
        for k in [x[0] for x in KINDS] + ['other']:
            sub = [(P[i][1], P[i][0] == labels[i]) for i in ids if kind(i) == k]
            a['per_kind'][k] = {'n': len(sub), 'acc': round(sum(o for _, o in sub) / max(1, len(sub)), 3), 'covered_at_p90': cov90(sub)}
        if arm in ('A2', 'A3'):
            b = collections.defaultdict(list)
            for c, o in cs: b[min(4, int(c * 5))].append(o)
            rel = {f'{k * 0.2:.1f}-{k * 0.2 + 0.2:.1f}': {'n': len(v), 'acc': round(sum(v) / len(v), 3), 'mean_conf': None} for k, v in sorted(b.items())}
            for k, v in sorted(b.items()):
                confs = [c for c, _ in cs if min(4, int(c * 5)) == k]; rel[f'{k * 0.2:.1f}-{k * 0.2 + 0.2:.1f}']['mean_conf'] = round(sum(confs) / len(confs), 3)
            a['reliability'] = rel
            a['ECE'] = round(sum(len(v) / len(cs) * abs(sum(v) / len(v) - sum(c for c, _ in cs if min(4, int(c * 5)) == k) / len(v)) for k, v in b.items()), 3)
    arms[arm] = a
out['arms'] = arms; out['prior_label'] = prior
# precedent gain with a paired bootstrap
both = [i for i in E if i in pred['A2'] and i in pred['A3']]
d = [(pred['A3'][i][0] == labels[i]) - (pred['A2'][i][0] == labels[i]) for i in both]
random.seed(7); boots = sorted(sum(random.choice(d) for _ in d) / len(d) for _ in range(2000))
out['precedent_gain'] = {'n': len(both), 'gain': round(sum(d) / len(d), 3), 'ci95': [round(boots[50], 3), round(boots[1949], 3)], 'A3_wins': d.count(1), 'A2_wins': d.count(-1)}
# ACCEPT as the auto-execute candidate: precision at fixed coverage
for arm in ('A2', 'A3'):
    sub = sorted([(pred[arm][i][1], labels[i] == 'ACCEPT') for i in E if i in pred[arm] and pred[arm][i][0] == 'ACCEPT'], key=lambda x: -x[0])
    out.setdefault('accept_curve', {})[arm] = [{'top': n, 'precision': round(sum(o for _, o in sub[:n]) / n, 3)} for n in (5, 10, 20, 40) if n <= len(sub)]
# high-confidence misses (A3)
miss = sorted([(pred['A3'][i][1], i) for i in E if i in pred['A3'] and pred['A3'][i][0] != labels[i]], reverse=True)[:12]
out['hc_misses_A3'] = [{'id': i, 'conf': c, 'pred': pred['A3'][i][0], 'label': labels[i], 'ask': rows[i]['ask'][-110:].replace('\n', ' '), 'reply': rows[i]['reply'][:90].replace('\n', ' ')} for c, i in miss]
# E1b
items = json.load(open(os.path.join(TMP, 'e1b-items.json'))); res = []
for it in items:
    p = J['E1b'].get(it['id'])
    if p and isinstance(p.get('p_land'), (int, float)): res.append((float(p['p_land']), it['truth_landed'], it['wall_min'], p.get('blocker_fixed')))
fails = [r for r in res if not r[1]]
curve = []
for tau in (0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.5):
    held = [r for r in res if r[0] < tau]
    if not held: curve.append({'tau': tau, 'held': 0}); continue
    tp = [r for r in held if not r[1]]
    curve.append({'tau': tau, 'held': len(held), 'precision': round(len(tp) / len(held), 3), 'recall': round(len(tp) / max(1, len(fails)), 3), 'worker_min_saved': round(sum(r[2] for r in tp)), 'landings_delayed': len(held) - len(tp)})
bf = collections.defaultdict(list)
for r in res: bf[str(r[3])].append(r[1])
out['e1b'] = {'n': len(res), 'landed': sum(r[1] for r in res), 'fail_minutes_total': round(sum(r[2] for r in fails)), 'curve': curve, 'land_rate_by_blocker_fixed': {k: {'n': len(v), 'land_rate': round(sum(v) / len(v), 3)} for k, v in bf.items()}}
# AUC of p_land
pos_ = [r[0] for r in res if r[1]]; neg_ = [r[0] for r in res if not r[1]]
out['e1b']['auc'] = round(sum((p > n) + 0.5 * (p == n) for p in pos_ for n in neg_) / max(1, len(pos_) * len(neg_)), 3)
out['ledger'] = json.load(open(os.path.join(TMP, 'ledger.json')))
json.dump(out, open(os.path.join(TMP, 'results.json'), 'w'), ensure_ascii=False, indent=1)
print(json.dumps({k: v for k, v in out.items() if k not in ('hc_misses_A3',)}, ensure_ascii=False, indent=1)[:9000])

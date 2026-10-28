"""E1b-LLM: for attempts preceded by >=2 consecutive same-signature failures, ask the judge whether this attempt
will land, given the previous failure reasons and the develop commit subjects between the attempts. Read-only."""
import json, os, sys, subprocess, concurrent.futures as cf
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import llm
REPO = '/data/home/yale/work/claudecodeui'
def landed(r): return (r.get('mechanical_fan_in') or {}).get('outcome') == 'landed' or r.get('final_state') == 'completed'
def reason(r):
    m = r.get('mechanical_fan_in') or {}
    return (m.get('step') or '') + ': ' + (m.get('reason') or r.get('failure_reason') or r.get('final_state') or '')
def sig(r):
    if landed(r): return 'LANDED'
    m = r.get('mechanical_fan_in') or {}; reason_ = (m.get('reason') or r.get('failure_reason') or ''); step = m.get('step') or ''
    if reason_.startswith('# fail 0'): return 'suite:# fail 0'
    if '__PERFILE__' in reason_: return 'suite:named failing file'
    if 'leaked' in reason_: return 'suite:leaked-processes'
    if step: return f'{step}:{reason_[:28]}'
    return 'exit:' + (r.get('final_state') or '?') + ':' + (r.get('failure_reason') or '')[:30]
def build():
    rows = [json.loads(l) for l in open(os.path.join(REPO, '.quay/worker-outcome.jsonl')) if l.strip()]
    by = {}
    for r in rows: by.setdefault(r['task'], []).append(r)
    items = []
    for t, a in by.items():
        a.sort(key=lambda r: r.get('started_at') or '')
        for i in range(2, len(a)):
            p1, p2 = a[i - 1], a[i - 2]
            if landed(p1) or landed(p2) or sig(p1) != sig(p2): continue
            cur = a[i]
            since, until = p1.get('ended_at'), cur.get('started_at')
            if not since or not until: continue
            subj = subprocess.run(['git', '-C', REPO, 'log', 'develop', f'--since={since}', f'--until={until}', '--format=%s'], capture_output=True, text=True).stdout.strip().splitlines()
            items.append({'id': f'{t}#{i}', 'task': t, 'truth_landed': landed(cur), 'wall_min': (cur.get('wall_clock_ms') or 0) / 60000,
                          'prev': [reason(x)[:300] for x in a[max(0, i - 3):i]], 'commits': subj[:40], 'n_commits': len(subj)})
    return items
SYSTEM = """A task worker in an automated dev pipeline keeps failing. Its previous attempts failed with the same
signature. Decide whether the NEXT attempt (about to start) will land, using the failure reasons and the subjects of
the commits that landed on the develop branch between the last failure and this attempt (a fix to the blocker usually
shows up there). Return JSON only: {"p_land":0..1,"reason":"one line","blocker_fixed":true|false|null}"""
def main():
    items = build()
    json.dump(items, open(os.path.join(llm.TMP, 'e1b-items.json'), 'w'), ensure_ascii=False)
    print('items', len(items), 'landed', sum(i['truth_landed'] for i in items))
    done = {json.loads(l)['item'] for l in open(llm.JOURNAL) if json.loads(l).get('arm') == 'E1b' and 'text' in json.loads(l)}
    def prompt(it):
        c = '\n'.join('- ' + s for s in it['commits']) or '(no commits on develop in between)'
        more = f"\n(+{it['n_commits'] - 40} more)" if it['n_commits'] > 40 else ''
        return f"TASK: {it['task']}\nPREVIOUS ATTEMPTS (oldest first):\n" + '\n'.join('- ' + p for p in it['prev']) + f"\n\nCOMMITS ON develop SINCE THE LAST FAILURE ({it['n_commits']}):\n{c}{more}"
    todo = [it for it in items if it['id'] not in done]
    with cf.ThreadPoolExecutor(4) as ex:
        futs = [ex.submit(llm.call, 'E1b', it['id'], SYSTEM, prompt(it), 160) for it in todo]
        for f in cf.as_completed(futs):
            try: f.result()
            except llm.BudgetExceeded: print('budget stop'); break
    print(llm.ledger())
main()

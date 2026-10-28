"""Shared gateway client for E1: journal every call, keep a token ledger, refuse calls past the budget.
Key comes from the environment (FJDAC_API_KEY); it is never printed or written."""
import json, os, threading, time, urllib.request, urllib.error, uuid
HERE = os.path.dirname(os.path.abspath(__file__))
TMP = os.path.join(HERE, '..', '..', 'tmp', 'cockpit-judge')
JOURNAL = os.path.join(TMP, 'journal.jsonl'); LEDGER = os.path.join(TMP, 'ledger.json')
BASE = os.environ['ANTHROPIC_BASE_URL'].rstrip('/'); KEY = os.environ['FJDAC_API_KEY']
MODEL = 'v4.1flash'; STOP_AT = 3_600_000
_lock = threading.Lock()
def ledger():
    try: return json.load(open(LEDGER))
    except Exception: return {'input_tokens': 0, 'output_tokens': 0, 'calls': 0, 'failed': 0}
def _save(l): json.dump(l, open(LEDGER, 'w'))
class BudgetExceeded(Exception): pass
def call(arm, item_id, system, user, max_tokens=300):
    with _lock:
        if ledger()['input_tokens'] >= STOP_AT: raise BudgetExceeded()
    body = json.dumps({'model': MODEL, 'max_tokens': max_tokens, 'system': system, 'thinking': {'type': 'disabled'},
                       'messages': [{'role': 'user', 'content': user}]}).encode()
    rid = uuid.uuid4().hex[:12]; err = None
    for attempt in range(4):
        t0 = time.time()
        try:
            req = urllib.request.Request(BASE + '/v1/messages', data=body, headers={'content-type': 'application/json', 'x-api-key': KEY, 'anthropic-version': '2023-06-01'})
            with urllib.request.urlopen(req, timeout=90) as r: p = json.loads(r.read())
            text = ''.join(c.get('text', '') for c in p.get('content', []) if c.get('type') == 'text')
            u = p.get('usage') or {}; ms = int((time.time() - t0) * 1000)
            rec = {'rid': rid, 'arm': arm, 'item': item_id, 'at': time.time(), 'ms': ms, 'usage': {'in': u.get('input_tokens', 0) + u.get('cache_read_input_tokens', 0) + u.get('cache_creation_input_tokens', 0), 'out': u.get('output_tokens', 0)}, 'text': text}
            with _lock:
                l = ledger(); l['input_tokens'] += rec['usage']['in']; l['output_tokens'] += rec['usage']['out']; l['calls'] += 1; _save(l)
                with open(JOURNAL, 'a') as f: f.write(json.dumps(rec, ensure_ascii=False) + '\n')
            return rec
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, ConnectionError, json.JSONDecodeError) as e:
            err = type(e).__name__ + ':' + str(getattr(e, 'code', ''))
            time.sleep(1.5 * (attempt + 1))
    with _lock:
        l = ledger(); l['failed'] += 1; _save(l)
        with open(JOURNAL, 'a') as f: f.write(json.dumps({'rid': rid, 'arm': arm, 'item': item_id, 'at': time.time(), 'error': err}) + '\n')
    return None
def parse_json(text):
    s = text.strip()
    if '```' in s: s = s.split('```')[1].lstrip('json').strip() if s.count('```') >= 2 else s
    a, b = s.find('{'), s.rfind('}')
    try: return json.loads(s[a:b + 1])
    except Exception: return None

"""E1 step 1: LLM labeler. Labels how the user answered an assistant's ask, from the ask tail and the reply only."""
import json, os, sys, concurrent.futures as cf
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import llm
SYSTEM = """You classify how a software developer answered a question that their coding assistant asked.
Labels:
- ACCEPT: plainly agrees to what the assistant proposed or recommended (e.g. "同意", "好", "可以，推进"), no changes.
- ACCEPT_WITH_CHANGES: agrees but adds conditions, extra steps or modifications.
- ALTERNATIVE: picks a different option than the one the assistant recommended, or declines it.
- INVESTIGATE: asks the assistant to check/verify/look something up/show evidence before deciding.
- DISCUSS: answers with a question, design discussion, objection, or reframing; no decision yet.
- OTHER: unrelated to the question, a new topic, or impossible to tell.
Return JSON only: {"label":"<LABEL>"}"""
def item_prompt(a): return f"ASSISTANT (end of its message):\n{a['ask'][-900:]}\n\nDEVELOPER REPLY:\n{a['reply'][:400]}"
def main():
    rows = [json.loads(l) for l in open(os.path.join(llm.TMP, 'asks.jsonl'))]
    limit = int(sys.argv[1]) if len(sys.argv) > 1 else len(rows)
    done = set()
    if os.path.exists(llm.JOURNAL):
        for l in open(llm.JOURNAL):
            r = json.loads(l)
            if r.get('arm') == 'label' and 'text' in r: done.add(r['item'])
    todo = [a for a in rows if a['id'] not in done][:limit]
    with cf.ThreadPoolExecutor(4) as ex:
        futs = [ex.submit(llm.call, 'label', a['id'], SYSTEM, item_prompt(a), 20) for a in todo]
        for f in cf.as_completed(futs):
            try: f.result()
            except llm.BudgetExceeded: print('budget stop'); break
    print('labeled', len(todo), llm.ledger())
main()

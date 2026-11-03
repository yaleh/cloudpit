// The run-end summary's mechanical quality readings and their bounds.


// ---- the narrator's run-end summary (TEXT layer only) -------------------------------------------
//
// WHAT THIS IS. When a run ends, the narrator — a SIDE text model, never the realtime relay — is
// asked for one short spoken summary of the run's latest output. The relay stays the "pen": it
// forwards words and reports what happened, and this file only decides WHEN to ask and carries the
// answer to the narrator's own text queue. TTS is a later task; here the loop closes at text.
//
// THE TRANSITION ALSO SPEAKS A FIXED ACK (2026-10-20). The side model takes 0.6–1 s (previously
// 6–12 s), but the gap between the run ending and the first sound was still a silent 8–13 s in the
// live wire. So the SAME transition first enqueues one deployment-chosen confirmation
// (`VOICE_REALTIME_RUN_END_ACK`), and only then arms the settle wait for the summary. The ack is
// independent of the pack, the model answer and the quality gate — see `VoiceRealtimeRunEndAckSeam`.
//
// WHY THE SETTLE WAIT IS LOAD-BEARING. The context pack the browser built may lag the run's last
// output by the time the run ends. Asking the summarizer at the transition itself would summarize
// the PREVIOUS state of the work — the exact timing failure this mechanism has to survive. So the
// summarizer is asked `settleMs` after the transition and reads the context pack THAT MOMENT, not
// the one the transition saw.
//
// WHY THE HOST IS POLLED. The relay is never told a run ended (see `busyPollMs`): the host's own
// activity record is a PULL reading. The watcher below samples `hostRunActivity` while the status
// says a run is live and treats only an explicit `busy: false` as the end — an unreadable host
// (`null`) keeps waiting rather than inventing an end.

/** How long after a run ends the summarizer is asked, so the last output has landed in the context pack. */
export const DEFAULT_RUN_END_SUMMARY_SETTLE_MS = 400;

/**
 * How long the run-end summary waits for the page's `run_output` reply.
 *
 * The summary source is the RUN'S OWN OUTPUT, fetched on demand: the server sends
 * `run_output_request` and the page renders that turn from its transcript. Nothing is cached, so
 * there is no staleness to reason about; the only failure left is a page that does not answer.
 * Two seconds covers a busy render without making the driver wait on a dead socket.
 */
export const DEFAULT_RUN_OUTPUT_WAIT_MS = 2_000;

/** How often the host's run-activity reading is sampled while a run is believed live. */
export const DEFAULT_RUN_END_SUMMARY_POLL_MS = 250;

/**
 * The most characters the summary's longest shared SUFFIX with the source may carry.
 *
 * The B-1 probe's `verbatimTail` reading: a summary whose tail is the output's own tail is reading
 * the output back instead of summarizing it. A few characters of overlap (punctuation, a common
 * ending) are not that, so the bound is small but not zero.
 */
export const RUN_END_SUMMARY_MAX_VERBATIM_TAIL = 6;

/**
 * The three mechanical quality readings `experiments/voice-realtime-announce-summary/summarize.mts`
 * pinned, kept here so the gate and the experiment judge a summary the same way.
 *
 * `chars` is the summary's length (LOGGED, not gated since 2026-10-20 — `qwen-flash` answers run
 * 42–44 chars), `markdown` the glyphs a voice cannot pronounce (`# * \` | -`, each recorded once),
 * and `verbatimTail` the longest suffix the summary shares with the source.
 *
 * Consumers: the proxy's run-end gate (it refuses Markdown and a read-back tail) and
 * `tests/voice-realtime-run-end-summary.test.ts` (it re-reads the injected text with the same
 * function, so the criterion cannot pass on a different idea of "short" or "verbatim").
 */
export type VoiceRealtimeSummaryQuality = {
  chars: number;
  markdown: string[];
  verbatimTail: number;
};

/**
 * Reads one summary's mechanical quality against the source it summarizes.
 *
 * The readings are the experiment's, copied deliberately: `verbatimTail` walks the shared suffix
 * outward until it stops matching, and `markdown` records each forbidden glyph once. Pure and
 * total — an empty source answers `verbatimTail: 0`.
 */
export function readVoiceRealtimeSummaryQuality(
  summary: string,
  source: string,
): VoiceRealtimeSummaryQuality {
  const markdown: string[] = [];
  for (const ch of summary) {
    if ('#*`|'.includes(ch) || (ch === '-' && !markdown.includes('-'))) markdown.push(ch);
  }
  let verbatimTail = 0;
  for (let n = 1; n <= Math.min(summary.length, source.length); n++) {
    if (summary.slice(-n) === source.slice(-n)) verbatimTail = n;
    else break;
  }
  return { chars: summary.length, markdown, verbatimTail };
}

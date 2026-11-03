// The relay's small text predicates and the bounds they are read with.


/**
 * How long a relayed instruction may wait for its committed segment's transcription.
 *
 * THE RACE THIS CLOSES. The endpoint reports a segment's transcript and the model relays it as two
 * independent upstream events, and nothing orders them: measured on the 2026-10-11 defect the
 * transcription preceded the `session_send` call by 273 ms, but the reverse is just as legal. A
 * guard that only looks at the transcript when the call arrives would therefore deliver an invented
 * message whenever the model answers first, so the delivery point HOLDS a call whose segment has no
 * transcription yet and releases it the moment one lands (or the segment settles).
 *
 * WHY A CEILING AT ALL. The hold must never become a deadlock: a caller that committed a segment
 * but whose endpoint never transcribes it (the offline protocol suites are exactly that case) would
 * otherwise wait forever for an event that is not coming. This is the point at which the guard
 * gives up and FAILS OPEN — an unknown transcript is not an empty one, and inventing a delay for a
 * delivery the user is waiting on is worse than relaying words nobody has proved absent. It sits
 * well under the retry/poll budgets the criteria use, so a held call still reads as delivered.
 */
export const SEGMENT_TRANSCRIPT_GRACE_MS = 600;

/**
 * Whether a relayed piece carries no words at all: empty, whitespace, or punctuation/symbols only.
 *
 * THE BOUND IS MECHANICAL, and that line is deliberate. The endpoint saying "zero words" is the one
 * fact this guard may act on; nothing here compares the relayed text with what the person said, and
 * nothing here decides whether a message is *worth* sending. A filter that started with stop words
 * would be a different mechanism with a different failure mode (`嗯`/`呃` are content: they are
 * relayed, and the negative control in the criteria holds this predicate to that).
 *
 * `\p{P}` covers `。`, `…`, `！` and the rest of the punctuation blocks; `\p{S}` covers the symbol
 * blocks, so a stray emoji-like mark is not mistaken for speech either.
 */
export const EMPTY_RELAY_TEXT = /^[\s\p{P}\p{S}]*$/u;

/**
 * The form the continuous-mode duplicate guard compares two relayed messages in.
 *
 * WHY A NORMALIZATION AT ALL. The endpoint's transcript and the model's relay are independent
 * upstream events, and JSON quoting mangles one against the other: two relays of the SAME spoken
 * sentence differed only in where a quote landed — 「只有用"现在我在用live voice"」 against
 * 「只有"用现在我在用live voice"」 (journal 95a9d738). Comparing raw strings would call those
 * different and deliver the sentence twice. Collapsing whitespace, punctuation and symbols to
 * nothing — the same character classes {@link EMPTY_RELAY_TEXT} already treats as non-words — makes
 * the two forms equal while leaving the spoken words themselves untouched.
 */
export function normalizeRelayText(text: string): string {
  return text.replace(/[\s\p{P}\p{S}]+/gu, '');
}

/**
 * Whether `next` says NOTHING the previous delivery did not already say: every character of the new
 * message appears, in order, inside the previous one.
 *
 * WHY A SUBSEQUENCE AND NOT EQUALITY (ruling 2026-10-16; live journal `cae49fed`). The continuous
 * wire's duplicate guard used to require the new text to EQUAL the last delivery or be CONTAINED in
 * it, which the model defeats the moment it restates rather than copies. Live: the relay delivered
 * "A B" (the span guard prepends a heard sentence the model's call left out), and 44 s later, with no
 * new audio, the model re-sent A — its filler words dropped ("嗯" removed), punctuation added, one
 * phrase reworded (`real time 服模型` → `realtime 模型`) — and it went through, because the rewritten
 * form is neither equal to nor contained in the delivered one. Every one of those edits is an
 * ELISION or a punctuation change, and normalization already removes the punctuation, so the
 * re-send's characters all survive in the delivered text, in order. That is the whole shape: a model
 * RETYPING a transcript it read elides, it does not invent.
 *
 * WHAT IT DELIBERATELY DOES NOT CATCH: a restatement that SUBSTITUTES words rather than eliding them
 * (journal `259b51e0`, `batch` for `bash`), which shares too little to read as the same words. That
 * class stays delivered — and it is also the class the relay must not drop on a guess, since a
 * substituted word can be the correction the person is waiting for. Leg A of this task removes the
 * exit path's unasked-for response, which is the response that produced both live instances.
 *
 * WHY THIS IS STILL A REAL TEST, not a widening that swallows everything: an ADDITION (the model
 * continuing a sentence it had already started, or relaying a second thought) puts characters in
 * `next` that are not in `previous` in that order, so it fails — which is exactly what the relay's
 * coalescing window and busy hold depend on (a tail joining an open window must be let through; see
 * `proceedRelay`'s `joiningOpenWindow`). An empty `next` never reaches here (`EMPTY_RELAY_TEXT` has
 * already answered it) and an empty `previous` has nothing to be a restatement of.
 *
 * WHY NOT A SIMILARITY THRESHOLD. A distance or overlap ratio needs a number, and the corpus does not
 * offer one: the shapes on both sides of the line (a one-character substitution, a sentence continued
 * after a pause) differ by an amount a threshold would have to be tuned to, and would then be tuned
 * per language. Subsequence needs no tuning: it is an exact predicate, and it is a strict
 * generalization of the containment test it replaces, so a relay that used to be refused still is.
 */
export function relayRestatesDelivery(next: string, previous: string): boolean {
  if (previous === '' || next.length > previous.length) {
    return false;
  }
  let matched = 0;
  for (let index = 0; index < previous.length && matched < next.length; index += 1) {
    if (previous[index] === next[matched]) {
      matched += 1;
    }
  }
  return matched === next.length;
}


/**
 * The UTF-8 byte length of a relayed message, which is the unit {@link VOICE_QUEUE_MAX_BYTES} is
 * written in. A non-string message (the model occasionally calls `session_send` without `message`)
 * counts as zero: there are no words to spend the budget on.
 */
export function voiceMessageBytes(message: unknown): number {
  return typeof message === 'string' ? Buffer.byteLength(message, 'utf8') : 0;
}

/** The reason code a refused `session_send` carries — stable, so the model can act on it, and so the log can be read. */
export const VOICE_QUEUE_FULL_REASON = 'VOICE_QUEUE_FULL';

/**
 * The most pack text one `context` frame may carry, in UTF-16 code units.
 *
 * The browser builds its pack to the SPEC's own budget; this bound is the browser's absolute
 * CEILING (`VOICE_CONTEXT_PACK_BROWSER_CEILING`), not the shipped default. The connection's
 * effective budget (200–4000) trims every frame before this check (see the dispatch below), so this
 * is the backstop for a caller that bypassed the trim. A frame over it is refused whole — not
 * truncated — because a partial pack is a conversation with a hole in it, and a hole is worse for
 * the model than no context at all.
 */
export const VOICE_REALTIME_CONTEXT_MAX_CHARS = 4000;

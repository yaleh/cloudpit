import { readFileSync } from 'node:fs';

import { OMISSION_FILL_NUMERAL_MODES, type OmissionFillParams } from "./voice-realtime-omission-fill.js";

// The omission-fill parameters shipped beside the module, loaded once at module evaluation.


/**
 * The omission-fill parameters SHIPPED WITH THE SERVER, loaded ONCE at module load.
 *
 * WHY A LOAD-TIME READ RATHER THAN `import … with { type: 'json' }`. A relative `.json` specifier is
 * an internal specifier whose target is outside AC-394's `.ts`/`.tsx` scan set, so the
 * `server-import-cycle-budget` criterion counts it as unresolved — and that budget may only fall.
 * The shipping contract is unchanged: `server/tsconfig.json` lists the JSON in `include` (the same
 * way it lists the `.mjs` hook), so tsc copies it to
 * `dist-server/server/modules/voice-realtime/omission-fill-params.json`, exactly beside this
 * compiled service, and `import.meta.url` finds it in a built tree.
 *
 * Reading it HERE (module evaluation) rather than per connection is also what keeps the per-
 * connection filesystem seam in AC-402 (a) discriminating: that seam throws for any path naming
 * `omission-fill-params.json`, so a reader that went back to opening `experiments/…` on every
 * connection would be caught, while these shipped values are already in memory.
 *
 * A file that is missing, unreadable, or not a JSON object yields `null`; {@link readOmissionFillParams}
 * then reports the reason and leaves the producer OFF. Never a guessed parameter set.
 */
const OMISSION_FILL_PARAMS: { chosen?: Record<string, unknown> } | null = (() => {
  try {
    const parsed: unknown = JSON.parse(
      readFileSync(new URL('../omission-fill-params.json', import.meta.url), 'utf8'),
    );
    return parsed !== null && typeof parsed === 'object' ? (parsed as { chosen?: Record<string, unknown> }) : null;
  } catch {
    return null;
  }
})();

/**
 * Reads and validates the omission-fill parameters that ship with `server/`.
 *
 * THE PARAMETER FILE IS OWNED BY `server/` AND TRAVELS WITH THE BUILD. `omission-fill-params.json`
 * is listed in `server/tsconfig.json`'s `include`, so tsc copies it beside this compiled service: a
 * `dist-server` deployment never needs the `experiments/` tree. The earlier reader resolved the
 * application root and re-read `experiments/voice-relay-qb/omission-fill-params.json` on every
 * connection, which made a deployment's producer silently switch off when that measurement-only
 * directory was absent.
 *
 * HOT CHANGES GO THROUGH THE SETTINGS FILE. The loaded values are fixed at process start; an
 * operator changes them for the NEXT connection through `voice-realtime-settings.ts`'s optional
 * `omissionFill` key, which the caller merges over these below. A live connection keeps the values
 * it logged.
 *
 * `params: null` with a `problem` is the honest answer to an unreadable or malformed shipped block:
 * the caller records it and leaves the producer OFF. A guessed fallback would be a second source of
 * truth, and the rule's own module deliberately declares none.
 *
 * Consumers: {@link handleVoiceRealtimeConnection}, once per connection.
 */
export function readOmissionFillParams(): { params: OmissionFillParams | null; problem: string | null } {
  if (OMISSION_FILL_PARAMS === null) {
    return { params: null, problem: 'unreadable omission-fill-params.json' };
  }
  const chosen = OMISSION_FILL_PARAMS.chosen;
  if (chosen === null || typeof chosen !== 'object') {
    return { params: null, problem: 'missing chosen block' };
  }
  const hMs = chosen.h_ms;
  const gMs = chosen.g_ms;
  const scoreT = chosen.score_t;
  const wMin = chosen.w_min;
  const wHallu = chosen.w_hallu;
  const domN = chosen.dom_n;
  const lookbackMs = chosen.lookback_ms;
  const silenceMs = chosen.silence_ms;
  const numeralMode = chosen.numeral_mode;
  if (
    typeof hMs !== 'number' ||
    typeof gMs !== 'number' ||
    typeof scoreT !== 'number' ||
    typeof wMin !== 'number' ||
    typeof wHallu !== 'number' ||
    typeof domN !== 'number' ||
    typeof lookbackMs !== 'number' ||
    !(typeof silenceMs === 'number' || silenceMs === null) ||
    typeof numeralMode !== 'string' ||
    !OMISSION_FILL_NUMERAL_MODES.includes(numeralMode as OmissionFillParams['numeralMode'])
  ) {
    return { params: null, problem: 'malformed chosen block' };
  }
  return {
    params: {
      hMs,
      gMs,
      scoreT,
      wMin,
      wHallu,
      domN,
      lookbackMs,
      silenceMs,
      numeralMode: numeralMode as OmissionFillParams['numeralMode'],
    },
    problem: null,
  };
}

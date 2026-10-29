#!/usr/bin/env node
/**
 * The controls for `scripts/e2e-run-ceilings.mjs` — the two origins the e2e run watchdog measures from,
 * and the control arm that produced the defect behind `gap-ac323-boot-ceiling-counts-config-evaluation`.
 *
 * WHY THESE CASES EXIST. The defect is a *pointer*, not a magnitude: `BOOT_CEILING_MS = 40_000` was
 * correct as a bound on "the unbounded pre-spawn probe", and the run that died at 56826ms was killed by
 * it because the deadline was counted from `runStartedAt` — so config evaluation itself (a synchronous
 * seed + client-root copy + server bundle, 56.8s under the load of gate event
 * `9d08ccd0-c886-4e58-b750-ea2f2eeb7ede`) consumed it before Playwright spawned a webServer. A test that
 * only asserted "the boot deadline is 40s after something" would pass against that old code, so each case
 * below pins the *origin*:
 *
 *   · the boot deadline moves with `configEvalCompletedAt` — config evaluation time is NOT charged to it;
 *   · the run deadline stays pinned to `runStartedAt` — the whole invocation IS charged to it;
 *   · the control-arm knob reads 0 by default and clamps at 120000 in both directions, because a knob
 *     that only clamped above would let a negative value park the thread for an unbounded time.
 *
 * The stall itself is not waited on here: `stallConfigEvaluation` blocks the calling thread, so a case
 * that exercised it would sleep the suite. Its arithmetic is what the clamp cases read, and it is
 * exercised end-to-end by the task's AC1/AC2/AC3 runs against the real runner.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CONFIG_EVAL_STALL_ENV,
  CONFIG_EVAL_STALL_MAX_MS,
  bootDeadlineFrom,
  readConfigEvalStallMs,
  runDeadlineFrom,
  stallConfigEvaluation,
  timerDelay,
} from './e2e-run-ceilings.mjs';

test('the boot deadline is anchored at the end of config evaluation, not at the run start', () => {
  const runStartedAt = 1_000;
  const configEvalCompletedAt = 57_826;
  const bootCeilingMs = 40_000;

  // The recorded failure: config evaluation alone (56.8s) already crossed a 40s ceiling measured from
  // `runStartedAt`. Anchored at the end of evaluation it has a full window left to boot in.
  assert.equal(bootDeadlineFrom(configEvalCompletedAt, bootCeilingMs), 97_826);
  assert.ok(
    bootDeadlineFrom(configEvalCompletedAt, bootCeilingMs) - configEvalCompletedAt === bootCeilingMs,
    'the boot window must be exactly BOOT_CEILING_MS long from the end of config evaluation',
  );
  assert.ok(
    bootDeadlineFrom(configEvalCompletedAt, bootCeilingMs) > runStartedAt + bootCeilingMs,
    'a slow config evaluation must not consume the boot window — the old origin did',
  );
});

test('the run ceiling is still anchored at the run start', () => {
  const runStartedAt = 1_000;
  const runCeilingMs = 240_000;

  assert.equal(runDeadlineFrom(runStartedAt, runCeilingMs), 241_000);
  // The two origins are independent: a boot deadline computed from config evaluation must not move the
  // run deadline, which bounds the whole invocation including config evaluation.
  assert.notEqual(runDeadlineFrom(runStartedAt, runCeilingMs), bootDeadlineFrom(57_826, runCeilingMs));
  assert.equal(runDeadlineFrom(57_826, runCeilingMs) - 57_826, runCeilingMs);
});

test('timerDelay converts a deadline to a non-negative wait', () => {
  assert.equal(timerDelay(1_500, 1_000), 500);
  assert.equal(timerDelay(1_000, 1_000), 0);
  // A deadline already in the past fires immediately rather than waiting a negative time.
  assert.equal(timerDelay(1_000, 5_000), 0);
});

test('the control-arm stall knob reads 0 by default', () => {
  assert.equal(readConfigEvalStallMs({}), 0);
  assert.equal(readConfigEvalStallMs({ [CONFIG_EVAL_STALL_ENV]: '' }), 0);
  assert.equal(readConfigEvalStallMs({ [CONFIG_EVAL_STALL_ENV]: '   ' }), 0);
  // A malformed knob must not throw inside config evaluation, where a throw is a red run for a reason
  // none of its own assertions can name.
  assert.equal(readConfigEvalStallMs({ [CONFIG_EVAL_STALL_ENV]: 'not-a-number' }), 0);
  assert.equal(readConfigEvalStallMs({ [CONFIG_EVAL_STALL_ENV]: 'NaN' }), 0);
  // Default argument is the process environment, which carries no stall unless a control arm set it.
  const saved = process.env[CONFIG_EVAL_STALL_ENV];
  delete process.env[CONFIG_EVAL_STALL_ENV];
  try {
    assert.equal(readConfigEvalStallMs(), 0);
  } finally {
    if (saved !== undefined) process.env[CONFIG_EVAL_STALL_ENV] = saved;
  }
});

test('the control-arm stall knob clamps to [0, 120000]', () => {
  assert.equal(readConfigEvalStallMs({ [CONFIG_EVAL_STALL_ENV]: '45000' }), 45_000);
  assert.equal(readConfigEvalStallMs({ [CONFIG_EVAL_STALL_ENV]: ' 45000 ' }), 45_000);
  assert.equal(readConfigEvalStallMs({ [CONFIG_EVAL_STALL_ENV]: '45000.9' }), 45_000);
  assert.equal(readConfigEvalStallMs({ [CONFIG_EVAL_STALL_ENV]: '-1' }), 0);
  assert.equal(readConfigEvalStallMs({ [CONFIG_EVAL_STALL_ENV]: String(CONFIG_EVAL_STALL_MAX_MS) }), 120_000);
  assert.equal(readConfigEvalStallMs({ [CONFIG_EVAL_STALL_ENV]: '999999' }), 120_000);
  assert.equal(CONFIG_EVAL_STALL_MAX_MS, 120_000);
  // `stallConfigEvaluation(0)` is the shipped path: it must not park the thread at all.
  assert.equal(stallConfigEvaluation(0), 0);
  assert.equal(stallConfigEvaluation(-10), 0);
});

#!/usr/bin/env bash
#
# The bounded acceptance entry for AC-447 (the edit-and-resend continuity story).
#
# It runs the two executable criteria and then VERIFIES the browser evidence this task was
# accepted on. It deliberately does not run the full suite (that is quay fan-in's job) and it
# does not start a browser or a server: the browser leg is expensive and needs a built client
# and an isolated instance, so it is run once, its report is hashed into a manifest, and this
# entry refuses to pass without that evidence.
#
# WHAT "WITHOUT EVIDENCE" MEANS. There is no skip arm. A missing report, an empty report, a
# report whose `ok` is false, a report that does not carry the readings below, a screenshot
# that no longer exists, or a manifest whose `gitHead` is not the tree being checked — each is
# a failure of this script. In particular an OLD report cannot be reused after the tree moves:
# the manifest records the commit the evidence was produced on, and a checkout at a different
# commit has to regenerate it.
#
# EVIDENCE LAYOUT (default `tmp/session-edit-continuity`, override with
# SESSION_EDIT_CONTINUITY_EVIDENCE_DIR):
#   manifest.json            task, goal AC, gitHead, generatedAt, sha256 of every artifact
#   browser/report.json      the independent Playwright drive's report (DOM readings + control)
#   browser/*.png            that drive's screenshots
#   scenario/report.json     scripts/ui-scenario.mjs output for the committed scenario
#   scenario/step-*.png      the scenario's checkpoint screenshots
#
# The scenario itself is `scripts/ui-scenarios/session-edit-continuity.json`; it is committed,
# so the readings below describe a scenario in the tree rather than a private transcript.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

EVIDENCE_DIR="${SESSION_EDIT_CONTINUITY_EVIDENCE_DIR:-$REPO_ROOT/tmp/session-edit-continuity}"

say() { printf '[continuity-check] %s\n' "$*"; }
die() { printf '[continuity-check] FAIL %s\n' "$*" >&2; exit 1; }

# The acceptance entry is the two executable criteria, in the order they were written: the
# cross-module story first, then the real bundled CLI's fork.
say "AC-1 cross-module continuity criterion"
npx tsx --tsconfig server/tsconfig.json --test server/modules/websocket/tests/session-edit-continuity.test.ts

say "AC-5 real Codex CLI fork/read criterion"
npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/session-edit-real-cli.test.ts

say "browser evidence in $EVIDENCE_DIR"
HEAD="$(git rev-parse HEAD)"
node - "$EVIDENCE_DIR" "$HEAD" <<'NODE'
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const evidenceDir = path.resolve(process.argv[2]);
const head = process.argv[3];
const failures = [];
const fail = (message) => failures.push(message);
const readJson = (file) => {
  const text = fs.readFileSync(file, 'utf8');
  return JSON.parse(text);
};
const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const exists = (file) => {
  try {
    return fs.statSync(file).size > 0;
  } catch {
    return false;
  }
};

const manifestPath = path.join(evidenceDir, 'manifest.json');
if (!exists(manifestPath)) {
  fail(`manifest missing: ${manifestPath}`);
} else {
  const manifest = readJson(manifestPath);
  if (manifest.task !== 'gap-session-edit-continuity-e2e') {
    fail(`manifest.task is ${JSON.stringify(manifest.task)}`);
  }
  if (manifest.goalAc !== 'AC-447') {
    fail(`manifest.goalAc is ${JSON.stringify(manifest.goalAc)}`);
  }
  if (manifest.gitHead !== head) {
    fail(`evidence was produced on ${manifest.gitHead}, this tree is ${head} — regenerate the browser evidence`);
  }
  if (Number.isNaN(Date.parse(manifest.generatedAt ?? ''))) {
    fail('manifest.generatedAt is not a timestamp');
  }
  const artifacts = manifest.artifacts ?? {};
  const names = Object.keys(artifacts);
  if (names.length < 9) {
    fail(`manifest lists ${names.length} artifacts; the browser and scenario reports plus screenshots are required`);
  }
  for (const name of names) {
    const file = path.resolve(evidenceDir, name);
    if (!exists(file)) {
      fail(`artifact missing or empty: ${name}`);
      continue;
    }
    if (sha256(file) !== artifacts[name]) {
      fail(`artifact changed since the manifest was written: ${name}`);
    }
  }
}

const browserReportPath = path.join(evidenceDir, 'browser', 'report.json');
if (!exists(browserReportPath)) {
  fail(`browser report missing: ${browserReportPath}`);
} else {
  const report = readJson(browserReportPath);
  if (report.ok !== true) fail('browser report ok is not true');
  if (report.task !== 'gap-session-edit-continuity-e2e' || report.goalAc !== 'AC-447') {
    fail('browser report does not name this task/AC');
  }
  const checks = Array.isArray(report.checks) ? report.checks : [];
  if (checks.length < 8) fail(`browser report has ${checks.length} checks; at least 8 are required`);
  for (const check of checks) {
    if (check.ok !== true) fail(`browser check failed: ${check.name}`);
  }
  const names = new Set(checks.map((check) => check.name));
  for (const required of [
    'fork keeps the two turns before the edit',
    'fork shows the replacement turn',
    'fork does not show the edited turn or its answer',
    'reload preserves the same six rows',
    'control: the source session shows the edited turn',
    'switch back shows the fork conversation unchanged',
    'the edit control prefills the composer with the kept turn',
  ]) {
    if (!names.has(required)) fail(`browser report is missing the check "${required}"`);
  }
  if (report.composerText !== 'kept-prompt-1') {
    fail(`browser composer reading is ${JSON.stringify(report.composerText)}`);
  }
  if (report.baseThreadId === report.forkThreadId) {
    fail('browser report uses one thread for both the fork and its source');
  }
  for (const shot of report.screenshots ?? []) {
    if (!exists(path.resolve(shot))) fail(`browser screenshot missing: ${shot}`);
  }
}

const scenarioReportPath = path.join(evidenceDir, 'scenario', 'report.json');
if (!exists(scenarioReportPath)) {
  fail(`scenario report missing: ${scenarioReportPath}`);
} else {
  const report = readJson(scenarioReportPath);
  if (report.ok !== true || report.failedStep !== null) {
    fail(`scenario did not pass (ok=${report.ok}, failedStep=${report.failedStep})`);
  }
  if (report.scenario !== 'session-edit-continuity') {
    fail(`scenario report names ${JSON.stringify(report.scenario)}`);
  }
  const steps = Array.isArray(report.steps) ? report.steps : [];
  if (steps.length !== 5 || report.stepCount !== 5) {
    fail(`scenario has ${steps.length} step results (stepCount ${report.stepCount}); 5 are required`);
  }
  for (const step of steps) {
    if (step.ok !== true) fail(`scenario step ${step.index} failed: ${JSON.stringify(step.failures)}`);
  }
  const texts = (step) => (Array.isArray(step?.reading?.chat?.messages)
    ? step.reading.chat.messages.map((message) => message.text)
    : null);
  const fork = ['kept-prompt-1', 'kept-answer-1', 'kept-prompt-2', 'kept-answer-2', 'replacement-prompt', 'replacement-answer'];
  const base = ['kept-prompt-1', 'kept-answer-1', 'kept-prompt-2', 'kept-answer-2', 'edited-prompt-3', 'edited-answer-3'];
  for (const index of [0, 1, 3]) {
    if (JSON.stringify(texts(steps[index])) !== JSON.stringify(fork)) {
      fail(`scenario step ${index + 1} fork reading is ${JSON.stringify(texts(steps[index]))}`);
    }
  }
  if (JSON.stringify(texts(steps[2])) !== JSON.stringify(base)) {
    fail(`scenario step 3 base reading is ${JSON.stringify(texts(steps[2]))}`);
  }
  if (steps[4]?.action !== 'drive:chat.edit' || steps[4]?.reading?.chat?.composerText !== 'kept-prompt-1') {
    fail(`scenario edit step read ${JSON.stringify(steps[4]?.reading?.chat?.composerText)}`);
  }
  const checkpoints = Array.isArray(report.checkpoints) ? report.checkpoints : [];
  if (checkpoints.length !== 5) {
    fail(`scenario has ${checkpoints.length} checkpoints; 5 are required`);
  }
  for (const checkpoint of checkpoints) {
    if (!exists(path.resolve(checkpoint.file))) fail(`checkpoint screenshot missing: ${checkpoint.file}`);
  }
}

if (failures.length > 0) {
  for (const message of failures) process.stderr.write(`[continuity-check] FAIL ${message}\n`);
  process.exit(1);
}

const browser = readJson(browserReportPath);
const scenario = readJson(scenarioReportPath);
process.stdout.write([
  `[continuity-check] browser checks=${browser.checks.length} screenshots=${browser.screenshots.length}`,
  `[continuity-check] scenario steps=${scenario.stepCount} checkpoints=${scenario.checkpoints.length}`,
  `[continuity-check] evidence head=${head}`,
  '[continuity-check] PASS',
  '',
].join('\n'));
NODE

say "PASS: cross-module, real-CLI, browser and scenario evidence all hold on $(git rev-parse --short HEAD)"

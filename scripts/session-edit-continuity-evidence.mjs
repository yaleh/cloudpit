#!/usr/bin/env node
/**
 * Seals one run's browser evidence into `manifest.json` for the acceptance entry.
 *
 * WHY A MANIFEST. `scripts/session-edit-continuity-check.sh` has no skip arm: it passes only
 * when the browser and scenario reports exist AND belong to the tree it is checking. The
 * report files alone cannot say which commit produced them, so this writes the commit and the
 * sha256 of every artifact beside them. The check script then refuses evidence from another
 * commit, and an edited report or a deleted screenshot is a failure rather than a stale pass.
 *
 * The layout it expects is the one the task's evidence recipe writes:
 *
 *   <evidence>/browser/report.json + the PNGs that report names
 *   <evidence>/scenario/report.json + step-*.png
 *
 * Usage: node scripts/session-edit-continuity-evidence.mjs <evidence-dir>
 *
 * The manifest is evidence, not a second source of truth: it carries no readings. Those stay
 * in the reports, which the check script validates against the scenario and the task's story.
 */

import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const evidenceDir = process.argv[2];
if (!evidenceDir) {
  process.stderr.write('usage: node scripts/session-edit-continuity-evidence.mjs <evidence-dir>\n');
  process.exit(2);
}
const root = path.resolve(evidenceDir);

/** @param {string} file */
function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** @param {string} file */
function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

/**
 * Adds one artifact under its evidence-relative name; missing files are a hard error.
 * @param {Record<string, string>} artifacts
 * @param {string} file
 */
function addArtifact(artifacts, file) {
  const relative = path.relative(root, path.resolve(file));
  if (relative.startsWith('..')) {
    throw new Error(`artifact is outside the evidence directory: ${file}`);
  }
  if (!fs.existsSync(file) || fs.statSync(file).size === 0) {
    throw new Error(`artifact is missing or empty: ${file}`);
  }
  artifacts[relative] = sha256(file);
}

const browserReportPath = path.join(root, 'browser', 'report.json');
const scenarioReportPath = path.join(root, 'scenario', 'report.json');
/** @type {Record<string, string>} */
const artifacts = {};

addArtifact(artifacts, browserReportPath);
const browser = readJson(browserReportPath);
for (const screenshot of browser.screenshots ?? []) {
  addArtifact(artifacts, screenshot);
}

addArtifact(artifacts, scenarioReportPath);
const scenario = readJson(scenarioReportPath);
for (const checkpoint of scenario.checkpoints ?? []) {
  addArtifact(artifacts, checkpoint.file);
}

const manifest = {
  task: 'gap-session-edit-continuity-e2e',
  goalAc: 'AC-447',
  gitHead: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  generatedAt: new Date().toISOString(),
  browserReport: 'browser/report.json',
  scenarioReport: 'scenario/report.json',
  artifacts,
};

fs.writeFileSync(path.join(root, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
process.stdout.write(`${JSON.stringify({ ok: true, gitHead: manifest.gitHead, artifacts: Object.keys(artifacts).length })}\n`);

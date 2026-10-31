/**
 * AC2 — the coarse classifier covers all ten ladder categories.
 *
 * Each category is driven by at least two positive phrases, written the way the
 * person actually spoke them (the probe's own examples are among them), plus a
 * block of ordinary discussion phrases that must fall through to
 * `discussion` rather than being claimed by a keyword. The readings are printed
 * per category so the table can be compared with the probe's phrase list.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LADDER_BASELINE,
  UTTERANCE_CLASSES,
  classifyUtterance,
  type UtteranceClass,
} from '@/modules/context-events/index.js';

/** At least two positives per category; the probe's examples are included verbatim. */
const POSITIVES: Readonly<Record<Exclude<UtteranceClass, 'discussion'>, readonly string[]>> = {
  'task-authoring': ['建 A、B、C 三个修复任务', '帮我立一个任务', '创建两个测试任务，然后再做'],
  'build-restart': ['Build + 安全重启。', '重新构建服务', '重启一下后端'],
  'landing-verification': ['检查是否已经落地可用', '这个功能落地了吗', '确认一下已经生效'],
  'progress-check': ['检查进展。', '现在进度如何？', '跑到哪了'],
  'browser-verification': ['用 MCP 浏览器访问……截图', '打开浏览器点一下那个按钮', 'playwright 跑一遍页面'],
  release: ['发版吧', 'npm publish 到 registry', '准备发布 1.40'],
  approval: ['好，继续', '同意，推进', '可以'],
  'session-collaboration': ['和 fleet 那个会话协作一下', '通知另一个会话', '转发给隔壁会话'],
  diagnosis: ['为什么这个测试红了', '排查一下报错', '诊断失败原因'],
};

/** Ordinary talk that mentions no act: every one must land in `discussion`. */
const DISCUSSION = [
  '今天天气不错',
  '这个图标颜色浅了一点',
  '我在想是不是该换个名字',
  '嗯，先聊聊方案',
  '这个设计我有点犹豫',
];

test('AC2: every category has at least two distinct positive phrases', () => {
  for (const [category, phrases] of Object.entries(POSITIVES)) {
    assert.ok(phrases.length >= 2, `${category} must have at least two positives`);
  }
  console.log(`AC2 categories=${UTTERANCE_CLASSES.length} positive_total=${Object.values(POSITIVES).flat().length}`);
});

for (const [category, phrases] of Object.entries(POSITIVES) as [UtteranceClass, readonly string[]][]) {
  test(`AC2: ${category} — ${phrases.length} positives classify as themselves`, () => {
    for (const phrase of phrases) {
      const reading = classifyUtterance(phrase);
      assert.equal(reading.class, category, `"${phrase}" read as ${reading.class} (rule ${reading.rule})`);
    }
    console.log(`AC2 ${category} checked=${phrases.length}`);
  });
}

test('AC2: discussion phrases fall through, and the fallback is honest about itself', () => {
  for (const phrase of DISCUSSION) {
    const reading = classifyUtterance(phrase);
    assert.equal(reading.class, 'discussion', `"${phrase}" read as ${reading.class} (rule ${reading.rule})`);
  }
  assert.equal(classifyUtterance('   ').class, 'discussion');
  console.log(`AC2 discussion checked=${DISCUSSION.length}`);
});

test('AC2: every category carries a baseline ladder level', () => {
  for (const category of UTTERANCE_CLASSES) {
    assert.ok(LADDER_BASELINE[category] === 'you-do' || LADDER_BASELINE[category] === 'system-suggests');
  }
  console.log(`AC2 ladder=${JSON.stringify(LADDER_BASELINE)}`);
});

/**
 * AC3 — `utterance.data.class` is a STABLE contract, not an implementation detail.
 *
 * quay-fleet's behaviour experiments derive polling cadence, answer-in-session rate and
 * cross-session relay rate from the `class` member this table writes onto every `utterance`
 * row. The pin is deliberately redundant: the array is compared whole (order included) AND
 * each value is asserted as a literal string, so renaming, reordering, adding or removing one
 * class reds the criterion instead of silently changing what the fleet's history means.
 */
const CONTRACT_UTTERANCE_CLASSES = [
  'task-authoring',
  'build-restart',
  'landing-verification',
  'progress-check',
  'browser-verification',
  'release',
  'approval',
  'session-collaboration',
  'diagnosis',
  'discussion',
] as const;

test('AC3: the ten utterance classes are the stable fleet contract (whole array)', () => {
  assert.deepEqual(UTTERANCE_CLASSES, CONTRACT_UTTERANCE_CLASSES);
  assert.equal(UTTERANCE_CLASSES.length, 10, 'exactly ten classes');
  console.log(`AC3 classes=${UTTERANCE_CLASSES.length} ${UTTERANCE_CLASSES.join(',')}`);
});

test('AC3: every class value is pinned as its own literal', () => {
  // One assertion per value, so a diff names the class that moved rather than only the array.
  assert.equal(UTTERANCE_CLASSES[0], 'task-authoring');
  assert.equal(UTTERANCE_CLASSES[1], 'build-restart');
  assert.equal(UTTERANCE_CLASSES[2], 'landing-verification');
  assert.equal(UTTERANCE_CLASSES[3], 'progress-check');
  assert.equal(UTTERANCE_CLASSES[4], 'browser-verification');
  assert.equal(UTTERANCE_CLASSES[5], 'release');
  assert.equal(UTTERANCE_CLASSES[6], 'approval');
  assert.equal(UTTERANCE_CLASSES[7], 'session-collaboration');
  assert.equal(UTTERANCE_CLASSES[8], 'diagnosis');
  assert.equal(UTTERANCE_CLASSES[9], 'discussion');
  for (const value of CONTRACT_UTTERANCE_CLASSES) {
    assert.equal(typeof value, 'string');
  }
});

test('AC3: the classifier still labels a real phrase with class and rule (regression)', () => {
  const reading = classifyUtterance('检查进展。');
  assert.equal(reading.class, 'progress-check');
  assert.equal(reading.rule, 'progress-question');
  assert.ok(reading.rule.length > 0, 'the rule name is non-empty');
  // Every produced label must be one of the pinned ten — the contract covers the writer too.
  for (const phrase of ['检查进展。', '建一个任务', '发布吧', '今天天气不错']) {
    const { class: label } = classifyUtterance(phrase);
    assert.ok(
      (CONTRACT_UTTERANCE_CLASSES as readonly string[]).includes(label),
      `${label} must be one of the pinned classes`,
    );
  }
});

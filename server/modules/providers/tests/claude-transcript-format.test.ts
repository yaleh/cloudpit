import assert from 'node:assert/strict';
import test from 'node:test';

import { parseLocalCommandPayload, readClaudeTranscriptMessage } from '@/modules/providers/list/claude/claude-transcript-format.js';

/**
 * The shared local-command reader is consumed by BOTH read surfaces: the
 * history projection (`claude-sessions.provider.ts`) and transcript search
 * (`session-conversations-search.service.ts`). These cases pin the two
 * readings that decide what each surface sees: content with no wrapper tag
 * must read as "not a local command" (null), and a wrapper must read as the
 * structured `{commandName, commandMessage, commandArgs}` triple. Both
 * readings are written verbatim so a drift in either surface shows up as a
 * changed literal rather than a re-interpreted assertion.
 */

const UNRELATED_CONTENT = 'a plain user turn with no local command wrapper';

const TAGGED_CONTENT = [
  '<command-name>/model</command-name>',
  '<command-message>model</command-message>',
  '<command-args>opus</command-args>',
].join('\n');

type ParserReading = ReturnType<typeof parseLocalCommandPayload>;

type ParserCase = {
  name: string;
  content: string;
  /** The reading the shared reader must produce, written out verbatim. */
  reading: string;
  /** The same reading as a value, so deep equality is asserted too. */
  expected: ParserReading;
};

const cases: ParserCase[] = [
  {
    name: 'unrelated content',
    content: UNRELATED_CONTENT,
    reading: 'null',
    expected: null,
  },
  {
    name: 'tagged local command',
    content: TAGGED_CONTENT,
    reading: '{"commandName":"/model","commandMessage":"model","commandArgs":"opus"}',
    expected: {
      commandName: '/model',
      commandMessage: 'model',
      commandArgs: 'opus',
    },
  },
];

for (const parserCase of cases) {
  test(`parseLocalCommandPayload: ${parserCase.name}`, (t) => {
    const actual = parseLocalCommandPayload(parserCase.content);
    const reading = actual === null ? 'null' : JSON.stringify(actual);

    t.diagnostic(`parseLocalCommandPayload(${parserCase.name}) -> ${reading}`);
    assert.equal(reading, parserCase.reading);
    assert.deepEqual(actual, parserCase.expected);
  });
}

/*
 * The prose reader behind `IProviderSessions.readTranscriptMessage`. It reuses the same
 * internal-prefix and local-command rules as the history/search readers, but answers the
 * narrower question "did the conversation SAY this?" — so a command wrapper (displayed in the
 * chat) and a delivered task notification (displayed as a notification line) are not prose.
 */

test('readClaudeTranscriptMessage: user and assistant prose are read with the row timestamp', () => {
  assert.deepEqual(
    readClaudeTranscriptMessage({
      type: 'user',
      timestamp: '2026-10-25T09:00:00.000Z',
      message: { role: 'user', content: 'please finish gap-claude' },
    }),
    { role: 'user', text: 'please finish gap-claude', timestamp: '2026-10-25T09:00:00.000Z' },
  );

  assert.deepEqual(
    readClaudeTranscriptMessage({
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'text', text: 'gap-claude is done' }] },
    }),
    { role: 'assistant', text: 'gap-claude is done', timestamp: null },
  );
});

test('readClaudeTranscriptMessage: only text blocks are prose; tool/thinking blocks are not', () => {
  // A text block next to a tool call is still prose; the tool call's input is not scanned.
  assert.deepEqual(
    readClaudeTranscriptMessage({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'gap-thinking' },
          { type: 'text', text: 'gap-text' },
          { type: 'tool_use', id: 't', name: 'Read', input: { path: 'gap-tool' } },
        ],
      },
    }),
    { role: 'assistant', text: 'gap-text', timestamp: null },
  );

  assert.equal(
    readClaudeTranscriptMessage({
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Read', input: { path: 'gap-tool' } }] },
    }),
    null,
  );

  assert.equal(
    readClaudeTranscriptMessage({
      type: 'user',
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', content: 'gap-tool-result' }] },
    }),
    null,
  );
});

test('readClaudeTranscriptMessage: internal injections, meta rows, commands and notifications are not prose', () => {
  const nullRows: Array<[string, unknown]> = [
    ['an isMeta skill body', { type: 'user', isMeta: true, message: { role: 'user', content: 'Base directory for this skill: gap-skill' } }],
    ['a compaction summary', { type: 'user', isCompactSummary: true, message: { role: 'user', content: 'gap-summary' } }],
    ['a system reminder', { type: 'user', message: { role: 'user', content: '<system-reminder>gap-reminder</system-reminder>' } }],
    ['a caveat', { type: 'user', message: { role: 'user', content: 'Caveat: gap-caveat' } }],
    ['a delivered task notification', { type: 'user', message: { role: 'user', content: '<task-notification>gap-notification</task-notification>' } }],
    [
      'a local command wrapper',
      {
        type: 'user',
        message: {
          role: 'user',
          content: '<command-name>/model</command-name>\n<command-message>model</command-message>\n<command-args>gap-args</command-args>',
        },
      },
    ],
    ['local command output', { type: 'user', message: { role: 'user', content: '<local-command-stdout>gap-stdout</local-command-stdout>' } }],
    ['a non-message row with content', { type: 'attachment', message: { role: 'user', content: 'gap-attachment' } }],
    ['a queue operation', { type: 'queue-operation', content: 'gap-queue' }],
  ];

  for (const [label, row] of nullRows) {
    assert.equal(readClaudeTranscriptMessage(row), null, `${label} must not read as prose`);
  }
});


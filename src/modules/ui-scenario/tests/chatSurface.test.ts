import assert from 'node:assert/strict';

import { afterEach, test } from 'vitest';

import { readChatReading, startEditingMessage } from '@/modules/ui-scenario';

/**
 * The chat reading a continuity scenario asserts, and the press it uses to start an edit.
 *
 * The fixtures below are the DOM the transcript and composer actually draw: a row carries
 * `data-message-style`, a user row's body is the `[dir="auto"]` Markdown root (the timestamp
 * and controls sit outside it), an assistant row's body is its `.prose` root, and the composer
 * is the product's own `data-slot="prompt-input-textarea"`. The reading must take the rendered
 * text — not a mirror list — which is why the assertion pins exactly what a person can see.
 */

const PANE = (rows: string) => `<div class="chat-messages-pane">${rows}</div>`;

function renderPage(html: string): void {
  document.body.innerHTML = html;
}

afterEach(() => {
  document.body.innerHTML = '';
});

test('reads the rendered turns and the composer value', () => {
  renderPage(PANE(`
    <div class="chat-message" data-message-style="user">
      <div dir="auto">  prompt-1
        wrapped   across lines </div>
      <div class="mt-1"><span>10:00</span></div>
    </div>
    <div class="chat-message" data-message-style="assistant">
      <div class="prose"><p>answer-1</p></div>
    </div>
    <div class="chat-message" data-message-style="user"><div dir="auto">prompt-2</div></div>
    <div class="chat-message" data-message-style="assistant"><div class="prose">answer-2</div></div>
  `) + '<textarea data-slot="prompt-input-textarea">draft text</textarea>');

  const reading = readChatReading();
  assert.deepEqual(reading.messages, [
    { role: 'user', text: 'prompt-1 wrapped across lines' },
    { role: 'assistant', text: 'answer-1' },
    { role: 'user', text: 'prompt-2' },
    { role: 'assistant', text: 'answer-2' },
  ]);
  assert.equal(reading.composerText, 'draft text', 'the composer value is read from the product textarea');
});

test('an empty row is not a turn, and a page without a transcript reads empty', () => {
  renderPage(PANE(`
    <div class="chat-message" data-message-style="assistant"><div class="prose">   </div></div>
  `));
  assert.deepEqual(readChatReading().messages, []);

  renderPage('<div>not a session</div>');
  assert.deepEqual(readChatReading(), { messages: [], composerText: '' });
});

test('the edit press reaches the row whose text names the turn, and only that row', () => {
  const presses: string[] = [];
  renderPage(PANE(`
    <div class="chat-message" data-message-style="assistant"><div class="prose">prompt-1 mentioned here</div></div>
    <div class="chat-message" data-message-style="user">
      <div dir="auto">prompt-1</div>
      <button type="button" id="edit-1">edit</button>
    </div>
    <div class="chat-message" data-message-style="user">
      <div dir="auto">prompt-2</div>
      <button type="button" id="edit-2">edit</button>
    </div>
  `));
  document.getElementById('edit-1')?.addEventListener('click', () => presses.push('edit-1'));
  document.getElementById('edit-2')?.addEventListener('click', () => presses.push('edit-2'));

  assert.equal(startEditingMessage('prompt-1'), true);
  assert.deepEqual(presses, ['edit-1'], 'the assistant row mentioning prompt-1 must not own the press');
  assert.equal(startEditingMessage('prompt-3'), false, 'a turn that is not drawn cannot be edited');
});

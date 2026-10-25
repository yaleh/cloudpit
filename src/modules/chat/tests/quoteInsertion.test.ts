import assert from 'node:assert/strict';

import { describe, it } from 'vitest';

import { insertQuotedText } from '@/modules/chat/utils/inputSuggestions';

/**
 * The composer's quote-insertion rules, as one pure function.
 *
 * One case per row of the proposal's table, plus the edges the rules name in
 * prose: a punctuation mark counts as text, a line holding only spaces is not an
 * empty line, and the returned caret is the end of everything that was added in
 * UTF-16 units.
 *
 * The selected passage itself (`T1` / `T2`) is inserted verbatim — no marker, no
 * forced line break — because after this fill it is ordinary draft text. The
 * paragraph break under the quotation is added only at the end of an empty line
 * *and* only when the passage itself contains a line break: a one-line passage
 * stays on the line it was inserted on.
 */

/** `T1` in the table: a one-line passage. */
const T1 = 'T';
/** `T2` in the table: a passage containing a line break. */
const T2 = '第一行\n第二行';

describe('insertQuotedText', () => {
  // --- the rule: at the end of an empty line, only a multi-line passage opens
  // --- the next paragraph

  it('(a) empty box, single-line passage: just the passage, caret after it', () => {
    const result = insertQuotedText({ input: '', selectionStart: 0, selectionEnd: 0 }, T1);
    assert.equal(result.text, 'T');
    assert.equal(result.caret, 1);
  });

  it('(b) empty box, multi-line passage: the passage plus two line breaks, caret at the end', () => {
    const result = insertQuotedText({ input: '', selectionStart: 0, selectionEnd: 0 }, T2);
    assert.equal(result.text, '第一行\n第二行\n\n', 'the passage keeps its own line break, then opens a paragraph');
    assert.equal(result.caret, T2.length + 2);
  });

  it('(c) `第一段↵|`, single-line passage: flush on the empty line, no line breaks', () => {
    const result = insertQuotedText({ input: '第一段\n', selectionStart: 4, selectionEnd: 4 }, T1);
    assert.equal(result.text, '第一段\nT');
    assert.equal(result.caret, 5);
  });

  it('(d) `第一段↵|`, multi-line passage: flush on the empty line, then the paragraph break', () => {
    const result = insertQuotedText({ input: '第一段\n', selectionStart: 4, selectionEnd: 4 }, T2);
    assert.equal(result.text, '第一段\n第一行\n第二行\n\n');
    assert.equal(result.caret, 4 + T2.length + 2);
  });

  it('(e) `我同意|` at the end of a non-empty line, multi-line passage: no line breaks', () => {
    const result = insertQuotedText({ input: '我同意', selectionStart: 3, selectionEnd: 3 }, T2);
    assert.equal(result.text, '我同意 第一行\n第二行');
    assert.equal(result.text.endsWith('\n'), false, 'a non-empty line gets no paragraph break');
    assert.equal(result.caret, 3 + 1 + T2.length);
  });

  it('(f) caret in the middle of the text, multi-line passage: no line breaks', () => {
    const result = insertQuotedText({ input: '前面后面', selectionStart: 2, selectionEnd: 2 }, T2);
    assert.equal(result.text, '前面 第一行\n第二行 后面');
    assert.equal(result.text.endsWith('\n'), false, 'a middle insertion gets no paragraph break');
    assert.equal(result.caret, 2 + 1 + T2.length + 1);
  });

  it('(g) a CRLF passage counts as multi-line', () => {
    const passage = '第一行\r\n第二行';
    const result = insertQuotedText({ input: '', selectionStart: 0, selectionEnd: 0 }, passage);
    assert.equal(result.text, '第一行\r\n第二行\n\n');
    assert.equal(result.caret, passage.length + 2);
  });

  it('(h) a passage ending in a single line break counts as multi-line', () => {
    // The selection hook trims, so this shape does not reach the composer from
    // the transcript; the function still decides by "contains a line break".
    const passage = '第一行\n';
    const result = insertQuotedText({ input: '', selectionStart: 0, selectionEnd: 0 }, passage);
    assert.equal(result.text, '第一行\n\n\n');
    assert.equal(result.caret, passage.length + 2);
  });

  // --- rules this change does not touch: padding spaces, insertion point,
  // --- punctuation as text, line breaks as non-text, UTF-16 caret arithmetic

  it('(i1) `我同意|`: a space before the passage, none after (end of the line)', () => {
    const result = insertQuotedText({ input: '我同意', selectionStart: 3, selectionEnd: 3 }, T1);
    assert.equal(result.text, '我同意 T');
    assert.equal(result.caret, 5);
  });

  it('(i2) `我同意 |`: the existing space is enough, none is added', () => {
    const result = insertQuotedText({ input: '我同意 ', selectionStart: 4, selectionEnd: 4 }, T1);
    assert.equal(result.text, '我同意 T');
    assert.equal(result.caret, 5);
  });

  it('(i3) `|后面`: a space after the passage, none before (start of the text)', () => {
    const result = insertQuotedText({ input: '后面', selectionStart: 0, selectionEnd: 0 }, T1);
    assert.equal(result.text, 'T 后面');
    assert.equal(result.caret, 2);
  });

  it('(i4) `前面|后面`: a space on each side', () => {
    const result = insertQuotedText({ input: '前面后面', selectionStart: 2, selectionEnd: 2 }, T1);
    assert.equal(result.text, '前面 T 后面');
    assert.equal(result.caret, 5);
  });

  it('(i5) `a↵|↵b`: a line break beside the caret is not text, so no space is added', () => {
    const result = insertQuotedText({ input: 'a\n\nb', selectionStart: 2, selectionEnd: 2 }, T1);
    assert.equal(result.text, 'a\nT\nb');
    assert.equal(result.caret, 3);
  });

  it('(i6) with a selection: the passage is inserted after the selection, both sides spaced', () => {
    // `abc[def]ghi` — the selection (3..6) stays in the draft, T goes after it.
    const result = insertQuotedText({ input: 'abcdefghi', selectionStart: 3, selectionEnd: 6 }, T1);
    assert.equal(result.text, 'abcdef T ghi');
    assert.equal(result.caret, 9);
  });

  it('(i7) `我同意，|`: punctuation counts as text, so a space is added', () => {
    const result = insertQuotedText({ input: '我同意，', selectionStart: 4, selectionEnd: 4 }, T1);
    assert.equal(result.text, '我同意， T');
    assert.equal(result.caret, 6);
  });

  it('(i8) `我同意|` at the end of a non-empty line: no line breaks and no trailing space', () => {
    const result = insertQuotedText({ input: '我同意', selectionStart: 3, selectionEnd: 3 }, T1);
    assert.equal(result.text.endsWith('T'), true, 'nothing follows the passage');
    assert.equal(result.text.includes('\n'), false, 'a non-empty line gets no paragraph break');
    assert.equal(result.caret, result.text.length);
  });

  it('(i9) `  |` at the end: a line of only spaces is not an empty line, so no line breaks', () => {
    const result = insertQuotedText({ input: '  ', selectionStart: 2, selectionEnd: 2 }, T1);
    assert.equal(result.text, '  T');
    assert.equal(result.text.includes('\n'), false);
    assert.equal(result.caret, 3);
  });

  it('(i10) the caret is the insertion point plus everything added, in UTF-16 units', () => {
    // The selection starts after a surrogate pair (two UTF-16 units): the caret
    // must count units, not code points, or it would land inside the emoji.
    const passage = '😀T';
    const result = insertQuotedText({ input: '😀后面', selectionStart: 2, selectionEnd: 2 }, passage);
    assert.equal(result.text, '😀 😀T 后面');
    assert.equal(result.caret, 2 + 1 + passage.length + 1);
    assert.equal(result.caret, 7);
  });
});

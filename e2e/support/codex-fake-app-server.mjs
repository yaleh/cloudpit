import fs from 'node:fs';
import readline from 'node:readline';

/**
 * A deterministic stand-in for `codex app-server` (0.153.4) over stdio.
 *
 * The resident Codex criterion cannot drive the real CLI: a real turn waits on a
 * model, a real queue drains on the model's own schedule, and a real process needs
 * credentials the isolated HOME deliberately does not have. This file speaks the
 * same JSON-RPC dialect the server's `CodexAppServerConnection` is written against,
 * so the criterion exercises the shipped driver, the shipped queue and the shipped
 * shell facet rather than a stand-in for any of them:
 *
 *   * `initialize` / `initialized` — the handshake, with `capabilities.experimentalApi`
 *     recorded verbatim so the criterion can read what the client actually declared;
 *   * `thread/start` / `thread/resume` — a thread id per conversation (resume answers
 *     the protocol's own `no rollout found` for an id this process never created);
 *   * `turn/start` — a turn that completes on its own schedule, except for a command
 *     carrying `CODEX_FAKE_HOLD_MARKER`, which is held for `CODEX_FAKE_HOLD_MS` so the
 *     criterion has a busy session to queue and withdraw against;
 *   * `turn/interrupt` — a terminal `interrupted` turn;
 *   * `thread/queue/add|list|delete|start` — a real FIFO whose depth is what
 *     `thread/queue/list` reports, which is the reading the criterion asserts on;
 *   * `thread/settings/update` — the empty result plus the confirming notification.
 *
 * Every inbound frame is appended to `CODEX_FAKE_READINGS` (a JSON file), together
 * with per-method counts, the current queue and the handshake. The spec polls that
 * one file for its readings; nothing here is inferred from the UI.
 *
 * The process prints protocol frames on stdout and diagnostics on stderr only — a
 * stray stdout line would be read as a frame by the connection.
 */

const readingsPath = process.env.CODEX_FAKE_READINGS || '';
const holdMarker = process.env.CODEX_FAKE_HOLD_MARKER || 'hold-the-turn';
const rawHoldMs = Number(process.env.CODEX_FAKE_HOLD_MS || '0');
const holdMs = Number.isFinite(rawHoldMs) && rawHoldMs > 0 ? rawHoldMs : 0;
/** A normal (unheld) turn settles quickly, but not in the same tick as its reply. */
const QUICK_TURN_MS = 40;

let threadSerial = 0;
let turnSerial = 0;
let queueSerial = 0;
/** threadId -> { id, turns } */
const threads = new Map();
/** FIFO rows: { id, clientUserMessageId, input, text }. */
const queue = [];
/** The turn in flight, if any: { id, threadId, timer, queueId? }. */
let currentTurn = null;
const methods = Object.create(null);
const calls = [];
const handshake = {
  initializeParams: null,
  initialized: false,
  experimentalDeclared: false,
};

function emit(frame) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...frame })}\n`);
}

function respond(id, result) {
  emit({ id, result });
}

function respondError(id, code, message) {
  emit({ id, error: { code, message } });
}

function notify(method, params) {
  emit({ method, params });
}

function snapshot() {
  return {
    pid: process.pid,
    argv: process.argv.slice(2),
    handshake,
    methods,
    calls,
    queueDepth: queue.length,
    queue: queue.map((row) => ({
      id: row.id,
      clientUserMessageId: row.clientUserMessageId,
      text: row.text,
    })),
    threads: [...threads.values()],
    currentTurn: currentTurn === null
      ? null
      : { id: currentTurn.id, threadId: currentTurn.threadId, queueId: currentTurn.queueId ?? null },
    turnsStarted: turnSerial,
  };
}

function writeReadings() {
  if (!readingsPath) {
    return;
  }
  try {
    fs.writeFileSync(readingsPath, `${JSON.stringify(snapshot(), null, 2)}\n`, 'utf8');
  } catch (error) {
    process.stderr.write(`codex-fake-app-server: could not write readings: ${String(error)}\n`);
  }
}

function record(method, params) {
  methods[method] = (methods[method] ?? 0) + 1;
  calls.push({ method, params });
  writeReadings();
}

function readText(input) {
  if (!Array.isArray(input)) {
    return '';
  }
  for (const part of input) {
    if (part && part.type === 'text' && typeof part.text === 'string') {
      return part.text;
    }
  }
  return '';
}

function threadFor(threadId) {
  const thread = threads.get(threadId);
  if (!thread) {
    return null;
  }
  thread.turns += 1;
  return thread;
}

/** Emits the terminal frame for the turn in flight and starts whatever it drained. */
function finishTurn(status) {
  const turn = currentTurn;
  if (!turn) {
    return;
  }
  currentTurn = null;
  clearTimeout(turn.timer);
  notify('item/completed', {
    threadId: turn.threadId,
    turnId: turn.id,
    item: {
      id: `item-${turn.id}`,
      type: 'agent_message',
      text: 'fake app-server turn',
    },
  });
  notify('turn/completed', {
    threadId: turn.threadId,
    turn: { id: turn.id, status },
  });
  // A normal completion drains the process's own queue (E2 on 0.153.4): the
  // next submission starts as a turn nobody dispatched, which the driver binds
  // from the `turn/started` frame. A withdrawal never reaches here — the row is
  // gone from the queue by then — and an interrupt is pushed explicitly by the
  // driver through `thread/queue/start` (E3), so it does not drain here.
  if (status === 'completed') {
    startNextQueuedTurn();
  }
  writeReadings();
}

function startTurn(threadId, { text, queueId = null, delayMs }) {
  turnSerial += 1;
  const turn = {
    id: `turn-${turnSerial}`,
    threadId,
    queueId,
    timer: null,
  };
  currentTurn = turn;
  notify('turn/started', { threadId, turn: { id: turn.id, status: 'inProgress' } });
  turn.timer = setTimeout(() => finishTurn('completed'), delayMs);
  turn.timer.unref?.();
  if (queueId !== null) {
    notify('thread/queue/changed', { threadId });
  }
  writeReadings();
  return turn;
}

function startNextQueuedTurn() {
  if (currentTurn !== null || queue.length === 0) {
    return;
  }
  const row = queue.shift();
  startTurn(row.threadId, { text: row.text, queueId: row.id, delayMs: QUICK_TURN_MS });
}

function handleRequest(id, method, params) {
  const p = params && typeof params === 'object' ? params : {};
  record(method, p);

  switch (method) {
    case 'initialize': {
      handshake.initializeParams = p;
      handshake.experimentalDeclared = Boolean(p.capabilities && p.capabilities.experimentalApi === true);
      respond(id, {
        userAgent: 'codex-fake/0.153.4',
        capabilities: { experimentalApi: true },
      });
      return;
    }
    case 'thread/start': {
      threadSerial += 1;
      const thread = { id: `thread-${threadSerial}`, turns: 0, cwd: p.cwd ?? null };
      threads.set(thread.id, thread);
      respond(id, { thread: { id: thread.id } });
      return;
    }
    case 'thread/resume': {
      const threadId = typeof p.threadId === 'string' ? p.threadId : '';
      const thread = threads.get(threadId);
      if (!thread) {
        respondError(id, -32000, `no rollout found for thread ${threadId}`);
        return;
      }
      respond(id, { thread: { id: thread.id } });
      return;
    }
    case 'turn/start': {
      const threadId = typeof p.threadId === 'string' ? p.threadId : '';
      if (!threadFor(threadId)) {
        respondError(id, -32000, `unknown thread ${threadId}`);
        return;
      }
      const text = readText(p.input);
      // A direct turn answers before its notifications, so the driver binds the id
      // from the reply and the `turn/started` frame that follows confirms it.
      turnSerial += 1;
      const turnId = `turn-${turnSerial}`;
      const delayMs = holdMs > 0 && text.includes(holdMarker) ? holdMs : QUICK_TURN_MS;
      currentTurn = { id: turnId, threadId, queueId: null, timer: null };
      respond(id, { turn: { id: turnId } });
      notify('turn/started', { threadId, turn: { id: turnId, status: 'inProgress' } });
      currentTurn.timer = setTimeout(() => finishTurn('completed'), delayMs);
      currentTurn.timer.unref?.();
      writeReadings();
      return;
    }
    case 'turn/interrupt': {
      const threadId = typeof p.threadId === 'string' ? p.threadId : '';
      const caused = currentTurn !== null && currentTurn.threadId === threadId;
      respond(id, {});
      if (caused) {
        finishTurn('interrupted');
      }
      return;
    }
    case 'thread/queue/add': {
      const threadId = typeof p.threadId === 'string' ? p.threadId : '';
      queueSerial += 1;
      const text = readText(p.input);
      const row = {
        id: `qsub-${queueSerial}`,
        clientUserMessageId: typeof p.clientUserMessageId === 'string' ? p.clientUserMessageId : null,
        input: p.input,
        text,
        threadId,
      };
      queue.push(row);
      respond(id, {
        queuedSubmission: { id: row.id, clientUserMessageId: row.clientUserMessageId },
      });
      notify('thread/queue/changed', { threadId });
      writeReadings();
      return;
    }
    case 'thread/queue/list': {
      respond(id, {
        data: queue.map((row) => ({
          id: row.id,
          clientUserMessageId: row.clientUserMessageId,
          input: row.input,
        })),
      });
      return;
    }
    case 'thread/queue/delete': {
      const queuedSubmissionId = typeof p.queuedSubmissionId === 'string' ? p.queuedSubmissionId : '';
      const index = queue.findIndex((row) => row.id === queuedSubmissionId);
      const deleted = index >= 0;
      if (deleted) {
        queue.splice(index, 1);
      }
      respond(id, { deleted });
      if (deleted) {
        notify('thread/queue/changed', { threadId: p.threadId });
      }
      writeReadings();
      return;
    }
    case 'thread/queue/start': {
      const queuedSubmissionId = typeof p.queuedSubmissionId === 'string' ? p.queuedSubmissionId : '';
      const index = queue.findIndex((row) => row.id === queuedSubmissionId);
      const row = index >= 0 ? queue.splice(index, 1)[0] : null;
      respond(id, {});
      if (row) {
        startTurn(row.threadId, { text: row.text, queueId: row.id, delayMs: QUICK_TURN_MS });
      }
      return;
    }
    case 'thread/settings/update': {
      respond(id, {});
      notify('thread/settings/updated', {
        threadId: p.threadId,
        settings: p,
      });
      return;
    }
    default:
      // Everything else is answered as a no-op. The driver only calls the methods
      // above; an unknown one must not hang a turn waiting on a reply.
      respond(id, {});
  }
}

function handleNotification(method, params) {
  record(method, params);
  if (method === 'initialized') {
    handshake.initialized = true;
    writeReadings();
  }
}

const reader = readline.createInterface({ input: process.stdin });
reader.on('line', (line) => {
  if (!line.trim()) {
    return;
  }
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    process.stderr.write(`codex-fake-app-server: ignored a non-JSON line: ${line.slice(0, 120)}\n`);
    return;
  }
  if (typeof message.method !== 'string') {
    return;
  }
  try {
    if (message.id !== undefined) {
      handleRequest(message.id, message.method, message.params);
    } else {
      handleNotification(message.method, message.params);
    }
  } catch (error) {
    process.stderr.write(`codex-fake-app-server: handler failed for ${message.method}: ${String(error)}\n`);
    if (message.id !== undefined) {
      respondError(message.id, -32603, String(error));
    }
  }
});

reader.on('close', () => {
  if (currentTurn) {
    clearTimeout(currentTurn.timer);
  }
  writeReadings();
  process.exit(0);
});

process.stderr.write('codex-fake-app-server: listening on stdio\n');
writeReadings();

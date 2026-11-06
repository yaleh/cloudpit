import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CodexAppServerConnection,
  type CodexAppServerTransport,
} from '@/modules/providers/list/codex/app-server/codex-app-server.connection.js';
import { CodexHostDriver } from '@/modules/providers/list/codex/host/codex-host-driver.provider.js';
import {
  normalizeResidentNotification,
  type CodexResidentNormalizeOptions,
} from '@/modules/providers/list/codex/host/codex-resident-normalize.js';
import type { IProviderHostDriverSink } from '@/shared/interfaces.js';
import type {
  HostTurnInput,
  NormalizedMessage,
  ProcessHost,
  ProviderRuntimeContext,
  ProviderRuntimeWriter,
  SessionBinding,
} from '@/shared/types.js';
import { isRecord } from '@/shared/utils.js';

/**
 * The criterion for gap-codex-resident-normalize-app-server-frames: a resident
 * Codex turn's app-server notifications are translated into the kind-carrying
 * messages `ChatSessionWriter` accepts, and no raw `{ method, params }` frame
 * reaches the run writer.
 *
 * The normalizer legs drive `normalizeResidentNotification` directly. The
 * no-bare-frame leg drives the real `CodexHostDriver.run()` over an in-memory
 * JSON-RPC app-server stub, which is what proves the shipped forwarding path
 * (not just a helper) stopped sending raw frames.
 */

const THREAD_ID = 'thread-normalize';
const TURN_ID = 'turn-normalize';
const ITEM_ID = 'item-normalize-1';

/** A normalized frame plus the dialect ids this task stamps for its readings. */
type ResidentMessage = NormalizedMessage & { threadId?: string; turnId?: string };

function asResident(message: NormalizedMessage | undefined): ResidentMessage {
  assert.ok(message, 'the normalizer produced no message');
  return message as ResidentMessage;
}

function normalize(
  method: string,
  params: Record<string, unknown>,
  options: CodexResidentNormalizeOptions = { onDropped: () => {} },
): NormalizedMessage[] {
  return normalizeResidentNotification(method, params, options);
}

type Call = { method: string; params: Record<string, unknown> };
type EmittedFrame = { jsonrpc?: string; id?: number; method?: string; params?: unknown; result?: unknown };

/**
 * In-memory `codex app-server` stub.
 *
 * Answers the three requests a first resident turn makes and, after the
 * `turn/start` reply, emits the real interleaving this task repairs: lifecycle
 * frames the driver consumes, streaming deltas, the completed item, and the
 * terminal turn.
 */
class FakeAppServerTransport implements CodexAppServerTransport {
  readonly pid = 717_171;
  readonly calls: Call[] = [];

  private messageHandler: ((frame: string) => void) | null = null;
  private exitHandler: ((reason: string) => void) | null = null;
  private alive = true;

  write(frame: string): void {
    const message = JSON.parse(frame) as { id?: number; method?: string; params?: unknown };
    if (typeof message.method !== 'string') {
      return;
    }
    const params = isRecord(message.params) ? message.params : {};
    this.calls.push({ method: message.method, params });
    switch (message.method) {
      case 'initialize':
        this.reply(message.id, { userAgent: 'fake-codex/0.153.4', codexHome: '/fake' });
        return;
      case 'initialized':
        return;
      case 'thread/start':
        this.reply(message.id, { thread: { id: THREAD_ID, status: { type: 'idle' } } });
        return;
      case 'turn/start':
        this.reply(message.id, { turn: { id: TURN_ID, status: 'inProgress' } });
        this.streamTurn();
        return;
      default:
        return;
    }
  }

  onMessage(handler: (frame: string) => void): void {
    this.messageHandler = handler;
  }

  onExit(handler: (reason: string) => void): void {
    this.exitHandler = handler;
  }

  isAlive(): boolean {
    return this.alive;
  }

  /** Idempotent, and deliberately does not report an exit (transport contract). */
  terminate(): void {
    this.alive = false;
  }

  private streamTurn(): void {
    this.emit('turn/started', { threadId: THREAD_ID, turn: { id: TURN_ID, status: 'inProgress' } });
    this.emit('item/started', { threadId: THREAD_ID, item: { id: ITEM_ID, type: 'agentMessage' } });
    this.emit('item/agentMessage/delta', {
      threadId: THREAD_ID,
      turnId: TURN_ID,
      itemId: ITEM_ID,
      delta: 'Hel',
    });
    this.emit('item/agentMessage/delta', {
      threadId: THREAD_ID,
      turnId: TURN_ID,
      itemId: ITEM_ID,
      delta: 'lo',
    });
    this.emit('item/completed', {
      threadId: THREAD_ID,
      turnId: TURN_ID,
      item: { id: ITEM_ID, type: 'agentMessage', text: 'Hello' },
    });
    this.emit('turn/completed', { threadId: THREAD_ID, turn: { id: TURN_ID, status: 'completed' } });
  }

  private reply(id: number | undefined, result: unknown): void {
    this.deliver({ jsonrpc: '2.0', id, result });
  }

  private emit(method: string, params: unknown): void {
    this.deliver({ jsonrpc: '2.0', method, params });
  }

  private deliver(frame: EmittedFrame): void {
    if (this.alive) {
      this.messageHandler?.(JSON.stringify(frame));
    }
  }
}

function createSink(): IProviderHostDriverSink {
  return {
    leaseAdded: () => {},
    leaseRemoved: () => {},
    activity: () => {},
    identity: () => {},
    exited: () => {},
  };
}

function createHost(): ProcessHost {
  return {
    hostId: 'codex-normalize-host',
    provider: 'codex',
    mode: 'resident',
    state: 'starting',
    pid: null,
    startedAt: Date.now(),
    bindings: new Map(),
    closeReason: null,
  };
}

function createBinding(appSessionId: string): SessionBinding {
  return {
    appSessionId,
    providerSessionId: null,
    state: 'idle',
    leases: [],
    lastActivityAt: Date.now(),
    peerName: null,
    detachReason: null,
  };
}

function turn(command: string): HostTurnInput {
  return { command, options: {} };
}

// ---------------------------
//----------------- AC2: delta becomes a streaming message ------------

test('AC2: an agentMessage delta becomes a kind-carrying stream frame (AC2)', () => {
  const messages = normalize('item/agentMessage/delta', {
    threadId: THREAD_ID,
    turnId: TURN_ID,
    itemId: ITEM_ID,
    delta: 'Hello',
  });
  const delta = asResident(messages[0]);
  assert.equal(messages.length, 1);
  assert.equal(delta.kind, 'stream_delta');
  assert.equal(delta.content, 'Hello');
  assert.equal(delta.threadId, THREAD_ID, 'the delta must keep the app-server thread id');
  assert.equal(delta.turnId, TURN_ID);

  const empty = normalize('item/agentMessage/delta', { threadId: THREAD_ID, delta: '' });
  assert.deepEqual(empty, [], 'an empty delta must not produce a frame');
  console.log(`deltaKind=${delta.kind} deltaThreadId=${String(delta.threadId)} emptyDeltaFrames=${empty.length}`);
});

// ---------------------------
//----------------- AC3: completed item and terminal turn ------------

test('AC3: a completed agentMessage becomes the final answer and the turn its terminal frame', () => {
  const completed = normalize('item/completed', {
    threadId: THREAD_ID,
    turnId: TURN_ID,
    item: { id: ITEM_ID, type: 'agentMessage', text: 'Hello' },
  });
  const answer = asResident(completed[0]);
  assert.equal(completed.length, 1);
  assert.equal(answer.kind, 'text');
  assert.equal(answer.role, 'assistant');
  assert.equal(answer.content, 'Hello');

  const terminal = normalize('turn/completed', {
    threadId: THREAD_ID,
    turn: { id: TURN_ID, status: 'completed' },
  });
  const done = asResident(terminal[0]);
  assert.equal(terminal.length, 1);
  assert.equal(done.kind, 'complete');
  assert.equal(done.exitCode, 0);
  assert.notEqual(done.aborted, true);

  const failed = normalize('turn/failed', {
    threadId: THREAD_ID,
    turn: { id: TURN_ID, status: 'failed', error: { message: 'boom' } },
  });
  assert.equal(failed[0]?.kind, 'error');
  assert.equal(failed[1]?.kind, 'complete');

  console.log(
    `completedKind=${answer.kind} turnTerminalKind=${done.kind} `
      + `terminalExitCode=${String(done.exitCode)} failedKinds=${failed.map((message) => message.kind).join(',')}`,
  );
});

// ---------------------------
//----------------- unmapped frames are dropped, never forwarded ------------

test('unmapped notifications are dropped and named in the log hook', () => {
  const dropped: string[] = [];
  const messages = normalize(
    'item/started',
    { threadId: THREAD_ID, item: { id: ITEM_ID, type: 'agentMessage' } },
    { onDropped: (method) => dropped.push(method) },
  );
  assert.deepEqual(messages, []);
  assert.deepEqual(dropped, ['item/started']);

  const silent = normalize(
    'turn/started',
    { threadId: THREAD_ID, turn: { id: TURN_ID, status: 'inProgress' } },
    { onDropped: (method) => dropped.push(method) },
  );
  assert.deepEqual(silent, [], 'a driver-owned lifecycle frame maps to no client frame');
  assert.deepEqual(dropped, ['item/started'], 'a frame consumed by another seam must not be reported as unmapped');
  console.log(`dropped=${dropped.join(',')} silentLifecycleFrames=${silent.length}`);
});

// ---------------------------
//----------------- AC4: run() forwards no bare frames ------------

test('AC4: a resident turn sends only kind-carrying frames to the run writer', async () => {
  const transport = new FakeAppServerTransport();
  const driver = new CodexHostDriver({
    createConnection: (launch) => new CodexAppServerConnection({
      launch,
      createTransport: () => transport,
    }),
  });
  const host = createHost();
  const sent: unknown[] = [];
  const writer = {
    send: (data: unknown) => {
      sent.push(data);
    },
  } as unknown as ProviderRuntimeWriter;
  const context = { resolveProviderSessionId: () => null } as unknown as ProviderRuntimeContext;

  try {
    await driver.startHost(host, createSink());
    await driver.bind(host, createBinding('session-normalize'));
    await driver.run('session-normalize', turn('say hello'), writer, context);

    const kindless = sent.filter((frame) => !isRecord(frame) || typeof frame.kind !== 'string').length;
    const kinds = sent.filter(isRecord).map((frame) => String(frame.kind));
    const deltas = sent
      .filter(isRecord)
      .filter((frame) => frame.kind === 'stream_delta')
      .map((frame) => String(frame.content ?? ''));
    const answers = sent
      .filter(isRecord)
      .filter((frame) => frame.kind === 'text' && frame.role === 'assistant')
      .map((frame) => String(frame.content ?? ''));
    const terminals = kinds.filter((kind) => kind === 'complete');

    assert.ok(sent.length > 0, 'the run writer received no frame at all');
    assert.equal(kindless, 0, `kindless=${kindless} — the run writer must never receive a bare {method,params} frame`);
    assert.equal(deltas.join(''), 'Hello', `streamed deltas must concatenate to the answer (got ${JSON.stringify(deltas)})`);
    assert.deepEqual(answers, ['Hello'], 'the completed agentMessage must reach the writer as the final answer');
    assert.equal(terminals.length, 1, 'the turn must end with exactly one terminal complete');
    console.log(`frames=${sent.length} kindless=${kindless} kinds=${kinds.join(',')}`);
  } finally {
    await driver.closeHost(host, 'user');
  }
});

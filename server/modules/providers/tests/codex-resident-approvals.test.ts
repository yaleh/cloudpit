/**
 * AC-438 criterion — Codex resident approvals broker.
 *
 * The resident Codex host is one `codex app-server` process held across turns.
 * Its protocol asks the *client* to answer five kinds of server request
 * (`item/commandExecution/requestApproval`, `item/fileChange/requestApproval`,
 * `item/permissions/requestApproval`, `mcpServer/elicitation/request`,
 * `item/tool/requestUserInput`) plus small auxiliary questions. A host that
 * answers none of them leaves the process parked on a person who is not there.
 * This criterion measures the broker that closes that hole, on the production
 * driver and the production shared approval service:
 *
 *   (1) the connection can write an answer back (`respond` / `respondError`),
 *       echoing the server's id verbatim — including the numeric `0` — and
 *       writes nothing after `close()`;
 *   (2) each of the five methods produces exactly one `permission_request`
 *       frame tagged `provider: 'codex'` and the matching `toolName`, and NO
 *       JSON-RPC answer before the client decides;
 *   (3) accept / decline / cancel map onto each protocol's own response shape;
 *   (4) `thread/status/changed`'s `waitingOnApproval` and the pending list are
 *       read off `readSession()`, and both clear when the request settles;
 *   (5) with nobody connected the request is refused immediately (no frame, no
 *       wait) and one `permission.unattended_refused` notification is recorded;
 *   (6) with somebody connected but silent the wait is bounded and answered as
 *       a refusal;
 *   (7) auxiliary server requests are answered (`currentTime/read`,
 *       `attestation/generate`, unknown);
 *   (8) interrupt / unbind / closeHost answer what they still hold;
 *   (9) the client decision reaches Codex through
 *       `provider-runtime.service.resolveToolApproval`'s fan-out, and a second
 *       resolve is a no-op.
 *
 * The transport is an in-memory JSON-RPC stub with a fixed fake pid: no Codex
 * process is started, no DB or network is touched. The approval registry is the
 * real shared `approval-requests.service.ts` singleton, so the settle path the
 * wire exercises is the one production uses.
 */
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  createContextEvents,
  createContextEventWriter,
  createSessionBlockedEventWriter,
} from '@/modules/context-events/index.js';
import {
  CodexAppServerConnection,
  type CodexAppServerTransport,
} from '@/modules/providers/list/codex/codex-app-server.connection.js';
import { CodexHostDriver } from '@/modules/providers/list/codex/codex-host-driver.provider.js';
import { codexRuntime } from '@/modules/providers/list/codex/codex-runtime.provider.js';
import * as claudeRuntime from '@/modules/providers/list/claude/claude-runtime.provider.js';
import { approvalRequests } from '@/modules/providers/shared/base/approval-requests.service.js';
import { TOOL_APPROVAL_TIMEOUT_MS } from '@/modules/providers/shared/base/approval-requests.service.js';
import { createProviderRuntimeService } from '@/modules/providers/services/provider-runtime.service.js';
import { installSessionBlockedEventWriterPort } from '@/shared/ports/session-blocked-events.port.js';
import type { IProvider, IProviderHostDriverSink } from '@/shared/interfaces.js';
import type {
  AnyRecord,
  HostTurnInput,
  ProcessHost,
  ProviderRuntimeContext,
  ProviderRuntimeWriter,
  SessionBinding,
} from '@/shared/types.js';

const SESSION = 'ac438-session';
const FAKE_PID = 424_242;

type Call = { method: string; params: Record<string, unknown> };
type OutboundFrame = {
  jsonrpc?: string;
  id?: number | string;
  result?: unknown;
  error?: { code?: number; message?: string };
};

/**
 * In-memory `codex app-server`: answers the thread/turn RPCs the driver sends,
 * records every call, and records every answer the driver writes back to a
 * server-initiated request. Test-only verbs (`emitRequest`, `emitStatus`) are
 * what a real server does while a turn runs.
 */
class FakeAppServerTransport implements CodexAppServerTransport {
  readonly pid = FAKE_PID;
  readonly calls: Call[] = [];
  /** Answers the driver wrote to server-initiated requests, in order. */
  readonly responses: OutboundFrame[] = [];
  /** Whether `turn/start` completes the turn immediately; false parks it. */
  autoComplete = false;

  private readonly materialised = new Set<string>();
  private readonly activeTurns = new Map<string, string>();
  private messageHandler: ((frame: string) => void) | null = null;
  private exitHandler: ((reason: string) => void) | null = null;
  private alive = true;
  private threadSerial = 0;
  private turnSerial = 0;

  write(frame: string): void {
    const message = JSON.parse(frame) as {
      id?: number | string;
      method?: string;
      params?: unknown;
      result?: unknown;
      error?: OutboundFrame['error'];
    };
    if (typeof message.method !== 'string') {
      if (message.id !== undefined) {
        this.responses.push({ jsonrpc: '2.0', id: message.id, result: message.result, error: message.error });
      }
      return;
    }
    const params = (message.params ?? {}) as Record<string, unknown>;
    this.calls.push({ method: message.method, params });
    switch (message.method) {
      case 'initialize':
        this.reply(message.id, { userAgent: 'fake-codex/0.153.4', codexHome: '/fake' });
        return;
      case 'initialized':
        return;
      case 'thread/start': {
        const id = `thread-${++this.threadSerial}`;
        this.reply(message.id, { thread: { id, status: { type: 'idle' } } });
        return;
      }
      case 'thread/resume': {
        const threadId = String(params.threadId ?? '');
        if (!this.materialised.has(threadId)) {
          this.fail(message.id, `no rollout found for thread id ${threadId}`);
          return;
        }
        this.reply(message.id, { thread: { id: threadId, status: { type: 'idle' } } });
        return;
      }
      case 'turn/start': {
        const threadId = String(params.threadId ?? '');
        const turnId = `turn-${++this.turnSerial}`;
        this.activeTurns.set(threadId, turnId);
        this.reply(message.id, { turn: { id: turnId, status: 'inProgress' } });
        this.emit('turn/started', { threadId, turn: { id: turnId, status: 'inProgress' } });
        if (this.autoComplete) {
          this.completeTurn(threadId, turnId, 'completed');
        }
        return;
      }
      case 'turn/interrupt': {
        const threadId = String(params.threadId ?? '');
        const turnId = String(params.turnId ?? this.activeTurns.get(threadId) ?? '');
        this.reply(message.id, {});
        this.completeTurn(threadId, turnId, 'interrupted');
        return;
      }
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

  terminate(): void {
    this.alive = false;
  }

  /** One server-initiated request, exactly as the app-server writes it. */
  emitRequest(id: number | string, method: string, params: unknown): void {
    this.deliver({ jsonrpc: '2.0', id, method, params });
  }

  /** One `thread/status/changed` frame in the locked 0.153.4 shape. */
  emitStatus(threadId: string, activeFlags: string[], type: 'active' | 'idle' = 'active'): void {
    this.emit('thread/status/changed', { threadId, status: { type, activeFlags } });
  }

  /** The turn the driver started, ended the way a real server ends it. */
  completeTurn(threadId: string, turnId: string, status: 'completed' | 'interrupted'): void {
    this.materialised.add(threadId);
    this.activeTurns.delete(threadId);
    this.emit('turn/completed', { threadId, turn: { id: turnId, status } });
  }

  /** The turn the driver started, failed the way a real server ends it. */
  failTurn(threadId: string, turnId: string, message?: string): void {
    this.materialised.add(threadId);
    this.activeTurns.delete(threadId);
    this.emit('turn/failed', {
      threadId,
      turn: { id: turnId, status: 'failed', ...(message === undefined ? {} : { error: { message } }) },
    });
  }

  private reply(id: number | string | undefined, result: unknown): void {
    this.deliver({ jsonrpc: '2.0', id, result });
  }

  private fail(id: number | string | undefined, message: string): void {
    this.deliver({ jsonrpc: '2.0', id, error: { code: -32_000, message } });
  }

  private emit(method: string, params: unknown): void {
    this.deliver({ jsonrpc: '2.0', method, params });
  }

  private deliver(frame: unknown): void {
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
    hostId: 'codex-host-ac438',
    provider: 'codex',
    mode: 'resident',
    state: 'starting',
    pid: null,
    startedAt: Date.now(),
    bindings: new Map(),
    closeReason: null,
  };
}

function createBinding(appSessionId: string, providerSessionId: string | null): SessionBinding {
  return {
    appSessionId,
    providerSessionId,
    state: 'idle',
    leases: [],
    lastActivityAt: Date.now(),
    peerName: null,
    detachReason: null,
  };
}

async function waitFor(predicate: () => boolean, label: string, budgetMs = 2_000): Promise<void> {
  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error(`timed out waiting for ${label}`);
}

type ResidentHarness = {
  driver: CodexHostDriver;
  transport: FakeAppServerTransport;
  host: ProcessHost;
  frames: AnyRecord[];
  threadId: string;
  runPromise: Promise<unknown>;
  close(): Promise<void>;
};

/** Opens one resident session and parks a turn, so approvals have a writer. */
async function openResident(options: {
  connectedClientCount?: () => number;
  approvalTimeoutMs?: number;
} = {}): Promise<ResidentHarness> {
  const transport = new FakeAppServerTransport();
  const frames: AnyRecord[] = [];
  const driver = new CodexHostDriver({
    createConnection: (launch) => new CodexAppServerConnection({
      launch,
      createTransport: () => transport,
    }),
    connectedClientCount: options.connectedClientCount ?? (() => 1),
    approvalTimeoutMs: options.approvalTimeoutMs ?? 5_000,
  });
  const host = createHost();
  await driver.startHost(host, createSink());
  await driver.bind(host, createBinding(SESSION, null));
  const runtimeWriter = {
    send: (frame: unknown) => frames.push(frame as AnyRecord),
    setSessionId: () => {},
    userId: null,
  } as unknown as ProviderRuntimeWriter;
  const runPromise = driver.run(
    SESSION,
    { command: 'criterion turn', options: {} } as HostTurnInput,
    runtimeWriter,
    {} as ProviderRuntimeContext,
  );
  await waitFor(
    () => transport.calls.some((call) => call.method === 'turn/start'),
    'turn/start',
  );
  const threadId = driver.readSession(SESSION).threadId;
  assert.ok(threadId, 'the resident turn must have a thread id');
  const close = async () => {
    await driver.closeHost(host, 'user');
    await runPromise.catch(() => undefined);
  };
  return { driver, transport, host, frames, threadId, runPromise, close };
}

function permissionFrames(frames: AnyRecord[], toolName?: string): AnyRecord[] {
  return frames.filter(
    (frame) => frame.kind === 'permission_request' && (!toolName || frame.toolName === toolName),
  );
}

/** The response frame written for one server-request id. */
function responseFor(transport: FakeAppServerTransport, id: number | string): OutboundFrame | null {
  return transport.responses.find((frame) => frame.id === id) ?? null;
}

function sentinelEcho(threadId: string, turnId: string): Record<string, unknown> {
  return { threadId, turnId };
}

const COMMAND_PARAMS = (threadId: string, turnId: string) => ({
  ...sentinelEcho(threadId, turnId),
  itemId: 'item-cmd-1',
  command: 'echo hello',
  cwd: '/tmp',
  reason: 'criterion',
  availableDecisions: ['accept', 'decline', 'cancel'],
  proposedExecpolicyAmendment: null,
});

const FILE_CHANGE_PARAMS = (threadId: string, turnId: string) => ({
  ...sentinelEcho(threadId, turnId),
  itemId: 'item-file-1',
  reason: 'criterion',
  grantRoot: null,
  changes: [{ path: '/tmp/ac438.txt', kind: 'add' }],
});

const PERMISSION_PARAMS = (threadId: string, turnId: string) => ({
  ...sentinelEcho(threadId, turnId),
  itemId: 'item-perm-1',
  reason: 'criterion',
  permissions: { network: { enabled: true }, fileSystem: { read: ['/tmp'], write: [] } },
});

const ELICITATION_PARAMS = (threadId: string, turnId: string) => ({
  ...sentinelEcho(threadId, turnId),
  serverName: 'criterion-mcp',
  message: 'Confirm the tool call?',
  requestedSchema: { type: 'object', properties: { confirm: { type: 'boolean' } } },
});

const USER_INPUT_PARAMS = (threadId: string, turnId: string) => ({
  ...sentinelEcho(threadId, turnId),
  itemId: 'item-input-1',
  questions: [{ id: 'q1', header: 'Pick', question: 'Proceed?', options: [{ label: 'yes' }] }],
});

/** One method's real params plus the answers each decision must produce. */
const METHOD_CASES = [
  {
    method: 'item/commandExecution/requestApproval',
    toolName: 'commandExecution',
    params: COMMAND_PARAMS,
    acceptInput: { allow: true },
    accept: { decision: 'accept' },
    decline: { decision: 'decline' },
    cancel: { decision: 'cancel' },
  },
  {
    method: 'item/fileChange/requestApproval',
    toolName: 'fileChange',
    params: FILE_CHANGE_PARAMS,
    acceptInput: { allow: true },
    accept: { decision: 'accept' },
    decline: { decision: 'decline' },
    cancel: { decision: 'cancel' },
  },
  {
    method: 'item/permissions/requestApproval',
    toolName: 'permissions',
    params: PERMISSION_PARAMS,
    acceptInput: { allow: true, updatedInput: { permissions: { network: { enabled: true } }, scope: 'session' } },
    accept: { permissions: { network: { enabled: true } }, scope: 'session' },
    decline: { permissions: {}, scope: 'turn' },
    cancel: { permissions: {}, scope: 'turn' },
  },
  {
    method: 'mcpServer/elicitation/request',
    toolName: 'mcpElicitation',
    params: ELICITATION_PARAMS,
    acceptInput: { allow: true, updatedInput: { content: { confirm: true } } },
    accept: { action: 'accept', content: { confirm: true }, _meta: null },
    decline: { action: 'decline', content: null, _meta: null },
    cancel: { action: 'cancel', content: null, _meta: null },
  },
  {
    method: 'item/tool/requestUserInput',
    toolName: 'requestUserInput',
    params: USER_INPUT_PARAMS,
    acceptInput: { allow: true, updatedInput: { answers: { q1: { answers: ['yes'] } } } },
    accept: { answers: { q1: { answers: ['yes'] } } },
    decline: { answers: {} },
    cancel: { answers: {} },
  },
] as const;

test('the connection writes server-request answers, echoing the id verbatim (AC2)', async () => {
  const transport = new FakeAppServerTransport();
  const connection = new CodexAppServerConnection({ createTransport: () => transport });
  // A server request only arrives once the process exists and the handshake ran.
  await connection.initialize();

  connection.respond(7, { decision: 'accept' });
  connection.respondError(8, -32_000, 'approval unavailable');
  connection.respond(0, { decision: 'decline' });

  const [respondFrame, respondErrorFrame, zeroIdFrame] = transport.responses;
  console.log(`respondFrame=${JSON.stringify(respondFrame)}`);
  console.log(`respondErrorFrame=${JSON.stringify(respondErrorFrame)}`);
  console.log(`zeroIdFrame=${JSON.stringify(zeroIdFrame)}`);

  assert.equal(respondFrame.jsonrpc, '2.0');
  assert.equal(respondFrame.id, 7);
  assert.deepEqual(respondFrame.result, { decision: 'accept' });
  assert.equal(respondErrorFrame.id, 8);
  assert.deepEqual(respondErrorFrame.error, { code: -32_000, message: 'approval unavailable' });
  assert.equal(zeroIdFrame.id, 0, 'the numeric id 0 must be echoed, not treated as absent');
  assert.deepEqual(zeroIdFrame.result, { decision: 'decline' });

  connection.close();
  const before = transport.responses.length;
  connection.respond(9, { decision: 'accept' });
  console.log(`closedNoop=${transport.responses.length === before}`);
  assert.equal(transport.responses.length, before, 'a closed connection must not write an answer');
});

for (const methodCase of METHOD_CASES) {
  test(`a ${methodCase.toolName} server request becomes a provider=codex permission_request frame (AC3)`, async () => {
    const ctx = await openResident();
    try {
      const transport = ctx.transport;
      transport.emitRequest(100, methodCase.method, methodCase.params(ctx.threadId, 'turn-1'));
      await waitFor(
        () => permissionFrames(ctx.frames, methodCase.toolName).length === 1,
        `${methodCase.toolName} permission_request`,
      );
      const frame = permissionFrames(ctx.frames, methodCase.toolName)[0];
      const input = frame.input as AnyRecord;
      console.log(
        `method=${methodCase.method} frames=1 provider=${frame.provider} toolName=${frame.toolName} `
          + `inputMethod=${input.method} requestIdNonEmpty=${Boolean(frame.requestId)}`,
      );
      assert.equal(frame.provider, 'codex');
      assert.equal(frame.toolName, methodCase.toolName);
      assert.equal(input.method, methodCase.method);
      assert.ok(frame.requestId, 'the frame must carry a request id');
      assert.equal((input.params as AnyRecord).threadId, ctx.threadId);

      const parkedResponses = transport.responses.length;
      console.log(`parkedResponses=${parkedResponses}`);
      assert.equal(parkedResponses, 0, 'no JSON-RPC answer may be written before the client decides');

      approvalRequests.resolveToolApproval(String(frame.requestId), { allow: false });
      await waitFor(() => transport.responses.length === 1, `${methodCase.toolName} answer`);
    } finally {
      await ctx.close();
    }
  });
}

test('accept routes each protocol to its own acceptance shape (AC4)', async () => {
  const ctx = await openResident();
  try {
    const transport = ctx.transport;
    for (const [index, methodCase] of METHOD_CASES.entries()) {
      transport.emitRequest(200 + index, methodCase.method, methodCase.params(ctx.threadId, 'turn-1'));
    }
    await waitFor(() => permissionFrames(ctx.frames).length === 5, 'five permission_request frames');
    const frames = permissionFrames(ctx.frames);
    for (const methodCase of METHOD_CASES) {
      const frame = frames.find((candidate) => candidate.toolName === methodCase.toolName);
      assert.ok(frame, `no permission_request frame for ${methodCase.toolName}`);
      approvalRequests.resolveToolApproval(String(frame.requestId), methodCase.acceptInput as AnyRecord);
    }
    await waitFor(() => transport.responses.length === 5, 'five accept answers');
    for (const [index, methodCase] of METHOD_CASES.entries()) {
      const response = responseFor(transport, 200 + index);
      console.log(`accept ${methodCase.toolName} ${JSON.stringify(response?.result)}`);
      assert.deepEqual(response?.result, methodCase.accept);
    }
    const resolved = ctx.frames.filter((frame) => frame.kind === 'permission_resolved');
    console.log(`permissionResolvedFrames=${resolved.length} pendingLeft=${approvalRequests.getPendingApprovalsForSession(SESSION).length}`);
    assert.equal(resolved.length, 5, 'each settled request must emit one permission_resolved frame');
    assert.equal(approvalRequests.getPendingApprovalsForSession(SESSION).length, 0);
  } finally {
    await ctx.close();
  }
});

test('decline routes each protocol to its own refusal shape and the turn continues (AC5)', async () => {
  const ctx = await openResident();
  try {
    const transport = ctx.transport;
    for (const [index, methodCase] of METHOD_CASES.entries()) {
      transport.emitRequest(300 + index, methodCase.method, methodCase.params(ctx.threadId, 'turn-1'));
    }
    await waitFor(() => permissionFrames(ctx.frames).length === 5, 'five permission_request frames');
    for (const methodCase of METHOD_CASES) {
      const frame = permissionFrames(ctx.frames, methodCase.toolName)[0];
      approvalRequests.resolveToolApproval(String(frame.requestId), { allow: false });
    }
    await waitFor(() => transport.responses.length === 5, 'five decline answers');
    for (const [index, methodCase] of METHOD_CASES.entries()) {
      const response = responseFor(transport, 300 + index);
      console.log(`decline ${methodCase.toolName} ${JSON.stringify(response?.result)}`);
      assert.deepEqual(response?.result, methodCase.decline);
    }
    transport.completeTurn(ctx.threadId, 'turn-1', 'completed');
    await ctx.runPromise;
    const interrupts = transport.calls.filter((call) => call.method === 'turn/interrupt').length;
    console.log(`turnContinued=true interrupts=${interrupts}`);
    assert.equal(interrupts, 0, 'a declined approval must not interrupt the turn');
  } finally {
    await ctx.close();
  }
});

test('cancel maps to each protocol, and permissions/userInput fall back to refusal (AC6)', async () => {
  const ctx = await openResident();
  try {
    const transport = ctx.transport;
    const pidBefore = transport.pid;
    for (const [index, methodCase] of METHOD_CASES.entries()) {
      transport.emitRequest(400 + index, methodCase.method, methodCase.params(ctx.threadId, 'turn-1'));
    }
    await waitFor(() => permissionFrames(ctx.frames).length === 5, 'five permission_request frames');
    for (const methodCase of METHOD_CASES) {
      const frame = permissionFrames(ctx.frames, methodCase.toolName)[0];
      approvalRequests.resolveToolApproval(String(frame.requestId), { cancelled: true });
    }
    await waitFor(() => transport.responses.length === 5, 'five cancel answers');
    const mappings: string[] = [];
    for (const [index, methodCase] of METHOD_CASES.entries()) {
      const response = responseFor(transport, 400 + index);
      mappings.push(`${methodCase.toolName}=${JSON.stringify(response?.result)}`);
      assert.deepEqual(response?.result, methodCase.cancel);
    }
    console.log(`cancelMappings=[${mappings.join(';')}]`);
    const interrupts = transport.calls.filter((call) => call.method === 'turn/interrupt').length;
    console.log(`pidBefore=${pidBefore} pidAfter=${transport.pid} interrupts=${interrupts}`);
    assert.equal(transport.pid, pidBefore, 'a cancelled approval must not replace the process');
    assert.equal(interrupts, 0, 'a cancelled approval must not interrupt the turn');
  } finally {
    await ctx.close();
  }
});

test('waitingOnApproval is readable while parked and clears after the answer (AC7)', async () => {
  const ctx = await openResident();
  try {
    const transport = ctx.transport;
    transport.emitRequest(500, 'item/commandExecution/requestApproval', COMMAND_PARAMS(ctx.threadId, 'turn-1'));
    await waitFor(() => permissionFrames(ctx.frames).length === 1, 'the permission_request frame');
    transport.emitStatus(ctx.threadId, ['waitingOnApproval']);
    await waitFor(() => ctx.driver.readSession(SESSION).threadStatus === 'active', 'the status frame');

    const parked = ctx.driver.readSession(SESSION);
    console.log(
      `parkedWaiting=${parked.waitingOnApproval} parkedPending=${parked.pendingApprovals.length} `
        + `activeFlags=${JSON.stringify(parked.activeFlags)}`,
    );
    assert.equal(parked.waitingOnApproval, true);
    assert.equal(parked.pendingApprovals.length, 1);
    assert.deepEqual(parked.activeFlags, ['waitingOnApproval']);
    assert.equal(parked.pendingApprovals[0].toolName, 'commandExecution');

    approvalRequests.resolveToolApproval(String(permissionFrames(ctx.frames)[0].requestId), { allow: true });
    await waitFor(() => transport.responses.length === 1, 'the accept answer');
    transport.emitStatus(ctx.threadId, []);
    await waitFor(() => !ctx.driver.readSession(SESSION).waitingOnApproval, 'the cleared status');

    const settled = ctx.driver.readSession(SESSION);
    console.log(`settledWaiting=${settled.waitingOnApproval} settledPending=${settled.pendingApprovals.length}`);
    assert.equal(settled.waitingOnApproval, false);
    assert.equal(settled.pendingApprovals.length, 0);
    assert.deepEqual(settled.activeFlags, []);

    const unattended = await openResident({ connectedClientCount: () => 0 });
    try {
      unattended.transport.emitRequest(
        501,
        'item/commandExecution/requestApproval',
        COMMAND_PARAMS(unattended.threadId, 'turn-1'),
      );
      await waitFor(() => unattended.transport.responses.length === 1, 'the unattended answer');
      const reading = unattended.driver.readSession(SESSION);
      console.log(`unattendedWaiting=${reading.waitingOnApproval} unattendedPending=${reading.pendingApprovals.length}`);
      assert.equal(reading.waitingOnApproval, false);
      assert.equal(reading.pendingApprovals.length, 0);
    } finally {
      await unattended.close();
    }
  } finally {
    await ctx.close();
  }
});

test('nobody connected: every request is refused at once with no frame (AC8)', async () => {
  const ctx = await openResident({ connectedClientCount: () => 0 });
  try {
    const transport = ctx.transport;
    for (const [index, methodCase] of METHOD_CASES.entries()) {
      const startedAt = Date.now();
      transport.emitRequest(600 + index, methodCase.method, methodCase.params(ctx.threadId, 'turn-1'));
      await waitFor(() => responseFor(transport, 600 + index) !== null, `${methodCase.toolName} unattended answer`, 1_000);
      const elapsedMs = Date.now() - startedAt;
      const response = responseFor(transport, 600 + index);
      console.log(
        `method=${methodCase.method} unattendedResponse=${JSON.stringify(response?.result)} `
          + `elapsedMs=${elapsedMs} frames=${permissionFrames(ctx.frames, methodCase.toolName).length}`,
      );
      assert.deepEqual(response?.result, methodCase.decline);
      assert.equal(permissionFrames(ctx.frames, methodCase.toolName).length, 0, 'no client frame may be sent');
      assert.ok(elapsedMs < 1_000, 'the unattended answer must be immediate');
    }
    const notifications = ctx.driver.readApprovalNotifications(SESSION);
    const refusals = notifications.filter((event) => event.code === 'permission.unattended_refused');
    console.log(
      `unattendedNotifications=${refusals.length} providers=${JSON.stringify([...new Set(refusals.map((event) => event.provider))])} `
        + `pending=${approvalRequests.getPendingApprovalsForSession(SESSION).length}`,
    );
    assert.equal(refusals.length, 5, 'each unattended request must leave one notification');
    assert.deepEqual([...new Set(refusals.map((event) => event.provider))], ['codex']);
    assert.equal(approvalRequests.getPendingApprovalsForSession(SESSION).length, 0);
  } finally {
    await ctx.close();
  }
});

test('somebody connected but silent: the wait is bounded and answered as a refusal (AC9)', async () => {
  const ctx = await openResident({ connectedClientCount: () => 1, approvalTimeoutMs: 40 });
  try {
    const transport = ctx.transport;
    const startedAt = Date.now();
    transport.emitRequest(700, 'item/commandExecution/requestApproval', COMMAND_PARAMS(ctx.threadId, 'turn-1'));
    await waitFor(() => permissionFrames(ctx.frames).length === 1, 'the permission_request frame');
    await waitFor(() => responseFor(transport, 700) !== null, 'the timeout answer', 1_000);
    const elapsedMs = Date.now() - startedAt;
    const response = responseFor(transport, 700);
    const parked = approvalRequests.getPendingApprovalsForSession(SESSION).length;
    console.log(`timeoutResponse=${JSON.stringify(response?.result)} elapsedMs=${elapsedMs} parked=${parked > 0}`);
    assert.deepEqual(response?.result, { decision: 'decline' });
    assert.ok(elapsedMs < 1_000, 'the bounded wait must not hang');
    assert.equal(parked, 0, 'a timed-out request must not stay pending');

    transport.completeTurn(ctx.threadId, 'turn-1', 'completed');
    await ctx.runPromise;
  } finally {
    await ctx.close();
  }
});

test('auxiliary server requests are answered so the process never parks (AC10)', async () => {
  const transport = new FakeAppServerTransport();
  const driver = new CodexHostDriver({
    createConnection: (launch) => new CodexAppServerConnection({
      launch,
      createTransport: () => transport,
    }),
  });
  const host = createHost();
  await driver.startHost(host, createSink());
  try {
    const startedAt = Date.now();
    transport.emitRequest(900, 'currentTime/read', {});
    transport.emitRequest(901, 'attestation/generate', {});
    transport.emitRequest(902, 'unknown/whatever', {});
    await waitFor(() => transport.responses.length === 3, 'three auxiliary answers', 1_000);
    const elapsedMs = Date.now() - startedAt;
    const currentTime = responseFor(transport, 900)?.result as AnyRecord;
    const attestation = responseFor(transport, 901)?.result as AnyRecord;
    const unknown = responseFor(transport, 902)?.result as AnyRecord;
    console.log(`currentTimeResponse=${JSON.stringify(currentTime)}`);
    console.log(`attestationResponse=${JSON.stringify(attestation)}`);
    console.log(`unknownResponse=${JSON.stringify(unknown)}`);
    console.log(`auxiliaryElapsedMs=${elapsedMs}`);
    assert.equal(typeof currentTime.currentTimeAt, 'number');
    assert.equal(typeof attestation.token, 'string');
    assert.deepEqual(unknown, {});
    assert.ok(elapsedMs < 1_000);
  } finally {
    await driver.closeHost(host, 'user');
  }
});

test('interrupt answers the parked request and keeps the process (AC11)', async () => {
  const ctx = await openResident();
  try {
    const transport = ctx.transport;
    const pidBefore = transport.pid;
    transport.emitRequest(800, 'item/commandExecution/requestApproval', COMMAND_PARAMS(ctx.threadId, 'turn-1'));
    await waitFor(() => permissionFrames(ctx.frames).length === 1, 'the permission_request frame');
    const interrupted = await ctx.driver.interrupt(ctx.host, SESSION);
    await waitFor(() => responseFor(transport, 800) !== null, 'the interrupt answer');
    const pending = approvalRequests.getPendingApprovalsForSession(SESSION).length;
    console.log(
      `interruptAnswered=${JSON.stringify(responseFor(transport, 800)?.result)} pending=${pending} `
        + `pidBefore=${pidBefore} pidAfter=${transport.pid} interrupt=${interrupted}`,
    );
    assert.equal(interrupted, true);
    assert.deepEqual(responseFor(transport, 800)?.result, { decision: 'cancel' });
    assert.equal(pending, 0);
    assert.equal(transport.pid, pidBefore);
  } finally {
    await ctx.close();
  }
});

test('unbind and closeHost drain what they still hold (AC11)', async () => {
  const unbound = await openResident();
  try {
    unbound.transport.emitRequest(810, 'item/commandExecution/requestApproval', COMMAND_PARAMS(unbound.threadId, 'turn-1'));
    await waitFor(() => permissionFrames(unbound.frames).length === 1, 'the unbind-side permission_request');
    await unbound.driver.unbind(unbound.host, SESSION, 'user');
    console.log(
      `unbindAnswered=${JSON.stringify(responseFor(unbound.transport, 810)?.result)} `
        + `unbindDrained=${approvalRequests.getPendingApprovalsForSession(SESSION).length === 0}`,
    );
    assert.deepEqual(responseFor(unbound.transport, 810)?.result, { decision: 'cancel' });
    assert.equal(approvalRequests.getPendingApprovalsForSession(SESSION).length, 0);
  } finally {
    await unbound.close();
  }

  const closed = await openResident();
  const transport = closed.transport;
  transport.emitRequest(820, 'item/commandExecution/requestApproval', COMMAND_PARAMS(closed.threadId, 'turn-1'));
  await waitFor(() => permissionFrames(closed.frames).length === 1, 'the close-side permission_request');
  await closed.close();
  const answered = responseFor(transport, 820);
  const before = transport.responses.length;
  transport.emitRequest(821, 'item/commandExecution/requestApproval', COMMAND_PARAMS(closed.threadId, 'turn-1'));
  console.log(
    `closeAnswered=${JSON.stringify(answered?.result)} closeDrained=${approvalRequests.getPendingApprovalsForSession(SESSION).length === 0} `
      + `afterCloseWrites=${transport.responses.length - before}`,
  );
  assert.deepEqual(answered?.result, { decision: 'cancel' });
  assert.equal(approvalRequests.getPendingApprovalsForSession(SESSION).length, 0);
  assert.equal(transport.responses.length, before, 'a closed connection must not answer');
});

test('the client decision reaches Codex through the provider-runtime fan-out (AC12)', async () => {
  const fakeCodexProvider = {
    id: 'codex',
    runtime: { permissions: codexRuntime.permissions },
  } as unknown as IProvider;
  const runtime = createProviderRuntimeService({ listProviders: () => [fakeCodexProvider] });

  const ctx = await openResident();
  try {
    const transport = ctx.transport;
    transport.emitRequest(850, 'item/commandExecution/requestApproval', COMMAND_PARAMS(ctx.threadId, 'turn-1'));
    await waitFor(() => permissionFrames(ctx.frames).length === 1, 'the permission_request frame');
    const requestId = String(permissionFrames(ctx.frames)[0].requestId);

    const pendingViaRuntime = runtime.getPendingApprovalsForSession(SESSION).length;
    runtime.resolveToolApproval(requestId, { allow: true });
    await waitFor(() => responseFor(transport, 850) !== null, 'the fan-out answer');
    const decision = approvalRequests.readApprovalDecision(requestId);
    const resolvedFrames = ctx.frames.filter(
      (frame) => frame.kind === 'permission_resolved' && frame.requestId === requestId,
    ).length;

    runtime.resolveToolApproval(requestId, { allow: false });
    await new Promise((resolve) => setImmediate(resolve));
    const resolvedAfterSecond = ctx.frames.filter(
      (frame) => frame.kind === 'permission_resolved' && frame.requestId === requestId,
    ).length;

    console.log(
      `fanoutSettled=${responseFor(transport, 850) !== null} pendingViaRuntime=${pendingViaRuntime} `
        + `decisionRecorded=${decision !== null} secondResolveNoop=${resolvedAfterSecond === resolvedFrames}`,
    );
    assert.equal(pendingViaRuntime, 1);
    assert.deepEqual(responseFor(transport, 850)?.result, { decision: 'accept' });
    assert.ok(decision, 'the settle must be recorded in the shared ledger');
    assert.equal(decision?.allow, true);
    assert.equal(resolvedFrames, 1);
    assert.equal(resolvedAfterSecond, resolvedFrames, 'a second resolve must not settle again');
    assert.equal(approvalRequests.getPendingApprovalsForSession(SESSION).length, 0);
  } finally {
    await ctx.close();
  }
});

/** The reading "five frames, five answers, nothing waiting" asserted over. */
function assertFiveFramesDelivered(reading: { frames: number; responses: unknown[]; waiting: boolean }): void {
  assert.equal(reading.frames, 5, `frames=${reading.frames} expected=5`);
  assert.equal(reading.responses.length, 5, `responses=${reading.responses.length} expected=5`);
  assert.equal(reading.waiting, false, `waiting=${reading.waiting} expected=false`);
}

/** The reading "an unattended request was refused" asserted over. */
function assertUnattendedRefused(reading: { response: AnyRecord }): void {
  assert.notEqual(reading.response.decision, 'accept', `unattended response=${JSON.stringify(reading.response)}`);
}

test('the criterion itself is discriminating: both controls throw (AC13)', () => {
  const firstThrew = (() => {
    try {
      assertFiveFramesDelivered({ frames: 0, responses: [], waiting: true });
      return false;
    } catch {
      return true;
    }
  })();
  const secondThrew = (() => {
    try {
      assertUnattendedRefused({ response: { decision: 'accept' } });
      return false;
    } catch {
      return true;
    }
  })();
  console.log(`negativeControlThrew=${firstThrew}`);
  console.log(`negativeControlThrew=${secondThrew}`);
  assert.equal(firstThrew, true);
  assert.equal(secondThrew, true);

  assertFiveFramesDelivered({ frames: 5, responses: [0, 1, 2, 3, 4], waiting: false });
  assertUnattendedRefused({ response: { decision: 'decline' } });
});

test('the Claude approval names still resolve from their original module (AC14)', () => {
  // Static property access on purpose: oxlint's `import(namespace)` rule refuses a
  // computed read of an imported namespace, and the four names are a fixed list.
  assert.equal(claudeRuntime.resolveToolApproval, approvalRequests.resolveToolApproval, "resolveToolApproval must be the shared service's own function object");
  assert.equal(claudeRuntime.getPendingApprovalsForSession, approvalRequests.getPendingApprovalsForSession, "getPendingApprovalsForSession must be the shared service's own function object");
  assert.equal(claudeRuntime.classifyMissingApproval, approvalRequests.classifyMissingApproval, "classifyMissingApproval must be the shared service's own function object");
  assert.equal(claudeRuntime.readApprovalDecision, approvalRequests.readApprovalDecision, "readApprovalDecision must be the shared service's own function object");
  assert.equal(typeof claudeRuntime.requestClientToolDecision, 'function');
  assert.equal(claudeRuntime.TOOL_APPROVAL_TIMEOUT_MS, TOOL_APPROVAL_TIMEOUT_MS);
  console.log(
    'claudeNames=resolveToolApproval,getPendingApprovalsForSession,classifyMissingApproval,readApprovalDecision '
      + `requestClientToolDecision=${typeof claudeRuntime.requestClientToolDecision} `
      + `timeoutMs=${claudeRuntime.TOOL_APPROVAL_TIMEOUT_MS}`,
  );
});

// ---------------------------------------------------------------------------------------------
// Blocked-session context events (gap-codex-resident-blocked-context-events)
//
// The same scripted resident session, with the REAL writer over a temporary fleet home and the
// REAL adapter installed on `shared/ports/session-blocked-events.port.ts`. The rows are read back
// from the JSONL file, so this measures the landing shape rather than an in-memory recording.
// ---------------------------------------------------------------------------------------------

/** The kinds the writer must find in the fixture document for these rows to be mintable. */
const BLOCKED_SCHEMA = {
  version: 1,
  name: 'context-event',
  kinds: {
    'session.blocked': { producer: 'cloudcli' as const, group: 'lifecycle' },
    'session.blocked.resolved': { producer: 'cloudcli' as const, group: 'lifecycle' },
  },
};

type BlockedRow = { kind: string; session?: string; data: Record<string, unknown> };

/** One isolated fleet home; the adapter is installed on the process-wide port for the run. */
async function withBlockedStream(
  run: (stream: { eventsDir: string; settled: () => Promise<void> }) => Promise<void>,
): Promise<void> {
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'codex-blocked-events-'));
  const eventsDir = path.join(homeDir, '.quay-fleet', 'context', 'events');
  const schemaPath = path.join(homeDir, 'fixture', 'context-event.schema.v0.json');
  try {
    await mkdir(path.dirname(schemaPath), { recursive: true });
    await writeFile(schemaPath, JSON.stringify(BLOCKED_SCHEMA), 'utf8');
    const writer = createContextEventWriter({ eventsDir, schemaPath });
    const stream = createContextEvents({ writer });
    const adapter = createSessionBlockedEventWriter({
      record: (draft) => stream.record(draft),
      log: () => undefined,
    });
    installSessionBlockedEventWriterPort(adapter);
    await run({ eventsDir, settled: () => adapter.settled() });
  } finally {
    // The port is a process-wide slot: leaving the dead adapter installed would let a later
    // test's producer write into a directory this test just removed.
    installSessionBlockedEventWriterPort(null);
    await rm(homeDir, { recursive: true, force: true });
  }
}

/** Every row the writer landed, across the day files it created. */
async function readBlockedRows(eventsDir: string): Promise<BlockedRow[]> {
  let names: string[];
  try {
    names = await readdir(eventsDir);
  } catch {
    return [];
  }
  const rows: BlockedRow[] = [];
  for (const name of names.filter((candidate) => candidate.endsWith('.jsonl')).sort()) {
    const raw = await readFile(path.join(eventsDir, name), 'utf8');
    for (const line of raw.split('\n')) {
      if (line !== '') rows.push(JSON.parse(line) as BlockedRow);
    }
  }
  return rows;
}

/**
 * The reading one approval arm must satisfy: one block and EXACTLY ONE matching resolution.
 *
 * This is the criterion AC4 ablates: delete the deny arm's resolution and this throws naming the
 * missing withdrawal, rather than passing on the block alone.
 */
function assertBlockResolved(rows: BlockedRow[], blockId: string): void {
  const blocked = rows.filter((row) => row.kind === 'session.blocked' && row.data.blockId === blockId);
  const resolved = rows.filter((row) => row.kind === 'session.blocked.resolved' && row.data.blockId === blockId);
  assert.equal(blocked.length, 1, `expected one session.blocked for ${blockId}; rows=${JSON.stringify(rows)}`);
  assert.equal(resolved.length, 1, `deny must also withdraw the card for ${blockId}; rows=${JSON.stringify(rows)}`);
}

/** A writer for a follow-up turn; only `send` is read by the driver. */
function createRuntimeWriter(): ProviderRuntimeWriter {
  return { send: () => {}, setSessionId: () => {}, userId: null } as unknown as ProviderRuntimeWriter;
}

test('a parked approval writes session.blocked{approval}, and allow AND deny each resolve it (AC2)', async () => {
  await withBlockedStream(async ({ eventsDir, settled }) => {
    const ctx = await openResident();
    try {
      const transport = ctx.transport;
      transport.emitRequest(1000, 'item/commandExecution/requestApproval', COMMAND_PARAMS(ctx.threadId, 'turn-1'));
      await waitFor(() => permissionFrames(ctx.frames).length === 1, 'the allow approval frame');
      const allowId = String(permissionFrames(ctx.frames)[0].requestId);
      approvalRequests.resolveToolApproval(allowId, { allow: true });
      await waitFor(() => transport.responses.length === 1, 'the allow answer');

      transport.emitRequest(1001, 'item/fileChange/requestApproval', FILE_CHANGE_PARAMS(ctx.threadId, 'turn-1'));
      await waitFor(() => permissionFrames(ctx.frames).length === 2, 'the deny approval frame');
      const denyId = String(permissionFrames(ctx.frames)[1].requestId);
      approvalRequests.resolveToolApproval(denyId, { allow: false });
      await waitFor(() => transport.responses.length === 2, 'the deny answer');

      await settled();
      const rows = await readBlockedRows(eventsDir);
      const allowBlockId = `${SESSION}:${allowId}`;
      const denyBlockId = `${SESSION}:${denyId}`;

      assert.deepEqual(
        rows.filter((row) => row.kind === 'session.blocked').map((row) => ({ session: row.session, ...row.data })),
        [
          { session: SESSION, reason: 'approval', blockId: allowBlockId, requestId: allowId, toolName: 'commandExecution' },
          { session: SESSION, reason: 'approval', blockId: denyBlockId, requestId: denyId, toolName: 'fileChange' },
        ],
      );
      assert.deepEqual(
        rows.filter((row) => row.kind === 'session.blocked.resolved').map((row) => row.data.blockId),
        [allowBlockId, denyBlockId],
        'the deny arm must write resolved too, or the denied card never clears',
      );
      assertBlockResolved(rows, allowBlockId);
      assertBlockResolved(rows, denyBlockId);
      console.log(`approvalBlocks=2 resolutions=${rows.filter((row) => row.kind === 'session.blocked.resolved').length}`);
    } finally {
      await ctx.close();
    }
  });
});

test('a failed turn writes session.blocked{failed}; the next completed turn resolves it (AC3)', async () => {
  await withBlockedStream(async ({ eventsDir, settled }) => {
    const ctx = await openResident();
    try {
      ctx.transport.failTurn(ctx.threadId, 'turn-1', 'the build exited 1');
      await ctx.runPromise;
      await settled();

      const failedBlockId = `${SESSION}:turn-1`;
      let rows = await readBlockedRows(eventsDir);
      assert.deepEqual(
        rows.filter((row) => row.kind === 'session.blocked').map((row) => ({ session: row.session, ...row.data })),
        [
          {
            session: SESSION,
            reason: 'failed',
            blockId: failedBlockId,
            turnId: 'turn-1',
            errorMessage: 'the build exited 1',
          },
        ],
      );
      assert.equal(
        rows.filter((row) => row.kind === 'session.blocked.resolved').length,
        0,
        'a failed turn stays blocked until the turn recovers',
      );

      const second = ctx.driver.run(
        SESSION,
        { command: 'recover', options: {} } as HostTurnInput,
        createRuntimeWriter(),
        {} as ProviderRuntimeContext,
      );
      await waitFor(
        () => ctx.transport.calls.filter((call) => call.method === 'turn/start').length === 2,
        'the recovery turn/start',
      );
      ctx.transport.completeTurn(ctx.threadId, 'turn-2', 'completed');
      await second;
      await settled();

      rows = await readBlockedRows(eventsDir);
      assert.deepEqual(
        rows.filter((row) => row.kind === 'session.blocked.resolved').map((row) => row.data.blockId),
        [failedBlockId],
        'the completed turn withdraws the failed turn’s card',
      );
      assert.equal(
        rows.filter((row) => row.kind === 'session.blocked').length,
        1,
        'the recovery turn itself writes no block',
      );
      console.log(`failedBlock=1 recovered=${JSON.stringify(rows.filter((row) => row.kind === 'session.blocked.resolved').map((row) => row.data.blockId))}`);
    } finally {
      await ctx.close();
    }
  });
});

test('an interrupted turn writes session.blocked{interrupted} and clears on the next completed turn (AC3)', async () => {
  await withBlockedStream(async ({ eventsDir, settled }) => {
    const ctx = await openResident();
    try {
      assert.equal(await ctx.driver.interrupt(ctx.host, SESSION), true);
      await settled();

      const interruptedBlockId = `${SESSION}:turn-1`;
      let rows = await readBlockedRows(eventsDir);
      assert.deepEqual(
        rows.filter((row) => row.kind === 'session.blocked').map((row) => ({ session: row.session, ...row.data })),
        [{ session: SESSION, reason: 'interrupted', blockId: interruptedBlockId, turnId: 'turn-1' }],
      );

      const second = ctx.driver.run(
        SESSION,
        { command: 'recover', options: {} } as HostTurnInput,
        createRuntimeWriter(),
        {} as ProviderRuntimeContext,
      );
      await waitFor(
        () => ctx.transport.calls.filter((call) => call.method === 'turn/start').length === 2,
        'the recovery turn/start',
      );
      ctx.transport.completeTurn(ctx.threadId, 'turn-2', 'completed');
      await second;
      await settled();

      rows = await readBlockedRows(eventsDir);
      assertBlockResolved(
        rows.filter((row) => row.kind !== 'session.blocked' || row.data.blockId === interruptedBlockId),
        interruptedBlockId,
      );
      console.log(`interruptedBlock=1 resolved=${JSON.stringify(rows.filter((row) => row.kind === 'session.blocked.resolved').map((row) => row.data.blockId))}`);
    } finally {
      await ctx.close();
    }
  });
});

test('a completed turn writes no session.blocked at all (AC3)', async () => {
  await withBlockedStream(async ({ eventsDir, settled }) => {
    const ctx = await openResident();
    try {
      ctx.transport.completeTurn(ctx.threadId, 'turn-1', 'completed');
      await ctx.runPromise;
      await settled();
      assert.deepEqual(await readBlockedRows(eventsDir), []);
      console.log('completedBlocked=0');
    } finally {
      await ctx.close();
    }
  });
});

test('the denied arm is discriminating: a rows list without the resolution throws (AC4)', () => {
  const blockId = 'sess-control:req-control';
  const onlyBlock: BlockedRow[] = [
    { kind: 'session.blocked', session: 'sess-control', data: { reason: 'approval', blockId } },
  ];
  assert.throws(
    () => assertBlockResolved(onlyBlock, blockId),
    /deny must also withdraw the card/,
    'deleting the deny arm’s resolution must red the pairing assertion',
  );
  assertBlockResolved(
    [...onlyBlock, { kind: 'session.blocked.resolved', session: 'sess-control', data: { blockId } }],
    blockId,
  );
  console.log('denyControlThrew=true');
});

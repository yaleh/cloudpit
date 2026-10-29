import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import readline from 'node:readline';

import { AppError } from '@/shared/utils.js';

/**
 * A long-lived JSON-RPC connection to one `codex app-server` process.
 *
 * This is the transport half of Codex's resident mode: the same stdio protocol
 * `codex-app-server.client.ts` speaks for a single fork, but held open across
 * turns so thread identity, pid and in-flight turns survive from one turn to the
 * next. `CodexHostDriver` is the only consumer; the criterion in
 * `tests/codex-host-driver-persistent.test.ts` drives it through an injected
 * in-memory transport, so no process is started there.
 *
 * The process/transport factory is injectable for that reason. Everything the
 * connection needs from the outside is the small {@link CodexAppServerTransport}
 * surface, not a `ChildProcess`.
 */

/** How long one request may wait for its reply before failing. */
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

/**
 * The byte-level transport one connection owns.
 *
 * `terminate` is the connection's own shutdown, so it MUST NOT invoke the exit
 * handler: an exit reported after our own close would make the driver announce
 * a process death it caused, and the manager would record `exited` for a host it
 * closed on purpose. A process that goes away on its own is what `onExit`
 * reports.
 */
export type CodexAppServerTransport = {
  /** The child's process id, or null when the transport is not a real process. */
  readonly pid: number | null;
  /** Writes one JSON-RPC frame (no trailing newline). */
  write(frame: string): void;
  /** Registers the handler for one complete inbound frame. */
  onMessage(handler: (frame: string) => void): void;
  /** Registers the handler that runs once if the process goes away on its own. */
  onExit(handler: (reason: string) => void): void;
  /** Whether the process is still there. */
  isAlive(): boolean;
  /** Ends the process and releases its pipes. Idempotent; never reports an exit. */
  terminate(): void;
};

/**
 * The launch facts the default transport needs.
 *
 * The criterion injects a factory and leaves these unused; the default spawn
 * reads them so a production driver can state the working directory and
 * environment of its process.
 */
export type CodexAppServerLaunch = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
};

export type CodexAppServerConnectionOptions = {
  /** Starts the transport for one process; defaults to spawning the pinned CLI. */
  createTransport?: (launch: CodexAppServerLaunch) => CodexAppServerTransport;
  /** Handed to the transport factory. */
  launch?: CodexAppServerLaunch;
  /** Per-request ceiling; defaults to {@link DEFAULT_REQUEST_TIMEOUT_MS}. */
  requestTimeoutMs?: number;
};

type JsonRpcError = { code?: number; message?: string };
type InboundFrame = {
  id?: number | string;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: JsonRpcError;
};

type PendingRequest = {
  resolve: (result: unknown) => void;
  reject: (failure: Error) => void;
  timer: ReturnType<typeof setTimeout> | null;
};

type NotificationHandler = (method: string, params: unknown) => void;
type ServerRequestHandler = (id: number | string, method: string, params: unknown) => void;
type ExitHandler = (reason: string) => void;

/**
 * Long-lived JSON-RPC connection: request/response correlation, notification and
 * server-request dispatch, pid, and one idempotent close.
 *
 * Pending requests fail with a readable `AppError` when the process exits or
 * closes, so a caller never waits on a socket that cannot answer.
 */
export class CodexAppServerConnection {
  private readonly createTransport: (launch: CodexAppServerLaunch) => CodexAppServerTransport;
  private readonly launch: CodexAppServerLaunch;
  private readonly requestTimeoutMs: number;
  private readonly notificationHandlers = new Set<NotificationHandler>();
  private readonly serverRequestHandlers = new Set<ServerRequestHandler>();
  private readonly exitHandlers = new Set<ExitHandler>();
  private readonly pending = new Map<number, PendingRequest>();
  private transport: CodexAppServerTransport | null = null;
  private nextRequestId = 1;
  private initialized = false;
  private closed = false;
  private exitReason: string | null = null;

  constructor(options: CodexAppServerConnectionOptions = {}) {
    this.createTransport = options.createTransport ?? spawnCodexAppServerTransport;
    this.launch = options.launch ?? {};
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  }

  /** The process id this connection answers to, or null before it starts. */
  get pid(): number | null {
    return this.transport?.pid ?? null;
  }

  /** Whether the underlying process is still there. */
  isAlive(): boolean {
    return this.transport !== null && this.exitReason === null && !this.closed && this.transport.isAlive();
  }

  /** Whether `initialize`/`initialized` completed. */
  get isInitialized(): boolean {
    return this.initialized;
  }

  /** Starts the process (once) and performs the protocol handshake. */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }
    this.ensureTransport();
    // `capabilities` is deliberately empty: this task's surface — thread
    // start/resume and turn start/interrupt — is in the stable protocol. Queue
    // and per-turn settings need `experimentalApi` and belong to AC-436/437.
    await this.request('initialize', {
      clientInfo: { name: 'cloudcli', title: 'CloudCLI', version: '1' },
      capabilities: {},
    });
    this.notify('initialized', {});
    this.initialized = true;
  }

  /** Sends one request and resolves with its result. */
  request(method: string, params: unknown, timeoutMs: number = this.requestTimeoutMs): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (this.closed) {
        reject(this.unavailable('was closed'));
        return;
      }
      if (this.exitReason) {
        reject(this.unavailable(this.exitReason));
        return;
      }
      const transport = this.ensureTransport();
      if (!transport.isAlive()) {
        reject(this.unavailable('is not alive'));
        return;
      }
      const id = this.nextRequestId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new AppError(`Codex app-server did not answer "${method}" within ${timeoutMs}ms.`, {
          code: 'CODEX_APP_SERVER_TIMEOUT',
          statusCode: 504,
        }));
      }, timeoutMs);
      // A criterion that leaves a request deliberately unanswered must not keep
      // the test process alive for the timeout window.
      timer.unref?.();
      this.pending.set(id, { resolve, reject, timer });
      transport.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
    });
  }

  /** Sends one notification (no reply expected). */
  notify(method: string, params: unknown): void {
    if (this.closed || this.exitReason) {
      return;
    }
    this.transport?.write(JSON.stringify({ jsonrpc: '2.0', method, params }));
  }

  /** Subscribes to server notifications; returns the unsubscribe function. */
  onNotification(handler: NotificationHandler): () => void {
    this.notificationHandlers.add(handler);
    return () => this.notificationHandlers.delete(handler);
  }

  /** Subscribes to server-initiated requests (approvals and the like). */
  onServerRequest(handler: ServerRequestHandler): () => void {
    this.serverRequestHandlers.add(handler);
    return () => this.serverRequestHandlers.delete(handler);
  }

  /** Subscribes to the process going away on its own; returns the unsubscribe function. */
  onExit(handler: ExitHandler): () => void {
    this.exitHandlers.add(handler);
    return () => this.exitHandlers.delete(handler);
  }

  /** Ends the process and fails anything still waiting. Idempotent. */
  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.failPending(this.unavailable('was closed'));
    this.transport?.terminate();
  }

  private ensureTransport(): CodexAppServerTransport {
    if (this.transport) {
      return this.transport;
    }
    const transport = this.createTransport(this.launch);
    this.transport = transport;
    transport.onMessage((frame) => this.handleFrame(frame));
    transport.onExit((reason) => {
      if (this.closed) {
        return;
      }
      this.exitReason = reason;
      this.failPending(this.unavailable(reason));
      for (const handler of [...this.exitHandlers]) {
        handler(reason);
      }
    });
    return transport;
  }

  private handleFrame(frame: string): void {
    let message: InboundFrame;
    try {
      message = JSON.parse(frame) as InboundFrame;
    } catch {
      // Banner lines and diagnostics are not protocol frames.
      return;
    }
    if (typeof message.method === 'string') {
      // A frame carrying a method is server-initiated. With an id it is a
      // request the server expects an answer to; without one, a notification.
      if (message.id !== undefined) {
        for (const handler of [...this.serverRequestHandlers]) {
          handler(message.id, message.method, message.params);
        }
        return;
      }
      for (const handler of [...this.notificationHandlers]) {
        handler(message.method, message.params);
      }
      return;
    }
    if (typeof message.id === 'number') {
      const pending = this.pending.get(message.id);
      if (!pending) {
        return;
      }
      this.pending.delete(message.id);
      if (pending.timer) {
        clearTimeout(pending.timer);
      }
      if (message.error) {
        pending.reject(new AppError(message.error.message || 'Codex app-server rejected the request.', {
          code: 'CODEX_APP_SERVER_ERROR',
          statusCode: 502,
          details: { rpcCode: message.error.code },
        }));
        return;
      }
      pending.resolve(message.result);
    }
  }

  private failPending(failure: Error): void {
    for (const pending of this.pending.values()) {
      if (pending.timer) {
        clearTimeout(pending.timer);
      }
      pending.reject(failure);
    }
    this.pending.clear();
  }

  private unavailable(detail: string): AppError {
    return new AppError(`Codex app-server is not running: ${detail}`, {
      code: 'CODEX_APP_SERVER_UNAVAILABLE',
      statusCode: 502,
    });
  }
}

/**
 * Default transport: spawns the `codex app-server` shipped in node_modules.
 *
 * Deliberately not the `codex` on PATH — the protocol is only guaranteed
 * against the version this package depends on. The launcher resolution is a
 * local copy of the fork client's, kept here because this task's Touches do not
 * include that file; the two should share it when the resident driver is wired
 * into the provider (AC-441).
 */
function spawnCodexAppServerTransport(launch: CodexAppServerLaunch): CodexAppServerTransport {
  const require_ = createRequire(import.meta.url);
  let launcher: string;
  try {
    launcher = require_.resolve('@openai/codex/bin/codex.js');
  } catch {
    throw new AppError('The Codex CLI package is not installed, so a resident Codex host cannot start.', {
      code: 'CODEX_APP_SERVER_UNAVAILABLE',
      statusCode: 501,
    });
  }

  const child = spawn(process.execPath, [launcher, 'app-server'], {
    cwd: launch.cwd,
    env: launch.env ?? process.env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let messageHandler: (frame: string) => void = () => {};
  let exitHandler: (reason: string) => void = () => {};
  let stderr = '';
  let dead = false;

  const reportExit = (reason: string): void => {
    if (dead) {
      return;
    }
    dead = true;
    exitHandler(reason);
  };

  child.stderr?.on('data', (chunk) => {
    stderr = (stderr + String(chunk)).slice(-2000);
  });
  const reader = readline.createInterface({ input: child.stdout });
  reader.on('line', (line) => {
    if (line.trim()) {
      messageHandler(line);
    }
  });
  child.on('error', (error) => reportExit(error.message));
  child.on('exit', (code, signal) => {
    const tail = stderr.trim().split('\n').slice(-1)[0];
    reportExit(`exited (code ${code ?? 'null'}, signal ${signal ?? 'null'})${tail ? ` — ${tail}` : ''}`);
  });
  child.stdin?.on('error', (error) => reportExit(error.message));
  child.stdout?.on('error', (error) => reportExit(error.message));
  child.stderr?.on('error', () => {});

  return {
    pid: child.pid ?? null,
    write(frame) {
      if (!dead) {
        child.stdin?.write(`${frame}\n`);
      }
    },
    onMessage(handler) {
      messageHandler = handler;
    },
    onExit(handler) {
      exitHandler = handler;
    },
    isAlive() {
      return !dead && child.exitCode === null && child.signalCode === null;
    },
    terminate() {
      if (dead) {
        return;
      }
      dead = true;
      reader.close();
      child.kill();
    },
  };
}

import type { HostReconfigurePatch } from '@/shared/types.js';
import { isRecord } from '@/shared/utils.js';

/**
 * The live-settings half of Codex resident mode: `thread/settings/update` for an
 * idle or active turn, and the `step_model_switching` capability probe that
 * decides whether `turn/settings/update` may be used at all.
 *
 * Kept as a closure next to `codex-background-lease-ledger.ts` rather than grown
 * inside `codex-host-driver.provider.ts`, which is already the largest file of
 * the resident primitive: the driver keeps the process/thread state and only
 * delegates the setting verbs here.
 *
 * The locked `@openai/codex 0.153.4` answers `thread/settings/update` with `{}`,
 * so the RPC result proves nothing; only the matching `thread/settings/updated`
 * notification does. A waiter is therefore registered before the request is
 * written and resolved only by a frame naming the same thread whose
 * `threadSettings` equal every requested field.
 */

/** What the app-server can change without a new turn, per the capability probe. */
export type CodexSettingsCapabilities = {
  threadSettings: boolean;
  turnSettings: boolean;
};

/** The fields `turn/settings/update` accepts; only ever sent when the probe allows it. */
export type CodexTurnSettingsPatch = { model?: string; effort?: string };

/** The connection surface these verbs need; the driver owns the connection. */
export type CodexLiveSettingsConnection = {
  request(method: string, params: unknown, timeoutMs?: number): Promise<unknown>;
  isAlive(): boolean;
};

export type CodexLiveSettingsOptions = {
  /** How long one `thread/settings/update` waits for its confirmation notification. */
  notificationTimeoutMs: number;
  /** Ceiling for the one-shot `experimentalFeature/list` probe. */
  capabilityProbeTimeoutMs: number;
};

export type CodexLiveSettings = {
  reconfigure(
    connection: CodexLiveSettingsConnection,
    threadId: string,
    patch: HostReconfigurePatch,
  ): Promise<'live' | 'next-turn'>;
  capabilities(connection: CodexLiveSettingsConnection): Promise<CodexSettingsCapabilities>;
  reconfigureTurn(
    connection: CodexLiveSettingsConnection,
    threadId: string,
    turnId: string,
    patch: CodexTurnSettingsPatch,
  ): Promise<'live' | 'next-turn'>;
  /** Called for every inbound `thread/settings/updated` notification. */
  handleNotification(params: unknown): void;
  /** Settles every waiter as `next-turn`; a closed connection cannot confirm. */
  settleAll(): void;
};

type SettingsWaiter = {
  threadId: string;
  expected: Record<string, unknown>;
  timer: ReturnType<typeof setTimeout> | null;
  settle: (outcome: 'live' | 'next-turn') => void;
};

/**
 * Maps a permission mode to the app-server's live settings shape.
 *
 * The mapping table is the per-run runtime's, but `thread/settings/update` takes
 * an object `sandboxPolicy` rather than a `sandboxMode` string. The
 * `dangerFullAccess` shape is the honest mapping; E4 did not exercise it.
 */
function permissionModeSettings(permissionMode: string): {
  approvalPolicy: string;
  sandboxPolicy: Record<string, unknown>;
} {
  if (permissionMode === 'bypassPermissions') {
    return { approvalPolicy: 'never', sandboxPolicy: { type: 'dangerFullAccess' } };
  }
  return {
    approvalPolicy: permissionMode === 'acceptEdits' ? 'never' : 'on-request',
    sandboxPolicy: { type: 'workspaceWrite', networkAccess: false, writableRoots: [] },
  };
}

/** `thread/settings/update` params: the thread, plus only the fields the patch names. */
function liveSettingsParams(threadId: string, patch: HostReconfigurePatch): Record<string, unknown> {
  const params: Record<string, unknown> = { threadId };
  if (patch.model !== undefined) {
    params.model = patch.model;
  }
  if (patch.effort !== undefined) {
    params.effort = patch.effort;
  }
  if (patch.permissionMode !== undefined) {
    const mapped = permissionModeSettings(patch.permissionMode);
    params.approvalPolicy = mapped.approvalPolicy;
    params.sandboxPolicy = mapped.sandboxPolicy;
  }
  return params;
}

/**
 * Whether a `thread/settings/updated` payload confirms the request.
 *
 * Every field the request named must be equal in `threadSettings`; a missing
 * field is not a match, and an unrequested field is not required.
 */
function settingsMatch(expected: Record<string, unknown>, updated: unknown): boolean {
  if (!isRecord(updated)) {
    return false;
  }
  if ('model' in expected && updated.model !== expected.model) {
    return false;
  }
  if ('effort' in expected && updated.effort !== expected.effort) {
    return false;
  }
  if ('approvalPolicy' in expected && updated.approvalPolicy !== expected.approvalPolicy) {
    return false;
  }
  const sandbox = expected.sandboxPolicy;
  if (isRecord(sandbox)) {
    if (!isRecord(updated.sandboxPolicy) || updated.sandboxPolicy.type !== sandbox.type) {
      return false;
    }
    if ('networkAccess' in sandbox && updated.sandboxPolicy.networkAccess !== sandbox.networkAccess) {
      return false;
    }
  }
  return true;
}

/**
 * Fail-closed read of one `experimentalFeature/list` result: only a `data` array
 * holding `{name:'step_model_switching', enabled:true}` is true. A non-object
 * result, a non-array `data`, a missing entry and the string `'true'` are false.
 */
function readStepModelSwitching(result: unknown): boolean {
  if (!isRecord(result) || !Array.isArray(result.data)) {
    return false;
  }
  return result.data.some((entry) => isRecord(entry)
    && entry.name === 'step_model_switching'
    && entry.enabled === true);
}

/** Creates the live-settings verbs for one resident host. */
export function createCodexLiveSettings(options: CodexLiveSettingsOptions): CodexLiveSettings {
  const waiters = new Set<SettingsWaiter>();
  /** One probe per connection object; a replacement connection is probed again. */
  const probes = new WeakMap<CodexLiveSettingsConnection, Promise<boolean>>();

  /**
   * Registers the waiter before the request is written, so a notification that
   * arrives with the reply cannot be missed. The timeout is bounded and unref'd
   * so a criterion that never emits the frame does not hold the process open.
   */
  function waitForSettings(
    threadId: string,
    expected: Record<string, unknown>,
  ): { promise: Promise<'live' | 'next-turn'>; cancel: () => void } {
    let settlePromise!: (outcome: 'live' | 'next-turn') => void;
    const promise = new Promise<'live' | 'next-turn'>((resolve) => {
      settlePromise = resolve;
    });
    const waiter: SettingsWaiter = {
      threadId,
      expected,
      timer: null,
      settle: (outcome) => {
        if (waiter.timer) {
          clearTimeout(waiter.timer);
          waiter.timer = null;
        }
        waiters.delete(waiter);
        settlePromise(outcome);
      },
    };
    waiter.timer = setTimeout(() => waiter.settle('next-turn'), options.notificationTimeoutMs);
    waiter.timer.unref?.();
    waiters.add(waiter);
    return { promise, cancel: () => waiter.settle('next-turn') };
  }

  /** The one `experimentalFeature/list` reading this connection will ever make. */
  function probeTurnSettings(connection: CodexLiveSettingsConnection): Promise<boolean> {
    let probe = probes.get(connection);
    if (!probe) {
      probe = connection
        .request('experimentalFeature/list', {}, options.capabilityProbeTimeoutMs)
        .then(readStepModelSwitching, () => false);
      probes.set(connection, probe);
    }
    return probe;
  }

  return {
    async reconfigure(connection, threadId, patch) {
      const params = liveSettingsParams(threadId, patch);
      const waiter = waitForSettings(threadId, params);
      try {
        await connection.request('thread/settings/update', params);
      } catch {
        waiter.cancel();
        return 'next-turn';
      }
      return waiter.promise;
    },

    async capabilities(connection) {
      if (!connection.isAlive()) {
        return { threadSettings: false, turnSettings: false };
      }
      return { threadSettings: true, turnSettings: await probeTurnSettings(connection) };
    },

    async reconfigureTurn(connection, threadId, turnId, patch) {
      const params: Record<string, unknown> = { threadId, turnId };
      if (patch.model !== undefined) {
        params.model = patch.model;
      }
      if (patch.effort !== undefined) {
        params.effort = patch.effort;
      }
      try {
        await connection.request('turn/settings/update', params);
        return 'live';
      } catch {
        return 'next-turn';
      }
    },

    handleNotification(params) {
      if (!isRecord(params) || typeof params.threadId !== 'string') {
        return;
      }
      const updated = params.threadSettings;
      for (const waiter of [...waiters]) {
        if (waiter.threadId === params.threadId && settingsMatch(waiter.expected, updated)) {
          waiter.settle('live');
          return;
        }
      }
    },

    settleAll() {
      for (const waiter of [...waiters]) {
        waiter.settle('next-turn');
      }
    },
  };
}

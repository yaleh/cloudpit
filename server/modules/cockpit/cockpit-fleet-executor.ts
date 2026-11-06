/**
 * The quay-fleet disposal executors: the declaration port, one `ICockpitActionExecutor` per
 * DECLARED executor, and the one place a fleet refusal becomes a readable error.
 *
 * WHY THE IDS COME FROM THE CLI. The fleet owns the executor surface: `rescue executors --json`
 * answers `{ ok, executors: [{ id, action, does, params }] }`, and the four ids it currently
 * ships (`fleet.hold`, `fleet.park`, `fleet.redispatch`, `fleet.log`) are that document's
 * content, not a Cloudpit constant. Hard-coding them here would drift the moment the fleet adds
 * or renames one, and a declaration the consumer cannot see is exactly the failure this task
 * exists to remove. This module therefore PARSES the declaration and instantiates one executor
 * per entry. Two ids are named below, each for a stated reason: `fleet.log`, which the own-reply
 * contract names, and `fleet.molten-decide`, the cockpit side of the still-unshipped GOAL-012
 * molten contract (see its declaration).
 *
 * THE EXIT CODE IS THE RESULT. The fleet validates before writing, so:
 *
 *   · `0` + `{ ok: true, … }`          → the success document is the executor's result;
 *   · `2` + a refusal document         → `AppError` carrying the fleet's own `code`/`message`
 *                                        (unknown id, missing required param, ledger refusal);
 *   · `3` + `project-not-registered`   → the same, named as "项目未在 fleet 登记";
 *   · anything else, or a non-JSON answer → an explicit `FLEET_EXEC_FAILED`, never a success.
 *
 * WHY THE FREE TEXT IS RENAMED. The confirmation channel adds a person's own typed reply to the
 * executor params under `reply` (its one field); the fleet executor surface names that text
 * `text` (the required param of `fleet.log`). The adapter is the one place that knows both
 * vocabularies, so it maps `reply` → `text` and drops `reply` from the JSON it hands the CLI.
 *
 * Consumers: `cockpit-fleet-card-provider.ts` (declaration reading), `server/cockpit-fleet-wiring.ts`
 * (the real child runner) and the executor criterion.
 */
import type { ICockpitActionExecutor } from '@/shared/interfaces.js';
import { AppError, isRecord } from '@/shared/utils.js';

/**
 * The fleet executor that records a person's own words. The own-reply contract names it
 * explicitly (`fleet.log`), so the card projection needs a constant; every other id is read
 * from the declaration document.
 */
export const COCKPIT_FLEET_LOG_EXECUTOR_ID = 'fleet.log';

/** The read-only declaration port's argv. */
export const COCKPIT_FLEET_EXECUTORS_ARGS = ['rescue', 'executors', '--json'] as const;

/** One child answer, reduced to the fields this adapter branches on. */
export type CockpitFleetCommandResult = {
  /** `0` for success; the child's status, or `null` when it never ran. */
  exitCode: number | null;
  stdout: string;
  stderr: string;
  /** Why the child could not be run, when the seam knows (a missing binary, a timeout). */
  error?: string;
  /**
   * Node's string error code for a failure with no exit status, when the seam reported one.
   *
   * The card provider reads this to tell a `maxBuffer` kill — which still delivered the bytes
   * captured before the kill — from a missing binary, which delivered none. Consumers that only
   * branch on `exitCode`/`error` are unaffected by its presence.
   */
  errorCode?: string;
};

/** One declared parameter; `required` is the fleet's word about the call, not ours. */
export type CockpitFleetExecutorParam = {
  name: string;
  type?: string;
  required?: boolean;
};

/** One executor as the fleet declares it. */
export type CockpitFleetExecutorDeclaration = {
  id: string;
  action: string;
  does: string;
  params: readonly CockpitFleetExecutorParam[];
};

/** What one `rescue executors --json` read answered. */
export type CockpitFleetExecutorReading = {
  /** Every well-formed declaration; empty when the CLI could not answer. */
  declarations: readonly CockpitFleetExecutorDeclaration[];
  /** Why the declaration set is empty, when that is known. */
  reason: string | null;
};

/**
 * The molten short-loop decision executor (GOAL-012's contract).
 *
 * WHY THIS ID IS DECLARED HERE, NOT READ FROM THE CLI. Every other fleet executor id is the
 * declaration document's content. The molten decision surface is the cockpit side of a contract
 * the fleet has not shipped yet: the projection builds the card's confirm options against
 * `fleet.molten-decide`, so the declared set must name it or every option would render
 * unconfirmable. The id and params are therefore the cockpit's own statement of the agreed
 * contract; once the fleet's `rescue executors --json` lists the same id, that declaration wins
 * (see the provider's resolver) and this one becomes the fallback.
 *
 * THE PARAMS ARE THE CARD'S OWN ADDRESS. `attentionId` + `revision` locate the open molten
 * card and refuse a stale decision, and `decision` is one of the contract's three values
 * (`crystallize-task` / `decline` / `modify`). This is NOT the knowledge executor: a molten
 * decision crystallises through the fleet's molten channel (task/card split), never the
 * knowledge suggestion's apply/modify/defer vocabulary.
 */
export const COCKPIT_MOLTEN_DECIDE_EXECUTOR_ID = 'fleet.molten-decide';

/** The molten decision executor's declared parameters, aligned with the GOAL-012 contract. */
export const COCKPIT_MOLTEN_DECIDE_DECLARATION: CockpitFleetExecutorDeclaration = {
  id: COCKPIT_MOLTEN_DECIDE_EXECUTOR_ID,
  action: 'molten-decide',
  does: '把人的决定交给 fleet 结晶（task/card 分流），不经过知识执行器',
  params: [
    { name: 'attentionId', type: 'string', required: true },
    { name: 'revision', type: 'integer', required: true },
    { name: 'decision', type: 'string', required: true },
  ],
};

/** The outside world one fleet executor needs: the child runner. */
export type CockpitFleetExecutorDeps = {
  runFleet(args: readonly string[]): Promise<CockpitFleetCommandResult>;
};

/** The readable line of a child's complaint, capped like the card provider's diagnostic. */
function firstLine(text: string): string {
  const line = text.split('\n').find((entry) => entry.trim() !== '')?.trim() ?? '';
  return line.length > 300 ? `${line.slice(0, 297)}...` : line;
}

/** One declared param, or `null` when the entry has no readable name. */
function parseParam(raw: unknown): CockpitFleetExecutorParam | null {
  if (!isRecord(raw) || typeof raw.name !== 'string' || raw.name.trim() === '') return null;
  return {
    name: raw.name,
    ...(typeof raw.type === 'string' ? { type: raw.type } : {}),
    ...(typeof raw.required === 'boolean' ? { required: raw.required } : {}),
  };
}

/** One declaration, or `null` when it has no id (an entry without an id is not callable). */
function parseDeclaration(raw: unknown): CockpitFleetExecutorDeclaration | null {
  if (!isRecord(raw)) return null;
  const id = typeof raw.id === 'string' ? raw.id.trim() : '';
  if (id === '') return null;
  const params: CockpitFleetExecutorParam[] = [];
  for (const entry of Array.isArray(raw.params) ? raw.params : []) {
    const param = parseParam(entry);
    if (param !== null) params.push(param);
  }
  return {
    id,
    action: typeof raw.action === 'string' ? raw.action : '',
    does: typeof raw.does === 'string' ? raw.does : '',
    params,
  };
}

/**
 * Reads one `rescue executors --json` answer into the declaration set.
 *
 * Failure is a READING: a missing CLI, a non-zero exit and a document without `ok: true` all
 * answer an empty set plus the first readable reason, never a throw — the cockpit must keep
 * rendering cards when the fleet is absent.
 */
export function readCockpitFleetExecutors(
  result: CockpitFleetCommandResult,
): CockpitFleetExecutorReading {
  if (result.exitCode !== 0 || result.error !== undefined) {
    const reason =
      firstLine(result.stderr) ||
      firstLine(result.error?.trim() ?? '') ||
      `quay-fleet rescue executors exited ${
        result.exitCode === null ? 'without a status' : String(result.exitCode)
      }`;
    return { declarations: [], reason };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    return {
      declarations: [],
      reason: 'quay-fleet rescue executors did not answer a JSON document',
    };
  }
  if (!isRecord(parsed) || parsed.ok !== true || !Array.isArray(parsed.executors)) {
    return {
      declarations: [],
      reason: 'quay-fleet rescue executors answered without ok:true and an executors array',
    };
  }

  const declarations: CockpitFleetExecutorDeclaration[] = [];
  for (const entry of parsed.executors) {
    const declaration = parseDeclaration(entry);
    if (declaration !== null) declarations.push(declaration);
  }
  return { declarations, reason: null };
}

/**
 * The params the CLI receives.
 *
 * `reply` is the confirmation channel's spelling for the person's own typed words; the fleet's
 * executor surface calls that same text `text`. The mapping is unconditional for a string reply,
 * because `reply` is only ever added by the own-reply path and only `fleet.log` declares `text`.
 */
function fleetParams(params: Record<string, unknown>): Record<string, unknown> {
  const { reply, ...rest } = params;
  return typeof reply === 'string' ? { ...rest, text: reply } : { ...rest };
}

/** The refusal/execution-failure error this adapter raises. */
function executionFailure(executorId: string, detail: string): AppError {
  return new AppError(`fleet executor ${executorId} failed: ${detail}`, {
    code: 'FLEET_EXEC_FAILED',
    statusCode: 502,
  });
}

/**
 * One executor, built FROM a declaration: its id is the declared id, never a constant here.
 *
 * `execute` runs `quay-fleet rescue exec <id> --params <json> --json` and classifies the answer
 * by exit code (see the file header). It never retries: `fleet.log` is deliberately not
 * idempotent, so the confirmation channel's `(card, revision)` ledger is the single guard
 * against a duplicate — a retry here would be a second decision record.
 */
export class CockpitFleetExecutor implements ICockpitActionExecutor {
  readonly id: string;
  private readonly declared: CockpitFleetExecutorDeclaration;
  private readonly deps: CockpitFleetExecutorDeps;

  constructor(declaration: CockpitFleetExecutorDeclaration, deps: CockpitFleetExecutorDeps) {
    this.id = declaration.id;
    this.declared = declaration;
    this.deps = deps;
  }

  /** The declaration this instance was built from (read-only; useful to a criterion). */
  declaration(): CockpitFleetExecutorDeclaration {
    return this.declared;
  }

  async execute(params: Record<string, unknown>): Promise<unknown> {
    const call = fleetParams(params);
    const result = await this.deps.runFleet([
      'rescue',
      'exec',
      this.id,
      '--params',
      JSON.stringify(call),
      '--json',
    ]);

    let parsed: Record<string, unknown> | null = null;
    try {
      const document: unknown = JSON.parse(result.stdout);
      if (isRecord(document)) parsed = document;
    } catch {
      parsed = null;
    }

    if (result.exitCode === 0) {
      if (parsed === null) {
        throw executionFailure(this.id, 'answered a non-JSON document on a zero exit');
      }
      if (parsed.ok !== true) {
        throw executionFailure(this.id, `answered ok=${String(parsed.ok)} on a zero exit`);
      }
      return parsed;
    }

    if (result.exitCode === 2 || result.exitCode === 3) {
      // The fleet's own code wins; the exit-code fallback keeps a truncated refusal readable.
      const code =
        (typeof parsed?.code === 'string' && parsed.code !== '' ? parsed.code : null) ??
        (result.exitCode === 3 ? 'project-not-registered' : 'refused');
      const message =
        (typeof parsed?.message === 'string' && parsed.message !== ''
          ? parsed.message
          : null) ??
        (result.exitCode === 3
          ? '项目未在 fleet 登记'
          : firstLine(result.stderr) || `quay-fleet refused ${this.id}`);
      throw new AppError(message, {
        code,
        statusCode: result.exitCode === 3 ? 409 : 400,
      });
    }

    throw executionFailure(
      this.id,
      firstLine(result.stderr) ||
        firstLine(result.error?.trim() ?? '') ||
        `quay-fleet exited ${
          result.exitCode === null ? 'without a status' : String(result.exitCode)
        }`,
    );
  }
}

/** Instantiates one executor per declaration, preserving the fleet's order. */
export function createCockpitFleetExecutors(
  declarations: readonly CockpitFleetExecutorDeclaration[],
  deps: CockpitFleetExecutorDeps,
): CockpitFleetExecutor[] {
  return declarations.map((declaration) => new CockpitFleetExecutor(declaration, deps));
}

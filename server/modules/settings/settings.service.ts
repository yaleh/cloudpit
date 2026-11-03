import type { McpAuditRouteEntry, McpGatewayGateReading } from '@/modules/mcp-gateway/index.js';
import { normalizeAccessTokenScopes } from '@/modules/oauth/index.js';
import { readExpectedVersion } from '@/shared/settings-file.js';
import { AppError } from '@/shared/utils.js';

import {
  createCodexModelProvidersOperations,
  type CodexModelProvidersPort,
} from './codex-model-providers.service.js';

type NotificationPreferences = Record<string, unknown> & {
  channels?: Record<string, unknown> & { webPush?: boolean };
};

/**
 * A persisted access-token row as the token store returns it. `token_hash` is
 * present because it is the storage form; the settings projection deliberately
 * omits it so a list response can never leak the hash. `kind` is the row's token
 * kind (`'pat'`, `'oauth_access'` or `'oauth_refresh'`) — the PAT list selects on
 * it so an OAuth row can never render as a nameless "Unnamed token".
 */
type StoredAccessToken = {
  id: number;
  user_id: number;
  kind: string;
  token_prefix: string;
  name: string | null;
  scopes: string;
  expires_at: string;
  created_at: string | null;
  last_used: string | null;
  revoked_at: string | null;
};

/**
 * One OAuth access/refresh token row, already joined to its grant's client name.
 * `token_hash` is present because it is the storage form; `projectOAuthToken`
 * omits it so the read-only list response cannot leak the hash.
 */
type StoredOAuthToken = {
  id: number;
  kind: string;
  token_hash: string;
  token_prefix: string;
  scopes: string;
  expires_at: string;
  created_at: string | null;
  last_used: string | null;
  revoked_at: string | null;
  client_name: string | null;
};

/**
 * The token-store operations Settings delegates to. Satisfied by the OAuth
 * module's `AccessTokensService` (issue/revoke) plus the access-token repository
 * (list/find); the settings service owns the projection and the ownership check
 * so this module never imports the OAuth implementation directly.
 */
type AccessTokensPort = {
  /** `kind` narrows the SQL read; the PAT list passes `'pat'`. */
  list(userId: number, kind?: string): StoredAccessToken[];
  findById(tokenId: number): StoredAccessToken | undefined;
  issue(input: {
    userId: number;
    name?: string | null;
    scopes: string[];
    expiresInDays?: number | null;
  }):
    | { ok: true; token: { id: number; token: string; tokenPrefix: string; expiresAt: string } }
    | { ok: false; reason: string };
  /** Stamps `revoked_at`; true only when a live row matched. Ownership is checked by the caller. */
  revoke(tokenId: number): boolean;
};

/** One saved reading of the cockpit session-start selection, as the file owns it. */
type CockpitSessionStartSavedReading = {
  /** The saved model, or the shipped default when the file declares none. */
  model: string;
  /** The saved effort; `''` is "let the launch infer it". */
  effort: string;
  /** The content hash an editor sends back to prove it edited what it read. */
  version: string;
};

/** One whitelist edit: only the fields present are changed. */
type CockpitSessionStartWriteInput = {
  model?: string | undefined;
  effort?: string | undefined;
  expectedVersion: string;
};

/**
 * The file seam behind Settings → Cockpit → new-conversation selection.
 *
 * `read`/`write` see the SAVED file; `effective` reports what THIS boot loaded, so a save can
 * be shown as pending without pretending it changed a running process.
 */
type CockpitSessionStartPort = {
  read(): CockpitSessionStartSavedReading;
  write(input: CockpitSessionStartWriteInput): Promise<CockpitSessionStartSavedReading>;
  effective(): { model: string; effort: string } | null;
};

type SettingsDependencies = {
  credentials: {
    list(userId: number, credentialType: string | null): unknown[];
    create(
      userId: number,
      name: string,
      type: string,
      value: string,
      description: string | null,
    ): unknown;
    remove(userId: number, credentialId: number): boolean;
    toggle(userId: number, credentialId: number, isActive: boolean): boolean;
  };
  notifications: {
    getPreferences(userId: number): NotificationPreferences | undefined;
    updatePreferences(userId: number, preferences: NotificationPreferences): unknown;
    createEnabledEvent(): unknown;
    notifyUser(userId: number, event: unknown): void | Promise<void>;
  };
  pushSubscriptions: {
    save(userId: number, endpoint: string, p256dh: string, auth: string): void;
    remove(endpoint: string): void;
  };
  getVapidPublicKey(): string | null;
  accessTokens: AccessTokensPort;
  /**
   * The read-only seam behind the Settings → API page's advanced OAuth-token list.
   *
   * Optional so the existing service criteria keep constructing the dependency
   * object they always have; the module always supplies it (see
   * `settings.module.ts`). It returns the caller's non-PAT token rows already
   * joined to their grant's client name, so the join (a grant → client lookup)
   * lives where the repositories are wired rather than here.
   */
  oauthTokens?: {
    list(userId: number): StoredOAuthToken[];
  };
  /**
   * The read-only seams the Settings → API page's Cloudpit MCP block needs.
   *
   * Optional so the existing service criteria keep constructing the dependency
   * object they always have; the module always supplies it (see
   * `settings.module.ts`). `readGate` is the mcp-gateway module's own gate
   * reader — the single place `MCP_ENABLED` is parsed — so settings never
   * re-derives the gate from the environment.
   */
  mcpGateway?: {
    readGate(): McpGatewayGateReading;
    /** The path the stateless MCP transport is mounted at. */
    path: string;
    /** The deployment's public base url, or null to fall back to the request's own origin. */
    publicBaseUrl(): string | null;
  };
  /**
   * The read seam the Settings → API page's MCP-audit list needs (AC-304).
   *
   * Optional so the existing service criteria keep constructing the dependency
   * object they always have; the module always supplies it (see
   * `settings.module.ts`). The reader owns the ownership lookup and the
   * write-only default; this module only forwards the caller's query options.
   */
  mcpAudit?: {
    listForUser(input: { userId: number; limit?: unknown; includeReads?: unknown }): McpAuditRouteEntry[];
  };
  /**
   * The cockpit's new-conversation launch selection, saved in the SERVER settings file.
   *
   * Optional so the existing service criteria keep constructing the dependency object they
   * always have; `settings.module.ts` always supplies it. The file reader fills an unwritten
   * model with the shipped default, so this module never restates it.
   */
  cockpitSessionStart?: CockpitSessionStartPort;
  /**
   * The project-owned Codex provider registry (Settings → Agents → Codex).
   *
   * Optional so the existing service criteria keep constructing the dependency object they
   * always have; `settings.module.ts` always supplies it. The operations live in a sibling
   * file so this assembled service does not grow the registry's file and transport rules.
   */
  codexModelProviders?: CodexModelProvidersPort;
};

/** The only lifetimes a personal access token may request, in days. */
const ALLOWED_TOKEN_EXPIRY_DAYS: readonly number[] = [7, 30, 90];

/** Lifetime applied when the caller omits `expiresInDays`. */
const DEFAULT_TOKEN_EXPIRY_DAYS = 30;

/** Scopes applied when the caller omits them; the read scope is the required baseline. */
const DEFAULT_TOKEN_SCOPES: readonly string[] = ['cloudpit:read'];

/**
 * Projects a stored row to the client-facing token shape. Written as an
 * allowlist: `token_hash` is never copied, so the hash cannot reach a response
 * even if the storage row grows new secret columns.
 */
function projectAccessToken(row: StoredAccessToken) {
  return {
    id: row.id,
    tokenPrefix: row.token_prefix,
    name: row.name,
    scopes: JSON.parse(row.scopes) as string[],
    expiresAt: row.expires_at,
    lastUsed: row.last_used,
    createdAt: row.created_at,
    revokedAt: row.revoked_at,
  };
}

/**
 * Projects an OAuth token row to the read-only advanced list's shape. Like
 * `projectAccessToken` this is an allowlist: `token_hash` is not copied, so the
 * hash cannot reach the response even if the storage row grows new secret
 * columns. `clientName` is the OAuth client the token's grant belongs to, so the
 * row is identified by name instead of the NULL `name` the store writes.
 */
function projectOAuthToken(row: StoredOAuthToken) {
  return {
    id: row.id,
    kind: row.kind,
    tokenPrefix: row.token_prefix,
    clientName: row.client_name,
    scopes: JSON.parse(row.scopes) as string[],
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    lastUsed: row.last_used,
    revokedAt: row.revoked_at,
  };
}

function requiredString(value: unknown, fieldName: string, code: string): string {
  const normalizedValue = typeof value === 'string' ? value.trim() : '';
  if (!normalizedValue) {
    throw new AppError(`${fieldName} is required`, { code, statusCode: 400 });
  }
  return normalizedValue;
}

function assertFound(found: boolean, resourceName: string, code: string): void {
  if (!found) {
    throw new AppError(`${resourceName} not found`, { code, statusCode: 404 });
  }
}

/** The only body keys the cockpit session-start endpoint accepts. */
const COCKPIT_SESSION_START_FIELDS: readonly string[] = ['model', 'effort', 'expectedVersion'];

function requireCockpitSessionStartPort(dependencies: SettingsDependencies): CockpitSessionStartPort {
  const port = dependencies.cockpitSessionStart;
  if (!port) {
    throw new AppError('Cockpit session-start settings are not configured', {
      code: 'COCKPIT_SESSION_START_UNAVAILABLE',
      statusCode: 500,
    });
  }
  return port;
}

/** The boot reading, or a visible 503 when the file was never loaded in this process. */
function bootCockpitSessionStart(
  port: CockpitSessionStartPort,
): { model: string; effort: string } {
  const effective = port.effective();
  if (!effective) {
    throw new AppError('The server settings file has not been loaded in this process', {
      code: 'BOOT_SNAPSHOT_UNAVAILABLE',
      statusCode: 503,
    });
  }
  return effective;
}

/**
 * The wire reading: `model`/`effort` are the SAVED file values the NEXT boot applies;
 * `effective*` are the values the RUNNING process booted with. `restartRequired` is true only
 * when those two disagree, which is exactly when a restart would change anything.
 */
function projectCockpitSessionStart(
  saved: CockpitSessionStartSavedReading,
  effective: { model: string; effort: string },
) {
  return {
    model: saved.model,
    effort: saved.effort,
    effectiveModel: effective.model,
    effectiveEffort: effective.effort,
    version: saved.version,
    restartRequired: saved.model !== effective.model || saved.effort !== effective.effort,
  };
}

function readCockpitSessionStartModel(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new AppError('model must be a non-empty string', {
      code: 'INVALID_MODEL',
      statusCode: 400,
    });
  }
  return value.trim();
}

function readCockpitSessionStartEffort(value: unknown): string {
  if (typeof value !== 'string') {
    throw new AppError('effort must be a string', {
      code: 'INVALID_EFFORT',
      statusCode: 400,
    });
  }
  return value.trim();
}

/** Creates settings workflows with repositories and notification effects injected. */
export function createSettingsService(dependencies: SettingsDependencies) {
  return {
    // The Codex provider registry's two endpoints are a distinct file-backed concern; they are
    // composed here so `settings.module.ts` still builds one service.
    ...createCodexModelProvidersOperations(dependencies.codexModelProviders),
    listCredentials(userId: number, credentialType: string | null) {
      return { credentials: dependencies.credentials.list(userId, credentialType) };
    },
    createCredential(userId: number, input: Record<string, unknown>) {
      const credentialName = requiredString(
        input.credentialName,
        'Credential name',
        'CREDENTIAL_NAME_REQUIRED',
      );
      const credentialType = requiredString(
        input.credentialType,
        'Credential type',
        'CREDENTIAL_TYPE_REQUIRED',
      );
      const credentialValue = requiredString(
        input.credentialValue,
        'Credential value',
        'CREDENTIAL_VALUE_REQUIRED',
      );
      const description = typeof input.description === 'string'
        ? input.description.trim() || null
        : null;
      return {
        success: true,
        credential: dependencies.credentials.create(
          userId,
          credentialName,
          credentialType,
          credentialValue,
          description,
        ),
      };
    },
    deleteCredential(userId: number, credentialId: number) {
      assertFound(
        dependencies.credentials.remove(userId, credentialId),
        'Credential',
        'CREDENTIAL_NOT_FOUND',
      );
      return { success: true };
    },
    toggleCredential(userId: number, credentialId: number, isActive: unknown) {
      if (typeof isActive !== 'boolean') {
        throw new AppError('isActive must be a boolean', {
          code: 'INVALID_ACTIVE_STATE',
          statusCode: 400,
        });
      }
      assertFound(
        dependencies.credentials.toggle(userId, credentialId, isActive),
        'Credential',
        'CREDENTIAL_NOT_FOUND',
      );
      return { success: true };
    },
    listAccessTokens(userId: number) {
      // PAT-only on the SQL layer: the OAuth store writes each oauth_access /
      // oauth_refresh row with a NULL name, and without the kind filter those rows
      // rendered as "Unnamed token" in this list (they belong in the advanced
      // read-only list below, never here).
      return { tokens: dependencies.accessTokens.list(userId, 'pat').map(projectAccessToken) };
    },
    /**
     * The Settings → API page's advanced, read-only OAuth-token list: the caller's
     * non-PAT rows, each carrying its grant's client name. There is deliberately no
     * create or revoke here — OAuth tokens are minted and revoked by the OAuth
     * flows and the grant/client cascades, never from this list.
     */
    listOAuthTokens(userId: number) {
      const oauthTokens = dependencies.oauthTokens;
      if (!oauthTokens) {
        throw new AppError('OAuth tokens are not configured', {
          code: 'OAUTH_TOKENS_UNAVAILABLE',
          statusCode: 500,
        });
      }
      return { tokens: oauthTokens.list(userId).map(projectOAuthToken) };
    },
    createAccessToken(userId: number, input: Record<string, unknown>) {
      const name = requiredString(input.name, 'Token name', 'TOKEN_NAME_REQUIRED');
      const requestedDays = input.expiresInDays === undefined
        ? DEFAULT_TOKEN_EXPIRY_DAYS
        : input.expiresInDays;
      if (typeof requestedDays !== 'number' || !ALLOWED_TOKEN_EXPIRY_DAYS.includes(requestedDays)) {
        throw new AppError('expiresInDays must be one of 7, 30, 90', {
          code: 'INVALID_EXPIRES_IN',
          statusCode: 400,
        });
      }
      // An omitted scope list keeps the read baseline; anything explicit must
      // be a non-empty subset of the known vocabulary, deduplicated. An
      // explicit `[]` is rejected rather than defaulted.
      let scopes: string[];
      if (input.scopes === undefined) {
        scopes = [...DEFAULT_TOKEN_SCOPES];
      } else {
        const normalized = normalizeAccessTokenScopes(input.scopes);
        if (!normalized.ok) {
          throw new AppError('scopes must be a non-empty subset of known scopes', {
            code: 'INVALID_SCOPE',
            statusCode: 400,
          });
        }
        scopes = normalized.scopes;
      }

      const issued = dependencies.accessTokens.issue({ userId, name, scopes, expiresInDays: requestedDays });
      if (!issued.ok) {
        // The whitelist above rejects every lifetime the token store refuses, so
        // reaching here means the store and the settings policy disagree.
        throw new AppError('Access token could not be issued', {
          code: 'ACCESS_TOKEN_ISSUE_FAILED',
          statusCode: 500,
        });
      }
      const row = dependencies.accessTokens.findById(issued.token.id);
      return {
        token: {
          id: issued.token.id,
          name,
          tokenPrefix: issued.token.tokenPrefix,
          scopes,
          expiresAt: issued.token.expiresAt,
          lastUsed: row?.last_used ?? null,
          createdAt: row?.created_at ?? null,
          plaintext: issued.token.token,
        },
      };
    },
    revokeAccessToken(userId: number, tokenId: number) {
      const token = dependencies.accessTokens.findById(tokenId);
      assertFound(Boolean(token) && token?.user_id === userId, 'Access token', 'ACCESS_TOKEN_NOT_FOUND');
      assertFound(dependencies.accessTokens.revoke(tokenId), 'Access token', 'ACCESS_TOKEN_NOT_FOUND');
      return { success: true };
    },
    /**
     * The Settings → API page's Cloudpit MCP block: whether the gateway is
     * enabled, the path it answers on, and the base url an MCP client should
     * dial. The gate is read through the mcp-gateway module (the single place
     * `MCP_ENABLED` is parsed) rather than re-derived here.
     */
    getMcpGatewayStatus(origin: string) {
      const gateway = dependencies.mcpGateway;
      if (!gateway) {
        throw new AppError('MCP gateway status is not configured', {
          code: 'MCP_GATEWAY_STATUS_UNAVAILABLE',
          statusCode: 500,
        });
      }
      return {
        enabled: gateway.readGate().enabled,
        path: gateway.path,
        baseUrl: gateway.publicBaseUrl() ?? origin,
      };
    },
    /**
     * The Settings → API page's recent MCP tool-call list: the current user's
     * audit rows, write calls only unless `includeReads` is set. The reader owns
     * the ownership lookup and the summary shape; this is a thin pass-through.
     */
    listMcpAudit(userId: number, options: { limit?: unknown; includeReads?: unknown }) {
      const audit = dependencies.mcpAudit;
      if (!audit) {
        throw new AppError('MCP audit log is not configured', {
          code: 'MCP_AUDIT_UNAVAILABLE',
          statusCode: 500,
        });
      }
      return { rows: audit.listForUser({ userId, ...options }) };
    },
    getNotificationPreferences(userId: number) {
      return { success: true, preferences: dependencies.notifications.getPreferences(userId) };
    },
    /**
     * The Settings → Cockpit page's launch selection: saved model/effort beside the values this
     * boot is actually using, plus the version a save must carry.
     */
    getCockpitSessionStart() {
      const port = requireCockpitSessionStartPort(dependencies);
      return projectCockpitSessionStart(port.read(), bootCockpitSessionStart(port));
    },
    /**
     * Saves the launch selection. `partial` is PATCH: change only the fields present. A PUT
     * replaces both whitelist fields, so an omitted `effort` is written as the template's empty
     * string. Every other field in the file is preserved by the file writer, and a stale
     * `expectedVersion` is a 409 rather than an overwrite.
     */
    async updateCockpitSessionStart(input: {
      body: unknown;
      headerVersion?: string | undefined;
      partial: boolean;
    }) {
      const port = requireCockpitSessionStartPort(dependencies);
      const body = typeof input.body === 'object' && input.body !== null && !Array.isArray(input.body)
        ? input.body as Record<string, unknown>
        : {};
      const unknownFields = Object.keys(body).filter(
        (field) => !COCKPIT_SESSION_START_FIELDS.includes(field),
      );
      if (unknownFields.length > 0) {
        throw new AppError(`unknown field(s): ${unknownFields.join(', ')}`, {
          code: 'UNKNOWN_FIELD',
          statusCode: 400,
          details: { fields: unknownFields },
        });
      }

      const model = body.model === undefined ? undefined : readCockpitSessionStartModel(body.model);
      const effort = body.effort === undefined
        ? undefined
        : readCockpitSessionStartEffort(body.effort);
      if (!input.partial) {
        if (model === undefined) {
          throw new AppError('model is required', { code: 'MODEL_REQUIRED', statusCode: 400 });
        }
      } else if (model === undefined && effort === undefined) {
        throw new AppError('nothing to update', {
          code: 'NOTHING_TO_UPDATE',
          statusCode: 400,
        });
      }

      const expectedVersion = readExpectedVersion(body, input.headerVersion);
      const saved = await port.write({
        model,
        effort: input.partial ? effort : (effort ?? ''),
        expectedVersion,
      });
      return projectCockpitSessionStart(saved, bootCockpitSessionStart(port));
    },
    updateNotificationPreferences(userId: number, preferences: NotificationPreferences) {
      return {
        success: true,
        preferences: dependencies.notifications.updatePreferences(userId, preferences),
      };
    },
    getVapidPublicKey() {
      return { publicKey: dependencies.getVapidPublicKey() };
    },
    subscribeToPush(userId: number, input: Record<string, unknown>) {
      const endpoint = requiredString(input.endpoint, 'Endpoint', 'PUSH_SUBSCRIPTION_REQUIRED');
      const keys = typeof input.keys === 'object' && input.keys !== null
        ? input.keys as Record<string, unknown>
        : {};
      const p256dh = requiredString(keys.p256dh, 'p256dh', 'PUSH_SUBSCRIPTION_REQUIRED');
      const auth = requiredString(keys.auth, 'auth', 'PUSH_SUBSCRIPTION_REQUIRED');
      dependencies.pushSubscriptions.save(userId, endpoint, p256dh, auth);

      const currentPreferences = dependencies.notifications.getPreferences(userId);
      if (!currentPreferences?.channels?.webPush) {
        dependencies.notifications.updatePreferences(userId, {
          ...currentPreferences,
          channels: { ...currentPreferences?.channels, webPush: true },
        });
      }
      const event = dependencies.notifications.createEnabledEvent();
      void dependencies.notifications.notifyUser(userId, event);
      return { success: true };
    },
    unsubscribeFromPush(userId: number, endpointInput: unknown) {
      const endpoint = requiredString(endpointInput, 'Endpoint', 'PUSH_ENDPOINT_REQUIRED');
      dependencies.pushSubscriptions.remove(endpoint);
      const currentPreferences = dependencies.notifications.getPreferences(userId);
      if (currentPreferences?.channels?.webPush) {
        dependencies.notifications.updatePreferences(userId, {
          ...currentPreferences,
          channels: { ...currentPreferences.channels, webPush: false },
        });
      }
      return { success: true };
    },
  };
}

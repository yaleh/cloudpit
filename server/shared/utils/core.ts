import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { ApiSuccessShape, AppErrorOptions, NormalizedMessage } from '../types/index.js';

//----------------- ENVIRONMENT UTILITIES ------------
/**
 * Indicates whether the backend is running in hosted Platform mode rather than
 * self-hosted OSS mode. The server bootstrap, Agent, Auth, and Browser Use
 * modules use this shared flag to keep environment-dependent behavior aligned.
 * Environment variables must be loaded before this module is evaluated.
 */
export const IS_PLATFORM = process.env.VITE_IS_PLATFORM === 'true';


// ---------------------------
//----------------- NORMALIZED MESSAGE HELPER INPUT TYPES ------------
/**
 * Input payload accepted by `createNormalizedMessage`.
 *
 * Callers provide provider-specific fields plus the required `kind/provider`
 * pair; this helper fills missing envelope fields (`id`, `sessionId`,
 * `timestamp`) in a consistent way.
 */
export type NormalizedMessageInput =
  {
    kind: NormalizedMessage['kind'];
    provider: NormalizedMessage['provider'];
    id?: string | null;
    sessionId?: string | null;
    timestamp?: string | null;
  } & Record<string, unknown>;

// ---------------------------
//----------------- HTTP HANDLER UTILITIES ------------
/**
 * Wraps arbitrary data in the standard API success envelope.
 *
 * Use this helper in route handlers to keep successful JSON responses consistent
 * across endpoints.
 */
export function createApiSuccessResponse<TData>(
  data: TData,
): ApiSuccessShape<TData> {
  return {
    success: true,
    data,
  };
}

/**
 * Converts an async Express handler into a standard `RequestHandler` and routes
 * rejected promises to Express error middleware.
 *
 * Use this to avoid repeating `try/catch(next)` in every async route.
 */
export function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
): RequestHandler {
  return (req, res, next) => {
    void Promise.resolve(handler(req, res, next)).catch(next);
  };
}

// ---------------------------
//----------------- AUTHORIZATION HEADER UTILITIES ------------
/** The only `Authorization` scheme the backend's bearer-token endpoints accept. */
const BEARER_PREFIX = 'Bearer ';

/**
 * Returns the token carried by an `Authorization: Bearer <token>` header, or
 * `null` when the header is absent, uses another scheme, or carries no value.
 *
 * Consumers: the OAuth module's `/api/oauth/token-info` route and the
 * mcp-gateway module's `/mcp` authentication middleware. Both parse the header
 * HERE so a header one endpoint accepts is never refused by the other.
 */
export function bearerToken(header: string | undefined): string | null {
  if (typeof header !== 'string' || !header.startsWith(BEARER_PREFIX)) {
    return null;
  }
  const token = header.slice(BEARER_PREFIX.length).trim();
  return token.length > 0 ? token : null;
}

// ---------------------------
//----------------- SHARED ERROR UTILITIES ------------
/**
 * Shared application error with HTTP status and machine-readable code metadata.
 *
 * Throw this from service/route layers when the caller should receive a
 * controlled error response rather than a generic 500.
 */
export class AppError extends Error {
  readonly code: string;
  readonly statusCode: number;
  readonly details?: unknown;

  constructor(message: string, options: AppErrorOptions = {}) {
    super(message);
    this.name = 'AppError';
    this.code = options.code ?? 'INTERNAL_ERROR';
    this.statusCode = options.statusCode ?? 500;
    this.details = options.details;
  }
}

// ---------------------------
//----------------- TYPE GUARD / ERROR RENDERING UTILITIES ------------
/** Narrows an unknown value to a plain object record; `null`, arrays and non-objects are not records. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Renders a thrown value as a sentence; `fallback` covers an empty `Error.message` and non-`Error` values. */
export function errorMessage(failure: unknown, fallback?: string): string {
  if (failure instanceof Error) {
    return failure.message.trim() !== '' ? failure.message : fallback ?? failure.message;
  }
  return fallback ?? String(failure);
}


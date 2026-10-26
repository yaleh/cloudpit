/**
 * The opaque API key shared by every direct-HTTP LLM consumer.
 *
 * WHY AN OBJECT AND NOT A STRING. The key travels in one header and must never be
 * copied into an error message, a log line, a status object or a JSON body. A plain
 * string offers no such guarantee: one `JSON.stringify` or `util.inspect` of the
 * reading that holds it would print the secret. Wrapping it means the only path to
 * the value is `reveal()`, and `toString`, `toJSON` and `util.inspect` all answer
 * `[redacted]`, so an accidental interpolation or serialisation is safe by
 * construction.
 *
 * Consumers: `llm-protocols.ts` (the one production call to `reveal()`, inside the
 * auth-header builder), `reply-suggestions-settings.ts` (re-exported for the HTTP
 * client's settings type and its criterion) and the settings readers in
 * `modules/quay` / `modules/observation`, which build one through
 * {@link credentialFromKey} rather than naming the class.
 */
import { inspect } from 'node:util';

/** What every redaction path answers instead of the secret. */
const REDACTED = '[redacted]';

export class ApiCredential {
  readonly #value: string;

  constructor(value: string) {
    this.#value = value;
  }

  /** The only accessor for the secret. */
  reveal(): string {
    return this.#value;
  }

  toString(): string {
    return REDACTED;
  }

  toJSON(): string {
    return REDACTED;
  }

  [inspect.custom](): string {
    return REDACTED;
  }
}

/**
 * Wrap a raw key resolved by a settings reader.
 *
 * The settings readers in `modules/quay` and `modules/observation` deliberately do
 * not name {@link ApiCredential}: their flat readings carry the key as a string, and
 * this factory is the one place that turns it back into the opaque value on the way
 * into a completion request. It exists so a consumer needs neither the class name
 * nor a second construction rule.
 */
export function credentialFromKey(key: string): ApiCredential {
  return new ApiCredential(key);
}

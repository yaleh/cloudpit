import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

import { describe, it } from 'vitest';

/**
 * Cockpit card contract type sync (AC-422).
 *
 * The card shapes are stated twice by hand — once in `server/shared/types.ts`
 * for the server compiler, once in `src/shared/types.ts` for the bundle, because
 * the two tsconfigs do not share a program (the same seam
 * `wireContractTypeSync.test.ts` covers for the rest of the hand-copied wire).
 * This criterion reads BOTH ends and reds as soon as either side gains or loses
 * a literal-union member or an object field, so a provider added to one side of
 * the contract cannot silently reach a browser that does not know it.
 *
 * The precedent is `wireContractTypeSync.test.ts`: the client declaration is
 * located by type name under `src/**` (tests excluded), so moving a type between
 * files does not red this criterion; the server declarations are read from
 * `server/shared/types.ts`, which is where they are authored.
 *
 * The files are read through `process.cwd()`: Vitest serves this module through
 * Vite, where `import.meta.url` is a dev-server URL rather than a `file:` one.
 */

const repoRoot = process.cwd();
const srcRoot = path.join(repoRoot, 'src');
const SERVER_TYPES = path.join(repoRoot, 'server', 'shared', 'types.ts');

/** Reads one exported literal union's members out of a source string. */
const readLiteralUnionFromSource = (source: string, typeName: string): string[] => {
  const declaration = new RegExp(
    `export type ${typeName}\\s*(?:<[^>]*>)?\\s*=\\s*([^;]+);`,
  ).exec(source);
  assert.ok(declaration, `${typeName} must be declared as a literal union`);
  const members = [...declaration[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
  assert.ok(members.length > 0, `${typeName} must be a non-empty literal union`);
  return [...new Set(members)].sort();
};

/** Returns the body of the first `{ … }` starting at `startIndex`, braces balanced. */
const readBalancedBraces = (source: string, startIndex: number): string => {
  assert.equal(source[startIndex], '{', 'balanced-brace read must start at an opening brace');
  let depth = 0;
  for (let index = startIndex; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    else if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(startIndex + 1, index);
    }
  }
  throw new Error('unbalanced braces in declaration');
};

/** Reads one exported object type's top-level field names out of a source string. */
const readObjectKeysFromSource = (source: string, typeName: string): string[] => {
  const declaration = new RegExp(
    `export type ${typeName}\\s*(?:<[^>]*>)?\\s*=\\s*\\{`,
  ).exec(source);
  assert.ok(declaration, `${typeName} must be declared as an object type`);
  const body = readBalancedBraces(source, declaration.index + declaration[0].length - 1);
  const keys: string[] = [];
  let depth = 0;
  for (const line of body.split('\n')) {
    // Only top-level members count: a nested object literal's own fields are not
    // fields of this wire shape.
    if (depth === 0) {
      const member = /^\s*(?:readonly\s+)?([A-Za-z_$][\w$]*)(\?)?\s*:/.exec(line);
      if (member) keys.push(member[2] ? `${member[1]}?` : member[1]);
    }
    for (const char of line) {
      if (char === '{') depth += 1;
      else if (char === '}') depth -= 1;
    }
  }
  assert.ok(keys.length > 0, `${typeName} must be a non-empty object type`);
  return [...new Set(keys)].sort();
};

const readFile = (file: string): string => readFileSync(file, 'utf8');

/** Finds the single non-test `src/**` file declaring `export type <typeName> = …`. */
const findClientDeclaration = (typeName: string): string => {
  const declaration = new RegExp(`export type ${typeName}\\s*(?:<[^>]*>)?\\s*=`);

  const walk = (directory: string): string[] => {
    const found: string[] = [];
    for (const entry of readdirSync(directory)) {
      const full = path.join(directory, entry);
      if (statSync(full).isDirectory()) {
        if (entry === 'tests') continue;
        found.push(...walk(full));
      } else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.(ts|tsx)$/.test(entry)) {
        if (declaration.test(readFile(full))) found.push(full);
      }
    }
    return found;
  };

  const matches = walk(srcRoot);
  assert.equal(
    matches.length,
    1,
    `${typeName} must be declared in exactly one non-test src file, found: ${matches.join(', ')}`,
  );
  return matches[0];
};

/** One row of the comparison table. */
type SyncRow = {
  /** Type name on the client side. The server side uses the same name. */
  readonly typeName: string;
  /** Which reading applies: a literal union or an object's top-level field set. */
  readonly reader: 'union' | 'object';
};

const ROWS: readonly SyncRow[] = [
  { typeName: 'CockpitCardKind', reader: 'union' },
  { typeName: 'CockpitCardState', reader: 'union' },
  { typeName: 'CockpitCardOptionSource', reader: 'union' },
  { typeName: 'CockpitCard', reader: 'object' },
  { typeName: 'CockpitCardOption', reader: 'object' },
  { typeName: 'CockpitCardFact', reader: 'object' },
  { typeName: 'CockpitCardTag', reader: 'object' },
  { typeName: 'CockpitCardAction', reader: 'object' },
  { typeName: 'CockpitCardSubject', reader: 'object' },
  { typeName: 'CockpitCardContentRef', reader: 'object' },
  { typeName: 'CockpitFixtureSubject', reader: 'object' },
  { typeName: 'CockpitCardOwnReply', reader: 'object' },
  { typeName: 'CockpitCardConversation', reader: 'object' },
  { typeName: 'CockpitCardNotify', reader: 'object' },
];

/** Reads one row's type from an arbitrary source string (used for both ends). */
const readFromSource = (reader: SyncRow['reader'], source: string, typeName: string): string[] =>
  reader === 'union'
    ? readLiteralUnionFromSource(source, typeName)
    : readObjectKeysFromSource(source, typeName);

const readClient = (row: SyncRow): string[] =>
  readFromSource(row.reader, readFile(findClientDeclaration(row.typeName)), row.typeName);

const readServer = (row: SyncRow): string[] =>
  readFromSource(row.reader, readFile(SERVER_TYPES), row.typeName);

/**
 * The difference between the two ends, spelled so a failure names the src side,
 * the type, and the exact member/field that is missing or extra.
 */
function describeDrift(row: SyncRow, client: string[], server: string[]): string {
  const srcOnly = client.filter((member) => !server.includes(member));
  const serverOnly = server.filter((member) => !client.includes(member));
  return (
    `${row.typeName}: src/shared/types.ts and server/shared/types.ts must name the same ` +
    `${row.reader === 'union' ? 'members' : 'fields'}; ` +
    `src-only: [${srcOnly.join(', ')}]; server-only: [${serverOnly.join(', ')}]`
  );
}

describe('cockpit card type sync', () => {
  it('every row reads a non-empty declaration on both ends, so no comparison is vacuous', () => {
    for (const row of ROWS) {
      assert.ok(
        readClient(row).length > 0,
        `${row.typeName} must read a non-empty declaration under src/`,
      );
      assert.ok(
        readServer(row).length > 0,
        `${row.typeName} must read a non-empty declaration in server/shared/types.ts`,
      );
    }
  });

  it('(a) every literal-union row names the same members on both ends', () => {
    for (const row of ROWS.filter((candidate) => candidate.reader === 'union')) {
      const client = readClient(row);
      const server = readServer(row);
      assert.deepEqual(client, server, describeDrift(row, client, server));
    }
  });

  it('(b) every object row names the same top-level fields on both ends', () => {
    for (const row of ROWS.filter((candidate) => candidate.reader === 'object')) {
      const client = readClient(row);
      const server = readServer(row);
      assert.deepEqual(client, server, describeDrift(row, client, server));
    }
  });

  it('false-form: deleting `expired` on the src side names the src file and the literal', () => {
    const srcTypes = readFile(path.join(srcRoot, 'shared', 'types.ts'));
    const mutated = srcTypes.replace(
      "export type CockpitCardState = 'open' | 'resolved' | 'expired';",
      "export type CockpitCardState = 'open' | 'resolved';",
    );
    assert.notEqual(mutated, srcTypes, 'the state-union mutation must apply to the in-memory copy');

    const row = ROWS.find((candidate) => candidate.typeName === 'CockpitCardState');
    assert.ok(row, 'CockpitCardState must be in the comparison table');
    const client = readFromSource('union', mutated, 'CockpitCardState');
    const server = readServer(row);
    assert.notDeepEqual(client, server, 'deleting a src-side literal must fail the comparison');

    const message = describeDrift(row, client, server);
    assert.match(message, /src\/shared\/types\.ts/, 'the failure message must name the src file');
    assert.match(message, /expired/, 'the failure message must name the deleted literal');
  });

  it('false-form: adding a server-side field names the field', () => {
    const serverTypes = readFile(SERVER_TYPES);
    const mutated = serverTypes.replace(
      'export type CockpitCard = {\n',
      'export type CockpitCard = {\n  urgent: boolean;\n',
    );
    assert.notEqual(mutated, serverTypes, 'the object mutation must apply to the in-memory copy');

    const row = ROWS.find((candidate) => candidate.typeName === 'CockpitCard');
    assert.ok(row, 'CockpitCard must be in the comparison table');
    const client = readClient(row);
    const server = readFromSource('object', mutated, 'CockpitCard');
    assert.notDeepEqual(client, server, 'adding a server-side field must fail the comparison');
    assert.match(describeDrift(row, client, server), /urgent/, 'the failure message must name the added field');
  });
});

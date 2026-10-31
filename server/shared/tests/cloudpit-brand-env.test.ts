/**
 * The Cloudpit brand criterion: the `BRAND` identity table and the
 * `CLOUDPIT_*` → `CLOUDCLI_*` environment fallback reader.
 *
 * Every leg drives the real reader with an in-memory environment; the `BRAND`
 * reading comes from the TypeScript syntax tree so a comment or a string
 * literal that merely spells a field cannot satisfy the assertion.
 *
 * Run directly:
 *   npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/cloudpit-brand-env.test.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import ts from 'typescript';

import { createBrandEnvReader } from '../brand.js';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../..');

/**
 * Read `BRAND`'s five string fields from `src/shared/constants.ts`.
 *
 * The declaration must be an object literal (possibly wrapped in `as const`)
 * of string-literal properties; anything else is a failure, not a skipped
 * reading, so a refactor cannot silently turn this criterion vacuous.
 */
function readBrandFields(): Record<string, string> {
  const filePath = path.join(REPO_ROOT, 'src/shared/constants.ts');
  const sourceFile = ts.createSourceFile(
    filePath,
    readFileSync(filePath, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );

  const fields: Record<string, string> = {};
  let declared = false;
  sourceFile.forEachChild((node) => {
    if (!ts.isVariableStatement(node)) return;
    for (const declaration of node.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== 'BRAND') continue;
      declared = true;

      let initializer = declaration.initializer;
      while (initializer && ts.isAsExpression(initializer)) initializer = initializer.expression;
      assert.ok(
        initializer && ts.isObjectLiteralExpression(initializer),
        'BRAND must be declared as an object literal',
      );

      for (const property of initializer.properties) {
        assert.ok(ts.isPropertyAssignment(property), 'every BRAND field must be a property assignment');
        assert.ok(ts.isIdentifier(property.name), 'every BRAND field name must be a bare identifier');
        assert.ok(
          ts.isStringLiteral(property.initializer),
          `BRAND.${property.name.text} must be a string literal, not a computed expression`,
        );
        fields[property.name.text] = property.initializer.text;
      }
    }
  });

  assert.ok(declared, 'src/shared/constants.ts must declare BRAND');
  return fields;
}

/** Build a reader over `env` plus the warnings it emitted, in order. */
function readWith(env: Record<string, string | undefined>) {
  const warnings: string[] = [];
  const reader = createBrandEnvReader({ env, warn: (message) => warnings.push(message) });
  return { reader, warnings };
}

test('AC1: BRAND carries the Cloudpit identity read from the syntax tree', () => {
  assert.deepEqual(readBrandFields(), {
    name: 'Cloudpit',
    shortName: 'Cloudpit',
    packageName: '@yalehwang/cloudpit',
    repository: 'yaleh/cloudpit',
    scheme: 'cloudpit',
  });
});

test('AC2 legacy-only: CLOUDCLI_X supplies the value, is marked legacy and warns once', () => {
  const { reader, warnings } = readWith({ CLOUDCLI_X: 'old' });

  assert.deepEqual(reader.read('X'), { value: 'old', source: 'legacy', key: 'CLOUDCLI_X' });
  assert.equal(warnings.length, 1, 'using the legacy spelling must warn exactly once');
});

test('AC2 new-only: CLOUDPIT_X supplies the value, is marked new and does not warn', () => {
  const { reader, warnings } = readWith({ CLOUDPIT_X: 'new' });

  assert.deepEqual(reader.read('X'), { value: 'new', source: 'new', key: 'CLOUDPIT_X' });
  assert.deepEqual(warnings, [], 'the new spelling is not deprecated');
});

test('AC2 both-set: the new spelling wins and emits no warning', () => {
  const { reader, warnings } = readWith({ CLOUDPIT_X: 'new', CLOUDCLI_X: 'old' });

  assert.deepEqual(reader.read('X'), { value: 'new', source: 'new', key: 'CLOUDPIT_X' });
  assert.deepEqual(warnings, [], 'a legacy value shadowed by the new one must not warn');
});

test('AC3 absent: neither spelling set reads absent with no value', () => {
  const { reader, warnings } = readWith({});

  const reading = reader.read('X');
  assert.equal(reading.value, undefined);
  assert.equal(reading.source, 'absent');
  assert.equal(reading.key, 'CLOUDPIT_X', 'absent reads name the canonical key to set');
  assert.deepEqual(warnings, []);
});

test('AC3 empty new value: CLOUDPIT_X="" falls back to the legacy value', () => {
  const { reader, warnings } = readWith({ CLOUDPIT_X: '', CLOUDCLI_X: 'old' });

  assert.deepEqual(reader.read('X'), { value: 'old', source: 'legacy', key: 'CLOUDCLI_X' });
  assert.equal(warnings.length, 1);
});

test('AC3 warn-once: reading the same legacy key twice on one reader warns once', () => {
  const { reader, warnings } = readWith({ CLOUDCLI_X: 'old' });

  assert.equal(reader.read('X').value, 'old');
  assert.equal(reader.read('X').value, 'old');
  assert.equal(warnings.length, 1, 'the warned-key set is per reader, not per read');
});

test('AC3 reader isolation: two readers each warn once for the same legacy key', () => {
  const first = readWith({ CLOUDCLI_X: 'old' });
  const second = readWith({ CLOUDCLI_X: 'old' });

  first.reader.read('X');
  second.reader.read('X');

  assert.equal(first.warnings.length, 1);
  assert.equal(second.warnings.length, 1);
});

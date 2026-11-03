/**
 * The Cloudpit brand criterion: the `BRAND` identity table and the v3.0
 * `CLOUDPIT_*`-only environment reader.
 *
 * Every leg drives the real reader with an in-memory environment; the `BRAND`
 * reading comes from the TypeScript syntax tree so a comment or a string
 * literal that merely spells a field cannot satisfy the assertion.
 *
 * v3.0 RETIREMENT: the reader no longer accepts the legacy `CLOUDCLI_*`
 * spelling. A legacy-only environment reads absent (and the caller's shipped
 * default applies); there is no fallback reading and no deprecation warning.
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

/** Build a reader over `env`. */
function readWith(env: Record<string, string | undefined>) {
  return createBrandEnvReader({ env });
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

test('AC2 legacy-only: CLOUDCLI_X is ignored and the read is absent', () => {
  const reader = readWith({ CLOUDCLI_X: 'old' });

  assert.deepEqual(reader.read('X'), { value: undefined, source: 'absent', key: 'CLOUDPIT_X' });
});

test('AC2 new-only: CLOUDPIT_X supplies the value and is marked new', () => {
  const reader = readWith({ CLOUDPIT_X: 'new' });

  assert.deepEqual(reader.read('X'), { value: 'new', source: 'new', key: 'CLOUDPIT_X' });
});

test('AC2 both-set: the new spelling wins and the legacy value is never consulted', () => {
  const reader = readWith({ CLOUDPIT_X: 'new', CLOUDCLI_X: 'old' });

  assert.deepEqual(reader.read('X'), { value: 'new', source: 'new', key: 'CLOUDPIT_X' });
});

test('AC3 absent: neither spelling set reads absent with no value', () => {
  const reader = readWith({});

  const reading = reader.read('X');
  assert.equal(reading.value, undefined);
  assert.equal(reading.source, 'absent');
  assert.equal(reading.key, 'CLOUDPIT_X', 'absent reads name the canonical key to set');
});

test('AC3 empty new value: CLOUDPIT_X="" reads absent and does NOT fall back to the legacy value', () => {
  const reader = readWith({ CLOUDPIT_X: '', CLOUDCLI_X: 'old' });

  assert.deepEqual(reader.read('X'), { value: undefined, source: 'absent', key: 'CLOUDPIT_X' });
});

test('AC1: neither reader source carries the legacy env spelling in code', () => {
  const sources: Array<[string, ts.ScriptKind]> = [
    ['server/shared/brand.ts', ts.ScriptKind.TS],
    ['electron/brandEnv.js', ts.ScriptKind.JS],
  ];
  for (const [relativePath, kind] of sources) {
    const filePath = path.join(REPO_ROOT, relativePath);
    const sourceFile = ts.createSourceFile(
      filePath,
      readFileSync(filePath, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
      kind,
    );
    const literals: string[] = [];
    const visit = (node: ts.Node): void => {
      if (
        ts.isStringLiteral(node)
        || ts.isNoSubstitutionTemplateLiteral(node)
        || ts.isTemplateHead(node)
        || ts.isTemplateMiddle(node)
        || ts.isTemplateTail(node)
      ) {
        literals.push(node.text);
      }
      node.forEachChild(visit);
    };
    sourceFile.forEachChild(visit);
    assert.deepEqual(
      literals.filter((literal) => literal.includes('CLOUDCLI_')),
      [],
      `${relativePath} must not build a legacy env key (comments are not evaluated)`,
    );
    assert.ok(
      literals.some((literal) => literal.includes('CLOUDPIT_')),
      `${relativePath} must still build the canonical env key`,
    );
  }
});


/**
 * Every brand name the production wiring points read (Electron main/localServer,
 * serverInstaller, browser-use service and its MCP entry) resolved through the
 * reader: the canonical spelling supplies the value, the legacy spelling is
 * ignored, and an absent pair reads absent. This pins the *names* as well as the
 * semantics, so a wiring point that invents a name the reader does not recognise
 * turns red here instead of silently reading `undefined`.
 */
const WIRED_BRAND_ENV_NAMES = [
  'CONTROL_PLANE_URL',
  'DESKTOP_LOCAL_SERVER_URL',
  'LOCAL_SERVER_URL',
  'DESKTOP_LOCAL_SERVER_PORT',
  'SERVER_PORT',
  'USE_INSTALLED_SERVER',
  'SERVER_BUNDLE_URL',
  'SERVER_BUNDLE_RELEASE_TAG',
  'SERVER_DIR',
  'BROWSER_USE_MAX_SESSIONS_PER_OWNER',
  'BROWSER_USE_SESSION_TTL_MS',
  'BROWSER_USE_INSTALL_TIMEOUT_MS',
  'BROWSER_USE_API_URL',
  'BROWSER_USE_MCP_TOKEN',
  'BROWSER_USE_API_TIMEOUT_MS',
];

test('AC3 wiring names: each brand name resolves new > absent, never legacy', () => {
  for (const name of WIRED_BRAND_ENV_NAMES) {
    const both = readWith({ [`CLOUDPIT_${name}`]: 'new', [`CLOUDCLI_${name}`]: 'old' });
    assert.deepEqual(
      both.read(name),
      { value: 'new', source: 'new', key: `CLOUDPIT_${name}` },
      `${name}: the new spelling must win`,
    );

    const legacy = readWith({ [`CLOUDCLI_${name}`]: 'old' });
    assert.deepEqual(
      legacy.read(name),
      { value: undefined, source: 'absent', key: `CLOUDPIT_${name}` },
      `${name}: the legacy spelling must no longer be read`,
    );

    const absent = readWith({});
    assert.deepEqual(
      absent.read(name),
      { value: undefined, source: 'absent', key: `CLOUDPIT_${name}` },
      `${name}: an unset pair reads absent`,
    );
  }
});

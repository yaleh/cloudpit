#!/usr/bin/env node
/**
 * The file-level dependency check for `shared/asr`: no VALUE import cycle, and the reading is
 * taken on the shipped tree rather than on a hand-written list of edges.
 *
 * WHY A DEDICATED READER. The architecture-analysis routine reported this directory as a
 * seven-file SCC with thirteen value-level edges: the registry value-imports every adapter, and
 * each adapter value-imported the registry's guard helpers back. ArchGuard's package granularity
 * aggregates the root directory into one node, so after the contract split it still sees a
 * directory-level loop through the shared root (the contract and the registry share that node).
 * The property the split actually establishes is FILE-level and VALUE-level, which is what this
 * reader measures:
 *
 *   · a node is one production `.ts` file under `shared/asr`;
 *   · an edge is a static relative import/export with at least one runtime binding. `import type`
 *     and `export type` are erased before a run, so they are counted separately and never close a
 *     value cycle (a pure type cycle is legal and is not what the seam is trying to avoid);
 *   · the graph is reduced with Tarjan SCCs; any SCC of two or more files is a cycle.
 *
 * THE EMPTY READING IS A FAILURE, NOT A PASS. A glob that matched nothing must not report "0
 * cycles": exit 3 says the directory could not be read, so "not evaluated" can never be confused
 * with "measured zero".
 *
 * Usage: node scripts/asr-import-cycle-check.mjs [--root <tree>]
 * Exit:  0 = read, no value cycle; 1 = a value cycle (each SCC printed); 3 = not evaluated.
 */

import { existsSync, globSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(SCRIPT_DIR, '..');
const SCOPE = 'shared/asr';

/** @typedef {{ from: string, to: string, line: number, kind: 'value' | 'type' }} ImportEdge */

/**
 * @param {string[]} argv
 * @returns {{ root: string }}
 */
function parseArgs(argv) {
  let root = DEFAULT_ROOT;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--root') {
      const value = argv[i + 1];
      if (value === undefined) throw new Error('--root needs a directory');
      root = path.resolve(value);
      i += 1;
    } else {
      throw new Error(`unknown argument: ${argv[i]}`);
    }
  }
  return { root };
}

/**
 * The production modules in scope, sorted, repository-relative with `/` separators.
 *
 * @param {string} root
 * @returns {string[]}
 */
function listModules(root) {
  const absolute = path.join(root, SCOPE);
  if (!existsSync(absolute)) return [];
  return globSync(`${SCOPE}/**/*.ts`, { cwd: root })
    .map((entry) => entry.split(path.sep).join('/'))
    .filter((entry) => !/\.(test|spec)\.ts$/.test(entry) && !entry.endsWith('.d.ts'))
    .sort();
}

/**
 * Whether an import/export clause names only type bindings, and is therefore erased by the
 * compiler. `import type …` / `export type …` are the obvious forms; a brace list is type-only
 * only when every named specifier carries its own `type` marker.
 *
 * @param {string} clause
 * @returns {boolean}
 */
function isTypeOnly(clause) {
  const trimmed = clause.trim();
  if (/^type[\s{]/.test(trimmed)) return true;
  const brace = /^\{([\s\S]*)\}$/.exec(trimmed);
  if (brace === null) return false;
  const named = brace[1]
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '');
  return named.length > 0 && named.every((part) => /^type\s/.test(part));
}

/**
 * The static imports/exports in one source text, with the runtime/erased distinction.
 *
 * The match is anchored at a line start, which is what keeps declarations inside block comments
 * (their lines begin with `*`) and prose out of the edge set. A multi-line import block is matched
 * whole because the clause may contain newlines.
 *
 * @param {string} source
 * @returns {{ specifier: string, line: number, kind: 'value' | 'type' }[]}
 */
function extractImports(source) {
  /** @type {{ specifier: string, line: number, kind: 'value' | 'type' }[]} */
  const found = [];
  /** @param {number} index */
  const lineOf = (index) => source.slice(0, index).split('\n').length;

  const fromImport = /(?:^|\n)[ \t]*(import|export)\b([^;]*?)from[ \t]*['"]([^'"]+)['"]/g;
  let match;
  while ((match = fromImport.exec(source)) !== null) {
    const keywordIndex = match.index + (match[0].startsWith('\n') ? 1 : 0);
    found.push({
      specifier: match[3],
      line: lineOf(keywordIndex),
      kind: isTypeOnly(match[2]) ? 'type' : 'value',
    });
  }

  const bareImport = /(?:^|\n)[ \t]*import[ \t]*['"]([^'"]+)['"]/g;
  while ((match = bareImport.exec(source)) !== null) {
    const keywordIndex = match.index + (match[0].startsWith('\n') ? 1 : 0);
    found.push({ specifier: match[1], line: lineOf(keywordIndex), kind: 'value' });
  }

  const dynamicImport = /\bimport[ \t]*\([ \t]*['"]([^'"]+)['"]/g;
  while ((match = dynamicImport.exec(source)) !== null) {
    found.push({ specifier: match[1], line: lineOf(match.index), kind: 'value' });
  }

  return found;
}

/**
 * The module a relative specifier names, or null when it leaves the scanned set.
 *
 * @param {string} from repository-relative importer
 * @param {string} specifier
 * @param {Set<string>} modules
 * @returns {string | null}
 */
function resolveSpecifier(from, specifier, modules) {
  if (!specifier.startsWith('.')) return null;
  const joined = path.posix.normalize(path.posix.join(path.posix.dirname(from), specifier));
  /** @type {string[]} */
  const candidates = [];
  if (joined.endsWith('.js')) candidates.push(`${joined.slice(0, -3)}.ts`);
  else if (joined.endsWith('.ts')) candidates.push(joined);
  else candidates.push(`${joined}.ts`, `${joined}/index.ts`);
  return candidates.find((candidate) => modules.has(candidate)) ?? null;
}

/**
 * Tarjan's strongly-connected components.
 *
 * @param {string[]} nodes
 * @param {Map<string, string[]>} adjacency
 * @returns {string[][]}
 */
function stronglyConnected(nodes, adjacency) {
  /** @type {Map<string, number>} */
  const index = new Map();
  /** @type {Map<string, number>} */
  const low = new Map();
  /** @type {string[]} */
  const stack = [];
  const onStack = new Set();
  /** @type {string[][]} */
  const components = [];
  let next = 0;

  /** @param {string} node */
  const visit = (node) => {
    index.set(node, next);
    low.set(node, next);
    next += 1;
    stack.push(node);
    onStack.add(node);

    for (const target of adjacency.get(node) ?? []) {
      if (!index.has(target)) {
        visit(target);
        low.set(node, Math.min(/** @type {number} */ (low.get(node)), /** @type {number} */ (low.get(target))));
      } else if (onStack.has(target)) {
        low.set(node, Math.min(/** @type {number} */ (low.get(node)), /** @type {number} */ (index.get(target))));
      }
    }

    if (low.get(node) !== index.get(node)) return;
    /** @type {string[]} */
    const component = [];
    let member;
    do {
      member = /** @type {string} */ (stack.pop());
      onStack.delete(member);
      component.push(member);
    } while (member !== node);
    if (component.length >= 2) components.push(component.sort());
  };

  for (const node of nodes) if (!index.has(node)) visit(node);
  return components;
}

/**
 * @param {string} root
 */
function main(root) {
  const modules = listModules(root);
  if (modules.length === 0) {
    process.stdout.write(
      `asr-import-cycle root=${root} files=0 verdict=NOT-EVALUATED reason="${SCOPE} holds no production modules"\n`,
    );
    return 3;
  }

  const moduleSet = new Set(modules);
  /** @type {ImportEdge[]} */
  const edges = [];
  for (const module of modules) {
    const source = readFileSync(path.join(root, module), 'utf8');
    for (const found of extractImports(source)) {
      const to = resolveSpecifier(module, found.specifier, moduleSet);
      if (to !== null) edges.push({ from: module, to, line: found.line, kind: found.kind });
    }
  }

  const valueEdges = edges.filter((edge) => edge.kind === 'value');
  /** @type {Map<string, string[]>} */
  const adjacency = new Map(modules.map((module) => [module, []]));
  for (const edge of valueEdges) /** @type {string[]} */ (adjacency.get(edge.from)).push(edge.to);

  const cycles = stronglyConnected(modules, adjacency);
  const maxScc = cycles.reduce((largest, component) => Math.max(largest, component.length), 0);
  const typeEdges = edges.length - valueEdges.length;

  for (const component of cycles) {
    process.stdout.write(`cycle size=${component.length} files=${component.join(',')}\n`);
    for (const edge of valueEdges) {
      if (component.includes(edge.from) && component.includes(edge.to)) {
        process.stdout.write(`  edge ${edge.from}:${edge.line} -> ${edge.to}\n`);
      }
    }
  }
  process.stdout.write(
    `asr-import-cycle root=${root} files=${modules.length} value-edges=${valueEdges.length} ` +
      `type-edges=${typeEdges} value-sccs=${cycles.length} maxScc=${maxScc} ` +
      `verdict=${cycles.length === 0 ? 'PASS' : 'FAIL'}\n`,
  );
  return cycles.length === 0 ? 0 : 1;
}

try {
  const { root } = parseArgs(process.argv.slice(2));
  process.exitCode = main(root);
} catch (error) {
  process.stderr.write(`asr-import-cycle-check: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 2;
}

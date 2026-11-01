/**
 * Two list operations the delivery arm needs on `KnowledgeUnknownField[]`, kept
 * in one place so the transcript reader and the chain reader cannot drift on
 * "add at most once" or "remove the field this reading DID establish".
 */
import type { KnowledgeUnknownField } from '@/shared/knowledge-facts.js';

/** Keeps one field name in a list at most once. */
export function pushUnknownOnce(list: KnowledgeUnknownField[], field: KnowledgeUnknownField): void {
  if (list.includes(field) === false) list.push(field);
}

/** Removes one field name from a list, if present. */
export function dropUnknown(list: KnowledgeUnknownField[], field: KnowledgeUnknownField): void {
  const index = list.indexOf(field);
  if (index !== -1) list.splice(index, 1);
}

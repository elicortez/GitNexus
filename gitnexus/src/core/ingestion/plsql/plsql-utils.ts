/**
 * PL/SQL utility functions.
 *
 * File detection, name normalization, and shared helpers.
 */
import path from 'node:path';

/** Known PL/SQL file extensions (lowercase, dot-prefixed). */
const PLSQL_EXTENSIONS = new Set([
  '.pls',
  '.pck',
  '.pks',
  '.pkb',
  '.prc',
  '.fnc',
  '.trg',
  '.typ',
  '.tps',
  '.tpb',
  '.vw',
]);

/** Returns true if the file is a PL/SQL source file by extension. */
export function isPlSqlFile(filePath: string): boolean {
  return PLSQL_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

/**
 * Heuristic: detect PL/SQL content in a `.sql` file.
 * Scans the first 50 lines for `CREATE [OR REPLACE] [EDITIONABLE|NONEDITIONABLE]
 * (PACKAGE|PROCEDURE|FUNCTION|TRIGGER|TYPE)`.
 */
const PLSQL_HEURISTIC_RE =
  /CREATE\s+(?:OR\s+REPLACE\s+)?(?:EDITIONABLE\s+|NONEDITIONABLE\s+)?(?:PACKAGE|PROCEDURE|FUNCTION|TRIGGER|TYPE)\b/i;

export function isPlSqlContent(content: string): boolean {
  const lines = content.split(/\r?\n/, 50);
  const head = lines.join('\n');
  return PLSQL_HEURISTIC_RE.test(head);
}

/**
 * Normalize a PL/SQL identifier: uppercase and strip quotes.
 * PL/SQL is case-insensitive; all identifiers are stored uppercase.
 */
export function normalizeIdentifier(name: string): string {
  return name.trim().replace(/^"|"$/g, '').toUpperCase();
}

/**
 * Build a dot-separated qualified name from optional schema, owner, and name.
 * E.g., "HR.MY_PKG.MY_PROC" or "MY_PKG.MY_PROC" or "MY_PROC".
 */
export function buildQualifiedName(parts: {
  name: string;
  schema?: string;
  owner?: string;
}): string {
  const segments: string[] = [];
  if (parts.schema) segments.push(parts.schema);
  if (parts.owner) segments.push(parts.owner);
  segments.push(parts.name);
  return segments.join('.');
}

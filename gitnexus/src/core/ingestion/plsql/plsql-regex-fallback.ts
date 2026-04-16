/**
 * PL/SQL Regex Fallback Extractor.
 *
 * Lightweight regex-based extraction for files that fail ANTLR4 parsing.
 * Extracts packages, procedures, functions, triggers, and types.
 * No call graph, no table access — just symbol declarations + DEFINES edges.
 */
import type { ExtractedSymbol, ExtractedRelation, FileExtractionResult } from './plsql-types.js';
import { normalizeIdentifier } from './plsql-utils.js';

// ── Regex patterns ────────────────────────────────────────────────────────

const PACKAGE_RE =
  /CREATE\s+(?:OR\s+REPLACE\s+)?(?:EDITIONABLE\s+|NONEDITIONABLE\s+)?PACKAGE\s+(BODY\s+)?(?:(\w+)\.)?(\w+)/gi;

const PROC_RE = /(?:PROCEDURE)\s+(\w+)\s*(?:\(|IS|AS)/gi;

const FUNC_RE = /(?:FUNCTION)\s+(\w+)\s*(?:\(|RETURN)/gi;

const TRIGGER_RE =
  /CREATE\s+(?:OR\s+REPLACE\s+)?(?:EDITIONABLE\s+|NONEDITIONABLE\s+)?TRIGGER\s+(?:(\w+)\.)?(\w+)/gi;

const TYPE_RE =
  /CREATE\s+(?:OR\s+REPLACE\s+)?(?:EDITIONABLE\s+|NONEDITIONABLE\s+)?TYPE\s+(?:BODY\s+)?(?:(\w+)\.)?(\w+)/gi;

const STANDALONE_PROC_RE =
  /CREATE\s+(?:OR\s+REPLACE\s+)?(?:EDITIONABLE\s+|NONEDITIONABLE\s+)?PROCEDURE\s+(?:(\w+)\.)?(\w+)/gi;

const STANDALONE_FUNC_RE =
  /CREATE\s+(?:OR\s+REPLACE\s+)?(?:EDITIONABLE\s+|NONEDITIONABLE\s+)?FUNCTION\s+(?:(\w+)\.)?(\w+)/gi;

// ── Extraction ────────────────────────────────────────────────────────────

/**
 * Extract PL/SQL symbols using regex patterns.
 * Used as a fallback when ANTLR4 parsing fails.
 */
export function extractWithRegex(filePath: string, content: string): FileExtractionResult {
  const symbols: ExtractedSymbol[] = [];
  const relations: ExtractedRelation[] = [];

  if (!content.trim()) {
    return { filePath, symbols, relations, parseErrors: [], usedFallback: true };
  }

  // Extract packages (CREATE PACKAGE / CREATE PACKAGE BODY)
  for (const match of content.matchAll(PACKAGE_RE)) {
    const isBody = !!match[1];
    const schema = match[2] ? normalizeIdentifier(match[2]) : undefined;
    const name = normalizeIdentifier(match[3]);
    const lineIdx = getLineNumber(content, match.index!);

    symbols.push({
      kind: isBody ? 'package_body' : 'package',
      name,
      schema,
      filePath,
      startLine: lineIdx,
      endLine: lineIdx, // regex can't determine end
    });
  }

  // Extract standalone procedures (CREATE [OR REPLACE] PROCEDURE)
  for (const match of content.matchAll(STANDALONE_PROC_RE)) {
    const schema = match[1] ? normalizeIdentifier(match[1]) : undefined;
    const name = normalizeIdentifier(match[2]);
    const lineIdx = getLineNumber(content, match.index!);

    symbols.push({
      kind: 'procedure',
      name,
      schema,
      filePath,
      startLine: lineIdx,
      endLine: lineIdx,
    });
  }

  // Extract standalone functions (CREATE [OR REPLACE] FUNCTION)
  for (const match of content.matchAll(STANDALONE_FUNC_RE)) {
    const schema = match[1] ? normalizeIdentifier(match[1]) : undefined;
    const name = normalizeIdentifier(match[2]);
    const lineIdx = getLineNumber(content, match.index!);

    symbols.push({
      kind: 'function',
      name,
      schema,
      filePath,
      startLine: lineIdx,
      endLine: lineIdx,
    });
  }

  // Extract inner procedures/functions (PROCEDURE/FUNCTION inside package bodies)
  // Only if not already captured as standalone CREATE statements
  const standaloneNames = new Set(symbols.map((s) => s.name));
  for (const match of content.matchAll(PROC_RE)) {
    const name = normalizeIdentifier(match[1]);
    if (!standaloneNames.has(name)) {
      const lineIdx = getLineNumber(content, match.index!);
      symbols.push({
        kind: 'procedure',
        name,
        filePath,
        startLine: lineIdx,
        endLine: lineIdx,
      });
    }
  }
  for (const match of content.matchAll(FUNC_RE)) {
    const name = normalizeIdentifier(match[1]);
    if (!standaloneNames.has(name)) {
      const lineIdx = getLineNumber(content, match.index!);
      symbols.push({
        kind: 'function',
        name,
        filePath,
        startLine: lineIdx,
        endLine: lineIdx,
      });
    }
  }

  // Extract triggers
  for (const match of content.matchAll(TRIGGER_RE)) {
    const schema = match[1] ? normalizeIdentifier(match[1]) : undefined;
    const name = normalizeIdentifier(match[2]);
    const lineIdx = getLineNumber(content, match.index!);

    symbols.push({
      kind: 'trigger',
      name,
      schema,
      filePath,
      startLine: lineIdx,
      endLine: lineIdx,
    });
  }

  // Extract types (but not "TYPE ... AS TABLE OF" or "TYPE ... IS RECORD" inline)
  for (const match of content.matchAll(TYPE_RE)) {
    const schema = match[1] ? normalizeIdentifier(match[1]) : undefined;
    const name = normalizeIdentifier(match[2]);
    const lineIdx = getLineNumber(content, match.index!);

    symbols.push({
      kind: 'type',
      name,
      schema,
      filePath,
      startLine: lineIdx,
      endLine: lineIdx,
    });
  }

  // Create DEFINES relation for each symbol
  for (const sym of symbols) {
    relations.push({
      kind: 'DEFINES',
      sourceName: filePath,
      targetName: sym.name,
    });
  }

  return { filePath, symbols, relations, parseErrors: [], usedFallback: true };
}

/** Convert a character offset to a 1-based line number. */
function getLineNumber(content: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < content.length; i++) {
    if (content[i] === '\n') line++;
  }
  return line;
}

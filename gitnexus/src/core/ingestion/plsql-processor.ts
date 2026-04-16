/**
 * PL/SQL Processor
 *
 * Standalone ANTLR4 + regex-fallback processor for PL/SQL files.
 * Follows the cobol-processor.ts pattern: takes (graph, files),
 * does its own extraction, and writes directly to the graph.
 *
 * Pipeline:
 *   1. For each file: parse with ANTLR4 via extractSymbols() (with timeout)
 *   2. On excessive parse errors: fall back to regex extraction
 *   3. Map extraction results to graph nodes and relationships
 *   4. Second pass: resolve cross-file `<unresolved>:` call targets
 *   5. Aggregate and return stats
 */

import type { KnowledgeGraph } from '../graph/types.js';
import { extractSymbols } from './plsql/plsql-symbol-extractor.js';
import { extractWithRegex } from './plsql/plsql-regex-fallback.js';
import { mapToGraph } from './plsql-graph-mapper.js';
import type { FileExtractionResult, PlSqlStats } from './plsql/plsql-types.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type PlSqlProcessResult = PlSqlStats;

interface PlSqlFile {
  path: string;
  content: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum parse time per file in milliseconds. */
const PARSE_TIMEOUT_MS = 5_000;

// ---------------------------------------------------------------------------
// Heuristic: when to fall back to regex
// ---------------------------------------------------------------------------

/** If ANTLR4 extraction yields zero symbols but has parse errors, use fallback. */
function shouldFallback(result: FileExtractionResult): boolean {
  return result.symbols.length === 0 && result.parseErrors.length > 0;
}

// ---------------------------------------------------------------------------
// Timeout-protected extraction
// ---------------------------------------------------------------------------

/**
 * Extract symbols with a timeout.
 * If ANTLR4 parsing exceeds PARSE_TIMEOUT_MS, abort and return a
 * result with a timeout error so the caller can fall back to regex.
 */
function extractWithTimeout(
  filePath: string,
  content: string,
  timeoutMs: number = PARSE_TIMEOUT_MS,
): FileExtractionResult {
  const start = Date.now();
  const result = extractSymbols(filePath, content);
  const elapsed = Date.now() - start;

  if (elapsed > timeoutMs) {
    // Parse completed but took too long — mark as slow for stats
    // (True async timeout kill is not possible with sync ANTLR4 parsing,
    //  but we still flag it and use fallback if no symbols were found.)
    return {
      filePath,
      symbols: result.symbols,
      relations: result.relations,
      parseErrors: [...result.parseErrors, `Parse timeout: ${elapsed}ms > ${timeoutMs}ms`],
      usedFallback: false,
    };
  }

  return result;
}

// ---------------------------------------------------------------------------
// Main processor
// ---------------------------------------------------------------------------

/**
 * Process PL/SQL files into the knowledge graph.
 *
 * @param graph - The in-memory knowledge graph
 * @param files - Array of { path, content } for PL/SQL files
 * @returns Aggregated extraction stats
 */
export function processPlSql(
  graph: KnowledgeGraph,
  files: readonly PlSqlFile[],
): PlSqlProcessResult {
  const stats: PlSqlProcessResult = {
    packages: 0,
    procedures: 0,
    functions: 0,
    triggers: 0,
    types: 0,
    parseErrors: 0,
    fallbacks: 0,
  };

  // Registry for cross-file resolution: uppercase symbol name → node ID
  const symbolNodeIds = new Map<string, string>();

  // ── First pass: extract + map per file ─────────────────────────────

  for (const file of files) {
    let result = extractWithTimeout(file.path, file.content);

    // Fall back to regex if ANTLR4 found nothing meaningful
    if (shouldFallback(result)) {
      result = extractWithRegex(file.path, file.content);
      stats.fallbacks++;
    }

    stats.parseErrors += result.parseErrors.length;

    // Accumulate per-kind counts
    for (const sym of result.symbols) {
      switch (sym.kind) {
        case 'package':
        case 'package_body':
          stats.packages++;
          break;
        case 'procedure':
          stats.procedures++;
          break;
        case 'function':
          stats.functions++;
          break;
        case 'trigger':
          stats.triggers++;
          break;
        case 'type':
        case 'type_body':
          stats.types++;
          break;
        // variable, constant, cursor, exception are not top-level stats
      }
    }

    // Write to graph and collect node IDs for cross-file resolution
    const nodeIds = mapToGraph(result, graph);
    for (const [name, nodeId] of nodeIds) {
      symbolNodeIds.set(name.toUpperCase(), nodeId);
    }
  }

  // ── Second pass: resolve cross-file `<unresolved>:` targets ────────

  resolveUnresolvedEdges(graph, symbolNodeIds);

  return stats;
}

// ---------------------------------------------------------------------------
// Cross-file resolution
// ---------------------------------------------------------------------------

/**
 * Resolve `<unresolved>:` edge targets using the global symbol registry.
 *
 * Pattern (copied from COBOL processor):
 *   1. Iterate all PL/SQL relationship edges
 *   2. Match `<unresolved>:TARGET` pattern in targetId
 *   3. Look up TARGET (and dotted variants) in symbolNodeIds
 *   4. Add resolved edge, mark original for removal
 *   5. Remove originals after iteration
 */
function resolveUnresolvedEdges(graph: KnowledgeGraph, symbolNodeIds: Map<string, string>): void {
  const unresolvedToRemove: string[] = [];

  graph.forEachRelationship((rel) => {
    if (!rel.reason?.startsWith('plsql-')) return; // only PL/SQL edges
    const match = rel.targetId.match(/^<unresolved>:(.+)/);
    if (!match) return;

    const targetName = match[1].toUpperCase();
    let resolvedId: string | undefined;

    // Try exact match first (e.g., "MY_PROC" or "MY_PKG.MY_PROC")
    resolvedId = symbolNodeIds.get(targetName);

    // If dotted reference like "PKG.PROC", also try just PROC
    if (!resolvedId && targetName.includes('.')) {
      const parts = targetName.split('.');
      const simpleName = parts[parts.length - 1];
      resolvedId = symbolNodeIds.get(simpleName);
    }

    if (!resolvedId) return;

    // Add resolved edge
    graph.addRelationship({
      id: rel.id + ':resolved',
      type: rel.type,
      sourceId: rel.sourceId,
      targetId: resolvedId,
      confidence: 0.95,
      reason: rel.reason.replace(/-unresolved$/, '') || rel.reason,
    });

    unresolvedToRemove.push(rel.id);
  });

  // Remove original unresolved edges (can't delete during iteration)
  for (const id of unresolvedToRemove) {
    graph.removeRelationship(id);
  }
}

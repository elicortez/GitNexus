/**
 * PL/SQL Graph Mapper
 *
 * Converts FileExtractionResult (symbols + relations) into GraphNode[]
 * and GraphRelationship[] on the KnowledgeGraph.
 *
 * Label mapping:
 *   - package / package_body  → Class
 *   - procedure (standalone)  → Function
 *   - function  (standalone)  → Function
 *   - procedure / function with owner → Method
 *   - trigger                 → Function
 *   - variable / constant / cursor / exception → Property
 *   - type / type_body        → Type
 */

import { SupportedLanguages } from 'gitnexus-shared';
import type { NodeLabel } from 'gitnexus-shared';
import { generateId } from '../../lib/utils.js';
import type { KnowledgeGraph } from '../graph/types.js';
import type {
  FileExtractionResult,
  ExtractedSymbol,
  PlSqlSymbolKind,
  PlSqlRelationKind,
} from './plsql/plsql-types.js';

// ── Label resolution ─────────────────────────────────────────────────

const KIND_TO_LABEL: Record<PlSqlSymbolKind, NodeLabel> = {
  package: 'Class',
  package_body: 'Class',
  procedure: 'Function', // overridden to Method when owner is set
  function: 'Function',
  trigger: 'Function',
  type: 'Type',
  type_body: 'Type',
  variable: 'Property',
  constant: 'Property',
  cursor: 'Property',
  exception: 'Property',
};

function labelFor(sym: ExtractedSymbol): NodeLabel {
  if ((sym.kind === 'procedure' || sym.kind === 'function') && sym.owner) {
    return 'Method';
  }
  return KIND_TO_LABEL[sym.kind];
}

// ── Relation type mapping ────────────────────────────────────────────

const RELATION_KIND_TO_TYPE: Record<PlSqlRelationKind, string> = {
  CALLS: 'CALLS',
  ACCESSES: 'ACCESSES',
  CONTAINS: 'CONTAINS',
  HAS_METHOD: 'HAS_METHOD',
  HAS_PROPERTY: 'HAS_PROPERTY',
  EXTENDS: 'EXTENDS',
  DEFINES: 'DEFINES',
};

// ── Description helpers ──────────────────────────────────────────────

function buildDescription(sym: ExtractedSymbol): string | undefined {
  const parts: string[] = [];
  if (sym.returnType) parts.push(`returns ${sym.returnType}`);
  if (sym.params && sym.params.length > 0) {
    parts.push(`params: ${sym.params.map((p) => `${p.name} ${p.mode} ${p.type}`).join(', ')}`);
  }
  return parts.length > 0 ? parts.join('; ') : undefined;
}

// ── Node ID ──────────────────────────────────────────────────────────

function nodeIdFor(label: NodeLabel, sym: ExtractedSymbol): string {
  const qualifiedName = sym.owner ? `${sym.owner}.${sym.name}` : sym.name;
  return generateId(label, `${sym.filePath}:${qualifiedName}`);
}

// ── Public API ───────────────────────────────────────────────────────

/**
 * Map a single-file extraction result into the KnowledgeGraph.
 *
 * Creates one GraphNode per symbol and one GraphRelationship per relation.
 * Returns a name → nodeId map for cross-file resolution.
 */
export function mapToGraph(
  result: FileExtractionResult,
  graph: KnowledgeGraph,
): Map<string, string> {
  // Build name → nodeId lookup for relation resolution
  const nameToNodeId = new Map<string, string>();

  // ── Nodes ────────────────────────────────────────────────────────
  for (const sym of result.symbols) {
    const label = labelFor(sym);
    const nodeId = nodeIdFor(label, sym);
    nameToNodeId.set(sym.name, nodeId);
    if (sym.owner) {
      nameToNodeId.set(`${sym.owner}.${sym.name}`, nodeId);
    }

    graph.addNode({
      id: nodeId,
      label,
      properties: {
        name: sym.name,
        filePath: sym.filePath,
        startLine: sym.startLine,
        endLine: sym.endLine,
        language: SupportedLanguages.PlSql,
        isExported: !sym.isPrivate,
        description: buildDescription(sym),
      },
    });
  }

  // ── Relationships ────────────────────────────────────────────────
  for (const rel of result.relations) {
    const sourceId = nameToNodeId.get(rel.sourceName);
    if (!sourceId) continue; // source not in this file

    // Target may be in this file or cross-file (unresolved)
    const targetId = nameToNodeId.get(rel.targetName) ?? `<unresolved>:${rel.targetName}`;
    const relType = RELATION_KIND_TO_TYPE[rel.kind] ?? rel.kind;

    graph.addRelationship({
      id: generateId(relType, `${sourceId}->${targetId}`),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      type: relType as any,
      sourceId,
      targetId,
      confidence: 1.0,
      reason: `plsql-${rel.kind.toLowerCase()}`,
    });
  }

  return nameToNodeId;
}

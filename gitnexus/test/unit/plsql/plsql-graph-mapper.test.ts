/**
 * TDD: PL/SQL graph mapper tests.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { mapToGraph } from '../../../src/core/ingestion/plsql-graph-mapper.js';
import type { FileExtractionResult } from '../../../src/core/ingestion/plsql/plsql-types.js';
import type { GraphNode, GraphRelationship } from 'gitnexus-shared';

// Minimal mock graph
function createMockGraph() {
  const nodes: GraphNode[] = [];
  const rels: GraphRelationship[] = [];
  return {
    nodes,
    relationships: rels,
    addNode: (n: GraphNode) => nodes.push(n),
    addRelationship: (r: GraphRelationship) => rels.push(r),
    getNode: (id: string) => nodes.find((n) => n.id === id),
    nodeCount: 0,
    relationshipCount: 0,
    iterNodes: function* () {
      yield* nodes;
    },
    iterRelationships: function* () {
      yield* rels;
    },
    forEachNode: (fn: any) => nodes.forEach(fn),
    forEachRelationship: (fn: any) => rels.forEach(fn),
    removeNode: () => false,
    removeNodesByFile: () => 0,
    removeRelationship: () => false,
  };
}

describe('mapToGraph', () => {
  let graph: ReturnType<typeof createMockGraph>;

  beforeEach(() => {
    graph = createMockGraph();
  });

  it('maps a standalone procedure to a Function node', () => {
    const result: FileExtractionResult = {
      filePath: 'src/my_proc.prc',
      symbols: [
        {
          kind: 'procedure',
          name: 'MY_PROC',
          filePath: 'src/my_proc.prc',
          startLine: 1,
          endLine: 10,
          params: [{ name: 'P_ID', type: 'NUMBER', mode: 'IN' }],
        },
      ],
      relations: [],
      parseErrors: [],
      usedFallback: false,
    };

    mapToGraph(result, graph as any);

    expect(graph.nodes).toHaveLength(1);
    expect(graph.nodes[0].label).toBe('Function');
    expect(graph.nodes[0].properties.name).toBe('MY_PROC');
    expect(graph.nodes[0].properties.filePath).toBe('src/my_proc.prc');
    expect(graph.nodes[0].properties.startLine).toBe(1);
    expect(graph.nodes[0].properties.endLine).toBe(10);
    expect(graph.nodes[0].properties.language).toBe('plsql');
    expect(graph.nodes[0].properties.isExported).toBe(true);
  });

  it('maps a package to a Class node', () => {
    const result: FileExtractionResult = {
      filePath: 'src/my_pkg.pks',
      symbols: [
        {
          kind: 'package',
          name: 'MY_PKG',
          filePath: 'src/my_pkg.pks',
          startLine: 1,
          endLine: 20,
        },
      ],
      relations: [],
      parseErrors: [],
      usedFallback: false,
    };

    mapToGraph(result, graph as any);

    expect(graph.nodes).toHaveLength(1);
    expect(graph.nodes[0].label).toBe('Class');
    expect(graph.nodes[0].properties.name).toBe('MY_PKG');
  });

  it('maps a function to a Function node with description', () => {
    const result: FileExtractionResult = {
      filePath: 'src/my_func.fnc',
      symbols: [
        {
          kind: 'function',
          name: 'GET_TOTAL',
          filePath: 'src/my_func.fnc',
          startLine: 1,
          endLine: 10,
          params: [{ name: 'P_ID', type: 'NUMBER', mode: 'IN' }],
          returnType: 'NUMBER',
        },
      ],
      relations: [],
      parseErrors: [],
      usedFallback: false,
    };

    mapToGraph(result, graph as any);

    expect(graph.nodes[0].label).toBe('Function');
    expect(graph.nodes[0].properties.description).toContain('NUMBER');
  });

  it('maps CALLS relations to graph relationships', () => {
    const result: FileExtractionResult = {
      filePath: 'src/caller.prc',
      symbols: [
        { kind: 'procedure', name: 'CALLER', filePath: 'src/caller.prc', startLine: 1, endLine: 5 },
        {
          kind: 'procedure',
          name: 'CALLEE',
          filePath: 'src/caller.prc',
          startLine: 6,
          endLine: 10,
        },
      ],
      relations: [{ kind: 'CALLS', sourceName: 'CALLER', targetName: 'CALLEE' }],
      parseErrors: [],
      usedFallback: false,
    };

    mapToGraph(result, graph as any);

    const callRels = graph.relationships.filter((r) => r.type === 'CALLS');
    expect(callRels).toHaveLength(1);
  });

  it('maps CONTAINS relations to graph relationships', () => {
    const result: FileExtractionResult = {
      filePath: 'src/pkg.pkb',
      symbols: [
        {
          kind: 'package_body',
          name: 'MY_PKG',
          filePath: 'src/pkg.pkb',
          startLine: 1,
          endLine: 30,
        },
        {
          kind: 'procedure',
          name: 'DO_STUFF',
          owner: 'MY_PKG',
          filePath: 'src/pkg.pkb',
          startLine: 3,
          endLine: 10,
        },
      ],
      relations: [{ kind: 'CONTAINS', sourceName: 'MY_PKG', targetName: 'DO_STUFF' }],
      parseErrors: [],
      usedFallback: false,
    };

    mapToGraph(result, graph as any);

    const containsRels = graph.relationships.filter((r) => r.type === 'CONTAINS');
    expect(containsRels).toHaveLength(1);
  });

  it('maps ACCESSES relations to graph relationships', () => {
    const result: FileExtractionResult = {
      filePath: 'src/proc.prc',
      symbols: [
        { kind: 'procedure', name: 'MY_PROC', filePath: 'src/proc.prc', startLine: 1, endLine: 10 },
      ],
      relations: [{ kind: 'ACCESSES', sourceName: 'MY_PROC', targetName: 'EMPLOYEES' }],
      parseErrors: [],
      usedFallback: false,
    };

    mapToGraph(result, graph as any);

    const accessRels = graph.relationships.filter((r) => r.type === 'ACCESSES');
    expect(accessRels).toHaveLength(1);
  });

  it('maps a trigger to a Function node', () => {
    const result: FileExtractionResult = {
      filePath: 'src/trg.trg',
      symbols: [
        {
          kind: 'trigger',
          name: 'TRG_AUDIT',
          filePath: 'src/trg.trg',
          startLine: 1,
          endLine: 8,
        },
      ],
      relations: [],
      parseErrors: [],
      usedFallback: false,
    };

    mapToGraph(result, graph as any);

    expect(graph.nodes[0].label).toBe('Function');
    expect(graph.nodes[0].properties.name).toBe('TRG_AUDIT');
  });
});

/**
 * Milestone 4+5 tests: cross-file resolution, timeout, .sql heuristic, edge cases.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { processPlSql } from '../../../src/core/ingestion/plsql-processor.js';
import { isPlSqlContent } from '../../../src/core/ingestion/plsql/plsql-utils.js';
import type { GraphNode, GraphRelationship } from 'gitnexus-shared';

// ------------------------------------------------------------------
// Mock graph with full KnowledgeGraph interface
// ------------------------------------------------------------------
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
    removeRelationship: (id: string) => {
      const idx = rels.findIndex((r) => r.id === id);
      if (idx >= 0) {
        rels.splice(idx, 1);
        return true;
      }
      return false;
    },
  };
}

// ------------------------------------------------------------------
// Fixtures for cross-file resolution
// ------------------------------------------------------------------
const PKG_SPEC = `
CREATE OR REPLACE PACKAGE pricing_engine AS
  FUNCTION calculate_total(p_items IN NUMBER) RETURN NUMBER;
END pricing_engine;
/
`.trim();

const PKG_BODY = `
CREATE OR REPLACE PACKAGE BODY pricing_engine AS
  FUNCTION calculate_total(p_items IN NUMBER) RETURN NUMBER AS
  BEGIN
    RETURN p_items * 10;
  END calculate_total;
END pricing_engine;
/
`.trim();

const CALLER_PROC = `
CREATE OR REPLACE PROCEDURE submit_order (
  p_order_id IN NUMBER
) AS
  v_total NUMBER;
BEGIN
  v_total := pricing_engine.calculate_total(p_order_id);
  INSERT INTO orders (order_id, total) VALUES (p_order_id, v_total);
END submit_order;
/
`.trim();

const NOTIFICATION_PKG = `
CREATE OR REPLACE PACKAGE notification_pkg AS
  PROCEDURE send_confirmation(p_customer_id IN NUMBER, p_order_id IN NUMBER);
END notification_pkg;
/
`.trim();

// ------------------------------------------------------------------
// Milestone 4: Cross-file resolution tests
// ------------------------------------------------------------------
describe('Milestone 4: Cross-file resolution', () => {
  let graph: ReturnType<typeof createMockGraph>;

  beforeEach(() => {
    graph = createMockGraph();
  });

  it('resolves cross-package CALLS edges after processing multiple files', () => {
    const files = [
      { path: 'db/pricing_engine.pks', content: PKG_SPEC },
      { path: 'db/pricing_engine.pkb', content: PKG_BODY },
      { path: 'db/submit_order.prc', content: CALLER_PROC },
    ];
    processPlSql(graph as any, files);

    // Find the CALLS edge from submit_order → pricing_engine.calculate_total
    const callsEdges = graph.relationships.filter((r) => r.type === 'CALLS');
    expect(callsEdges.length).toBeGreaterThanOrEqual(1);

    // No unresolved edges should remain for targets that exist in the graph
    const unresolvedEdges = graph.relationships.filter((r) =>
      r.targetId.startsWith('<unresolved>:'),
    );
    // The only unresolved should be things truly not in our files
    for (const edge of unresolvedEdges) {
      const targetName = edge.targetId.replace('<unresolved>:', '').toUpperCase();
      // Should not be CALCULATE_TOTAL or PRICING_ENGINE.CALCULATE_TOTAL
      expect(targetName).not.toContain('CALCULATE_TOTAL');
    }
  });

  it('resolves dotted cross-package calls (PKG.PROC → PROC node)', () => {
    const files = [
      { path: 'db/pricing_engine.pks', content: PKG_SPEC },
      { path: 'db/pricing_engine.pkb', content: PKG_BODY },
      { path: 'db/submit_order.prc', content: CALLER_PROC },
    ];
    processPlSql(graph as any, files);

    // After resolution, there should be a resolved CALLS edge
    const resolvedCalls = graph.relationships.filter(
      (r) =>
        r.type === 'CALLS' && r.reason === 'plsql-calls' && !r.targetId.startsWith('<unresolved>'),
    );
    expect(resolvedCalls.length).toBeGreaterThanOrEqual(1);
  });

  it('links package spec and body nodes for the same package', () => {
    const files = [
      { path: 'db/pricing_engine.pks', content: PKG_SPEC },
      { path: 'db/pricing_engine.pkb', content: PKG_BODY },
    ];
    processPlSql(graph as any, files);

    // Both spec and body should create Class nodes
    const pkgNodes = graph.nodes.filter(
      (n) => n.label === 'Class' && n.properties.name === 'PRICING_ENGINE',
    );
    expect(pkgNodes.length).toBe(2); // spec + body
  });

  it('creates ACCESSES edges for DML table references', () => {
    const files = [{ path: 'db/submit_order.prc', content: CALLER_PROC }];
    processPlSql(graph as any, files);

    const accessEdges = graph.relationships.filter((r) => r.type === 'ACCESSES');
    expect(accessEdges.length).toBeGreaterThanOrEqual(1);

    // Should access ORDERS table
    const ordersAccess = accessEdges.find(
      (r) => r.targetId.includes('ORDERS') || r.targetId.includes('<unresolved>:ORDERS'),
    );
    expect(ordersAccess).toBeDefined();
  });

  it('handles multiple packages calling each other', () => {
    const files = [
      { path: 'db/pricing_engine.pks', content: PKG_SPEC },
      { path: 'db/pricing_engine.pkb', content: PKG_BODY },
      { path: 'db/notification.pks', content: NOTIFICATION_PKG },
      { path: 'db/submit_order.prc', content: CALLER_PROC },
    ];
    const result = processPlSql(graph as any, files);

    // Should have packages + procedures
    expect(result.packages).toBeGreaterThanOrEqual(2);
    expect(result.procedures).toBeGreaterThanOrEqual(1);
    expect(graph.nodes.length).toBeGreaterThanOrEqual(4);
  });

  it('node IDs are deterministic across runs', () => {
    const files = [
      { path: 'db/pricing_engine.pks', content: PKG_SPEC },
      { path: 'db/submit_order.prc', content: CALLER_PROC },
    ];

    processPlSql(graph as any, files);
    const firstRunNodes = graph.nodes.map((n) => n.id).sort();

    // Reset
    graph.nodes.length = 0;
    graph.relationships.length = 0;
    processPlSql(graph as any, files);
    const secondRunNodes = graph.nodes.map((n) => n.id).sort();

    expect(firstRunNodes).toEqual(secondRunNodes);
  });
});

// ------------------------------------------------------------------
// Milestone 5: .sql heuristic detection
// ------------------------------------------------------------------
describe('Milestone 5: isPlSqlContent heuristic', () => {
  it('detects CREATE OR REPLACE PACKAGE', () => {
    expect(isPlSqlContent('CREATE OR REPLACE PACKAGE my_pkg AS\nEND my_pkg;\n/')).toBe(true);
  });

  it('detects CREATE PROCEDURE', () => {
    expect(isPlSqlContent('CREATE PROCEDURE my_proc AS\nBEGIN\n  NULL;\nEND;\n/')).toBe(true);
  });

  it('detects CREATE OR REPLACE FUNCTION', () => {
    expect(
      isPlSqlContent(
        'CREATE OR REPLACE FUNCTION my_func RETURN NUMBER AS\nBEGIN\n  RETURN 1;\nEND;\n/',
      ),
    ).toBe(true);
  });

  it('detects CREATE TRIGGER', () => {
    expect(
      isPlSqlContent(
        'CREATE OR REPLACE TRIGGER trg_audit\nBEFORE INSERT ON orders\nBEGIN NULL; END;\n/',
      ),
    ).toBe(true);
  });

  it('detects EDITIONABLE PACKAGE', () => {
    expect(isPlSqlContent('CREATE OR REPLACE EDITIONABLE PACKAGE my_pkg AS\nEND;\n/')).toBe(true);
  });

  it('detects NONEDITIONABLE PACKAGE', () => {
    expect(isPlSqlContent('CREATE OR REPLACE NONEDITIONABLE PACKAGE BODY my_pkg AS\nEND;\n/')).toBe(
      true,
    );
  });

  it('does NOT detect plain DDL (CREATE TABLE)', () => {
    expect(isPlSqlContent('CREATE TABLE employees (\n  id NUMBER,\n  name VARCHAR2(100)\n);')).toBe(
      false,
    );
  });

  it('does NOT detect plain SELECT', () => {
    expect(isPlSqlContent('SELECT * FROM employees WHERE id = 1;')).toBe(false);
  });

  it('does NOT detect INSERT', () => {
    expect(isPlSqlContent("INSERT INTO employees (id, name) VALUES (1, 'test');")).toBe(false);
  });

  it('detects PL/SQL even with leading comments', () => {
    const content = `-- Migration script
-- Author: dev
-- Date: 2024-01-01

CREATE OR REPLACE PROCEDURE cleanup AS
BEGIN
  DELETE FROM temp_data;
END;
/`;
    expect(isPlSqlContent(content)).toBe(true);
  });

  it('only scans first 50 lines', () => {
    // Put CREATE PROCEDURE after line 50 — should NOT detect
    const padding = Array(55).fill('-- comment line').join('\n');
    const content = padding + '\nCREATE PROCEDURE late_proc AS\nBEGIN NULL; END;';
    expect(isPlSqlContent(content)).toBe(false);
  });
});

// ------------------------------------------------------------------
// Milestone 5: Edge cases and hardening
// ------------------------------------------------------------------
describe('Milestone 5: Hardening edge cases', () => {
  let graph: ReturnType<typeof createMockGraph>;

  beforeEach(() => {
    graph = createMockGraph();
  });

  it('handles empty file content without crashing', () => {
    const files = [{ path: 'db/empty.prc', content: '' }];
    const result = processPlSql(graph as any, files);
    expect(result.procedures).toBe(0);
    expect(graph.nodes.length).toBe(0);
  });

  it('handles whitespace-only file', () => {
    const files = [{ path: 'db/ws.prc', content: '   \n  \n  ' }];
    const result = processPlSql(graph as any, files);
    expect(result.procedures).toBe(0);
  });

  it('handles file with only a comment', () => {
    const files = [{ path: 'db/comment.prc', content: '-- just a comment\n-- nothing here\n' }];
    const result = processPlSql(graph as any, files);
    // Should not crash
    expect(result.parseErrors).toBeGreaterThanOrEqual(0);
  });

  it('handles file with only a forward slash', () => {
    const files = [{ path: 'db/slash.prc', content: '/\n' }];
    const result = processPlSql(graph as any, files);
    expect(result.procedures).toBe(0);
  });

  it('handles severely malformed PL/SQL gracefully', () => {
    const garbage = 'CREATE OR REPLACE PACKAGE\n{{{BAD SYNTAX}}}\nEND\n/';
    const files = [{ path: 'db/garbage.pks', content: garbage }];
    const result = processPlSql(graph as any, files);
    // Should not throw — may use fallback
    expect(result.fallbacks + result.parseErrors).toBeGreaterThanOrEqual(0);
  });

  it('handles binary-like content without crashing', () => {
    const binary = '\x00\x01\x02\x03\x04CREATE PROCEDURE hidden AS BEGIN NULL; END;';
    const files = [{ path: 'db/binary.prc', content: binary }];
    // Should not throw
    const result = processPlSql(graph as any, files);
    expect(result).toBeDefined();
  });

  it('processes a very large number of files without error', () => {
    const template = `CREATE OR REPLACE PROCEDURE proc_NUM AS BEGIN NULL; END proc_NUM;\n/`;
    const files = Array.from({ length: 50 }, (_, i) => ({
      path: `db/proc_${i}.prc`,
      content: template.replace(/NUM/g, String(i)),
    }));
    const result = processPlSql(graph as any, files);
    expect(result.procedures).toBe(50);
    expect(graph.nodes.length).toBe(50);
  });
});

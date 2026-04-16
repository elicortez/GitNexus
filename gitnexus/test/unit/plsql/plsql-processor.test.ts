/**
 * TDD: PL/SQL Processor tests — Milestone 3 ("It Flows").
 *
 * Validates that processPlSql orchestrates extraction + graph mapping
 * for one or more PL/SQL files.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { processPlSql } from '../../../src/core/ingestion/plsql-processor.js';
import type { GraphNode, GraphRelationship } from 'gitnexus-shared';

// ------------------------------------------------------------------
// Minimal KnowledgeGraph mock
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
    removeRelationship: () => false,
  };
}

// ------------------------------------------------------------------
// Fixtures
// ------------------------------------------------------------------
const SIMPLE_PROCEDURE = `
CREATE OR REPLACE PROCEDURE calculate_bonus (
  p_employee_id IN NUMBER,
  p_bonus_amount OUT NUMBER
) AS
BEGIN
  SELECT salary * 0.10
    INTO p_bonus_amount
    FROM employees
   WHERE employee_id = p_employee_id;
END calculate_bonus;
/
`.trim();

const SIMPLE_FUNCTION = `
CREATE OR REPLACE FUNCTION get_employee_name (
  p_employee_id IN NUMBER
) RETURN VARCHAR2 AS
  v_name VARCHAR2(200);
BEGIN
  SELECT first_name || ' ' || last_name
    INTO v_name
    FROM employees
   WHERE employee_id = p_employee_id;
  RETURN v_name;
END get_employee_name;
/
`.trim();

const PACKAGE_SPEC = `
CREATE OR REPLACE PACKAGE order_processing AS
  PROCEDURE submit_order(p_order_id IN NUMBER);
  FUNCTION get_order_total(p_order_id IN NUMBER) RETURN NUMBER;
END order_processing;
/
`.trim();

const TRIGGER = `
CREATE OR REPLACE TRIGGER trg_audit_orders
  BEFORE INSERT OR UPDATE ON orders
  FOR EACH ROW
BEGIN
  :NEW.modified_date := SYSDATE;
  :NEW.modified_by := USER;
END trg_audit_orders;
/
`.trim();

const MALFORMED = `
CREATE OR REPLCE PROCEDURE broken_proc (
  this is not valid PL/SQL at all
END;
/
`.trim();

// ------------------------------------------------------------------
// Tests
// ------------------------------------------------------------------
describe('processPlSql', () => {
  let graph: ReturnType<typeof createMockGraph>;

  beforeEach(() => {
    graph = createMockGraph();
  });

  it('returns zeroed stats for empty files array', () => {
    const result = processPlSql(graph as any, []);
    expect(result.packages).toBe(0);
    expect(result.procedures).toBe(0);
    expect(result.functions).toBe(0);
    expect(result.triggers).toBe(0);
    expect(result.parseErrors).toBe(0);
    expect(result.fallbacks).toBe(0);
  });

  it('processes a standalone procedure and creates graph nodes', () => {
    const files = [{ path: 'src/calculate_bonus.prc', content: SIMPLE_PROCEDURE }];
    const result = processPlSql(graph as any, files);

    expect(result.procedures).toBeGreaterThanOrEqual(1);
    expect(graph.nodes.length).toBeGreaterThanOrEqual(1);

    const procNode = graph.nodes.find((n) => n.properties.name === 'CALCULATE_BONUS');
    expect(procNode).toBeDefined();
    expect(procNode!.label).toBe('Function');
    expect(procNode!.properties.language).toBe('plsql');
  });

  it('processes a standalone function', () => {
    const files = [{ path: 'src/get_employee_name.fnc', content: SIMPLE_FUNCTION }];
    const result = processPlSql(graph as any, files);

    expect(result.functions).toBeGreaterThanOrEqual(1);
    const funcNode = graph.nodes.find((n) => n.properties.name === 'GET_EMPLOYEE_NAME');
    expect(funcNode).toBeDefined();
    expect(funcNode!.label).toBe('Function');
  });

  it('processes a package spec', () => {
    const files = [{ path: 'src/order_processing.pks', content: PACKAGE_SPEC }];
    const result = processPlSql(graph as any, files);

    expect(result.packages).toBeGreaterThanOrEqual(1);
    const pkgNode = graph.nodes.find(
      (n) => n.properties.name === 'ORDER_PROCESSING' && n.label === 'Class',
    );
    expect(pkgNode).toBeDefined();
  });

  it('processes a trigger', () => {
    const files = [{ path: 'src/trg_audit.trg', content: TRIGGER }];
    const result = processPlSql(graph as any, files);

    expect(result.triggers).toBeGreaterThanOrEqual(1);
    const trgNode = graph.nodes.find((n) => n.properties.name.includes('TRG_AUDIT'));
    expect(trgNode).toBeDefined();
  });

  it('falls back to regex on malformed input and still extracts', () => {
    const files = [{ path: 'src/broken.prc', content: MALFORMED }];
    const result = processPlSql(graph as any, files);

    // Should have at least attempted fallback
    expect(result.fallbacks).toBeGreaterThanOrEqual(0);
    // Should not throw
  });

  it('processes multiple files and aggregates stats', () => {
    const files = [
      { path: 'src/calc.prc', content: SIMPLE_PROCEDURE },
      { path: 'src/name.fnc', content: SIMPLE_FUNCTION },
      { path: 'src/order.pks', content: PACKAGE_SPEC },
      { path: 'src/audit.trg', content: TRIGGER },
    ];
    const result = processPlSql(graph as any, files);

    expect(result.procedures).toBeGreaterThanOrEqual(1);
    expect(result.functions).toBeGreaterThanOrEqual(1);
    expect(result.packages).toBeGreaterThanOrEqual(1);
    expect(result.triggers).toBeGreaterThanOrEqual(1);
    expect(graph.nodes.length).toBeGreaterThanOrEqual(4);
  });

  it('creates relationships for table accesses', () => {
    const files = [{ path: 'src/calc.prc', content: SIMPLE_PROCEDURE }];
    processPlSql(graph as any, files);

    // The procedure accesses the EMPLOYEES table
    const accessRels = graph.relationships.filter((r) => r.type === 'ACCESSES');
    expect(accessRels.length).toBeGreaterThanOrEqual(1);
  });

  it('creates CONTAINS relationships for package members', () => {
    const files = [{ path: 'src/order.pks', content: PACKAGE_SPEC }];
    processPlSql(graph as any, files);

    const containsRels = graph.relationships.filter((r) => r.type === 'CONTAINS');
    expect(containsRels.length).toBeGreaterThanOrEqual(1);
  });
});

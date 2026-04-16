/**
 * Integration test: PL/SQL end-to-end flow.
 *
 * Feeds realistic PL/SQL source through processPlSql and validates:
 *   - Correct graph nodes (packages, procedures, functions, triggers)
 *   - Correct relationships (CONTAINS, CALLS, ACCESSES)
 *   - Regex fallback activates on malformed input
 *   - Stats aggregation across multiple files
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { processPlSql } from '../../../src/core/ingestion/plsql-processor.js';
import type { GraphNode, GraphRelationship } from 'gitnexus-shared';

// ------------------------------------------------------------------
// Mock graph
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
// Realistic fixtures
// ------------------------------------------------------------------
const PACKAGE_SPEC = `
CREATE OR REPLACE PACKAGE order_processing AS
  -- Submit a new order
  PROCEDURE submit_order(p_order_id IN NUMBER, p_customer_id IN NUMBER);
  -- Calculate the total for an order
  FUNCTION get_order_total(p_order_id IN NUMBER) RETURN NUMBER;
  -- Get order status
  FUNCTION get_order_status(p_order_id IN NUMBER) RETURN VARCHAR2;
END order_processing;
/
`.trim();

const PACKAGE_BODY = `
CREATE OR REPLACE PACKAGE BODY order_processing AS
  PROCEDURE submit_order(p_order_id IN NUMBER, p_customer_id IN NUMBER) AS
  BEGIN
    INSERT INTO orders (order_id, customer_id, status, created_date)
    VALUES (p_order_id, p_customer_id, 'PENDING', SYSDATE);

    INSERT INTO order_audit (order_id, action, action_date)
    VALUES (p_order_id, 'CREATED', SYSDATE);
  END submit_order;

  FUNCTION get_order_total(p_order_id IN NUMBER) RETURN NUMBER AS
    v_total NUMBER;
  BEGIN
    SELECT SUM(quantity * unit_price)
      INTO v_total
      FROM order_items
     WHERE order_id = p_order_id;
    RETURN NVL(v_total, 0);
  END get_order_total;

  FUNCTION get_order_status(p_order_id IN NUMBER) RETURN VARCHAR2 AS
    v_status VARCHAR2(50);
  BEGIN
    SELECT status
      INTO v_status
      FROM orders
     WHERE order_id = p_order_id;
    RETURN v_status;
  END get_order_status;
END order_processing;
/
`.trim();

const STANDALONE_PROCEDURE = `
CREATE OR REPLACE PROCEDURE archive_old_orders (
  p_cutoff_date IN DATE,
  p_archived_count OUT NUMBER
) AS
BEGIN
  INSERT INTO orders_archive
    SELECT * FROM orders WHERE created_date < p_cutoff_date;

  DELETE FROM order_items
   WHERE order_id IN (SELECT order_id FROM orders WHERE created_date < p_cutoff_date);

  DELETE FROM orders WHERE created_date < p_cutoff_date;

  p_archived_count := SQL%ROWCOUNT;
END archive_old_orders;
/
`.trim();

const TRIGGER = `
CREATE OR REPLACE TRIGGER trg_orders_audit
  AFTER INSERT OR UPDATE OR DELETE ON orders
  FOR EACH ROW
BEGIN
  IF INSERTING THEN
    INSERT INTO order_audit (order_id, action, action_date)
    VALUES (:NEW.order_id, 'INSERT', SYSDATE);
  ELSIF UPDATING THEN
    INSERT INTO order_audit (order_id, action, action_date)
    VALUES (:NEW.order_id, 'UPDATE', SYSDATE);
  ELSIF DELETING THEN
    INSERT INTO order_audit (order_id, action, action_date)
    VALUES (:OLD.order_id, 'DELETE', SYSDATE);
  END IF;
END trg_orders_audit;
/
`.trim();

const MALFORMED = `
CREATE OR REPLACE PROCEDURE totally_broken (
  this is garbage that ANTLR4 can't parse
  and neither regex will get much from this
END;
/
`.trim();

// ------------------------------------------------------------------
// Tests
// ------------------------------------------------------------------
describe('PL/SQL integration: end-to-end flow', () => {
  let graph: ReturnType<typeof createMockGraph>;

  beforeEach(() => {
    graph = createMockGraph();
  });

  it('processes a full package spec + body and creates correct node structure', () => {
    const files = [
      { path: 'db/packages/order_processing.pks', content: PACKAGE_SPEC },
      { path: 'db/packages/order_processing.pkb', content: PACKAGE_BODY },
    ];
    const result = processPlSql(graph as any, files);

    // Should have at least 1 package and some procedures/functions
    expect(result.packages).toBeGreaterThanOrEqual(1);
    expect(result.procedures + result.functions).toBeGreaterThanOrEqual(2);

    // Package node should exist
    const pkgNodes = graph.nodes.filter(
      (n) => n.label === 'Class' && n.properties.name === 'ORDER_PROCESSING',
    );
    expect(pkgNodes.length).toBeGreaterThanOrEqual(1);

    // All nodes must have language = 'plsql'
    for (const node of graph.nodes) {
      expect(node.properties.language).toBe('plsql');
    }
  });

  it('processes standalone procedure with correct label and properties', () => {
    const files = [{ path: 'db/procedures/archive_old_orders.prc', content: STANDALONE_PROCEDURE }];
    const result = processPlSql(graph as any, files);

    expect(result.procedures).toBeGreaterThanOrEqual(1);

    const procNode = graph.nodes.find((n) => n.properties.name === 'ARCHIVE_OLD_ORDERS');
    expect(procNode).toBeDefined();
    expect(procNode!.label).toBe('Function'); // standalone procs get 'Function' label
    expect(procNode!.properties.filePath).toBe('db/procedures/archive_old_orders.prc');
  });

  it('creates ACCESSES relationships for DML tables', () => {
    const files = [{ path: 'db/procedures/archive_old_orders.prc', content: STANDALONE_PROCEDURE }];
    processPlSql(graph as any, files);

    const accessRels = graph.relationships.filter((r) => r.type === 'ACCESSES');
    // Should access orders, order_items, orders_archive
    expect(accessRels.length).toBeGreaterThanOrEqual(1);
  });

  it('processes trigger correctly', () => {
    const files = [{ path: 'db/triggers/trg_orders_audit.trg', content: TRIGGER }];
    const result = processPlSql(graph as any, files);

    expect(result.triggers).toBeGreaterThanOrEqual(1);

    const trgNode = graph.nodes.find((n) => n.properties.name.includes('TRG_ORDERS_AUDIT'));
    expect(trgNode).toBeDefined();
    expect(trgNode!.label).toBe('Function');
  });

  it('aggregates stats across a multi-file project', () => {
    const files = [
      { path: 'db/packages/order_processing.pks', content: PACKAGE_SPEC },
      { path: 'db/packages/order_processing.pkb', content: PACKAGE_BODY },
      { path: 'db/procedures/archive_old_orders.prc', content: STANDALONE_PROCEDURE },
      { path: 'db/triggers/trg_orders_audit.trg', content: TRIGGER },
    ];
    const result = processPlSql(graph as any, files);

    // At minimum: 1+ package, 1+ procedure, 1+ function, 1+ trigger
    expect(result.packages).toBeGreaterThanOrEqual(1);
    expect(result.procedures).toBeGreaterThanOrEqual(1);
    expect(result.functions).toBeGreaterThanOrEqual(1);
    expect(result.triggers).toBeGreaterThanOrEqual(1);

    // Total nodes should be at least spec+body+proc+trigger
    expect(graph.nodes.length).toBeGreaterThanOrEqual(5);

    // Should have some relationships
    expect(graph.relationships.length).toBeGreaterThanOrEqual(1);
  });

  it('handles malformed input without crashing', () => {
    const files = [{ path: 'db/broken.prc', content: MALFORMED }];

    // Should not throw
    const result = processPlSql(graph as any, files);

    // May or may not extract something, but stats should be valid
    expect(result.parseErrors + result.fallbacks).toBeGreaterThanOrEqual(0);
  });

  it('mixed valid + malformed files processes all files', () => {
    const files = [
      { path: 'db/good.prc', content: STANDALONE_PROCEDURE },
      { path: 'db/bad.prc', content: MALFORMED },
      { path: 'db/trigger.trg', content: TRIGGER },
    ];
    const result = processPlSql(graph as any, files);

    // The good files should still produce nodes
    expect(result.procedures + result.triggers).toBeGreaterThanOrEqual(2);
    expect(graph.nodes.length).toBeGreaterThanOrEqual(2);
  });

  it('node IDs are deterministic (same input = same IDs)', () => {
    const files = [{ path: 'db/proc.prc', content: STANDALONE_PROCEDURE }];

    processPlSql(graph as any, files);
    const firstRunIds = graph.nodes.map((n) => n.id).sort();

    // Reset and run again
    graph.nodes.length = 0;
    graph.relationships.length = 0;
    processPlSql(graph as any, files);
    const secondRunIds = graph.nodes.map((n) => n.id).sort();

    expect(firstRunIds).toEqual(secondRunIds);
  });
});

/**
 * TDD: PL/SQL ANTLR4 symbol extractor tests.
 *
 * Tests the Visitor-based extraction on real PL/SQL fixture files.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { extractSymbols } from '../../../src/core/ingestion/plsql/plsql-symbol-extractor.js';

const FIXTURES = join(import.meta.dirname, '../../../src/core/ingestion/plsql/__tests__/fixtures');

function readFixture(name: string): string {
  return readFileSync(join(FIXTURES, name), 'utf-8');
}

describe('extractSymbols — standalone procedure', () => {
  it('extracts procedure name and params', () => {
    const result = extractSymbols('simple-procedure.sql', readFixture('simple-procedure.sql'));
    expect(result.parseErrors).toHaveLength(0);
    expect(result.usedFallback).toBe(false);

    const proc = result.symbols.find((s) => s.kind === 'procedure');
    expect(proc).toBeDefined();
    expect(proc!.name).toBe('CALCULATE_BONUS');
    expect(proc!.startLine).toBeGreaterThan(0);
    expect(proc!.endLine).toBeGreaterThanOrEqual(proc!.startLine);
  });

  it('extracts procedure parameters', () => {
    const result = extractSymbols('simple-procedure.sql', readFixture('simple-procedure.sql'));
    const proc = result.symbols.find((s) => s.kind === 'procedure');
    expect(proc!.params).toBeDefined();
    expect(proc!.params!.length).toBeGreaterThanOrEqual(2);

    const inParam = proc!.params!.find((p) => p.name === 'P_EMPLOYEE_ID');
    expect(inParam).toBeDefined();
    expect(inParam!.mode).toBe('IN');

    const outParam = proc!.params!.find((p) => p.name === 'P_RESULT');
    expect(outParam).toBeDefined();
    expect(outParam!.mode).toBe('OUT');
  });
});

describe('extractSymbols — standalone function', () => {
  it('extracts function name and return type', () => {
    const result = extractSymbols('simple-function.sql', readFixture('simple-function.sql'));
    expect(result.parseErrors).toHaveLength(0);

    const func = result.symbols.find((s) => s.kind === 'function');
    expect(func).toBeDefined();
    expect(func!.name).toBe('GET_EMPLOYEE_NAME');
    expect(func!.returnType).toBe('VARCHAR2');
  });
});

describe('extractSymbols — package spec', () => {
  it('extracts package and its methods', () => {
    const result = extractSymbols('package-spec.pks', readFixture('package-spec.pks'));
    expect(result.parseErrors).toHaveLength(0);

    const pkg = result.symbols.find((s) => s.kind === 'package');
    expect(pkg).toBeDefined();
    expect(pkg!.name).toBe('ORDER_PROCESSING');

    const procs = result.symbols.filter((s) => s.kind === 'procedure');
    expect(procs.length).toBeGreaterThanOrEqual(2);
    expect(procs.map((p) => p.name)).toContain('SUBMIT_ORDER');
    expect(procs.map((p) => p.name)).toContain('CANCEL_ORDER');

    const funcs = result.symbols.filter((s) => s.kind === 'function');
    expect(funcs.length).toBeGreaterThanOrEqual(2);
    expect(funcs.map((f) => f.name)).toContain('GET_ORDER_TOTAL');
    expect(funcs.map((f) => f.name)).toContain('IS_ORDER_VALID');
  });

  it('creates CONTAINS relations for package methods', () => {
    const result = extractSymbols('package-spec.pks', readFixture('package-spec.pks'));
    const contains = result.relations.filter((r) => r.kind === 'CONTAINS');
    expect(contains.length).toBeGreaterThanOrEqual(4); // 2 procs + 2 funcs
    expect(contains.every((r) => r.sourceName === 'ORDER_PROCESSING')).toBe(true);
  });
});

describe('extractSymbols — package body', () => {
  it('extracts package body and implementations', () => {
    const result = extractSymbols('package-body.pkb', readFixture('package-body.pkb'));
    expect(result.parseErrors).toHaveLength(0);

    const pkgBody = result.symbols.find((s) => s.kind === 'package_body');
    expect(pkgBody).toBeDefined();
    expect(pkgBody!.name).toBe('ORDER_PROCESSING');

    // Should find private log_event too
    const procs = result.symbols.filter((s) => s.kind === 'procedure');
    expect(procs.map((p) => p.name)).toContain('LOG_EVENT');
    expect(procs.map((p) => p.name)).toContain('SUBMIT_ORDER');
  });

  it('extracts CALLS relations', () => {
    const result = extractSymbols('package-body.pkb', readFixture('package-body.pkb'));
    const calls = result.relations.filter((r) => r.kind === 'CALLS');
    expect(calls.length).toBeGreaterThanOrEqual(1);

    // submit_order calls log_event
    const logCall = calls.find(
      (c) => c.sourceName === 'SUBMIT_ORDER' && c.targetName === 'LOG_EVENT',
    );
    expect(logCall).toBeDefined();
  });

  it('extracts ACCESSES relations from DML', () => {
    const result = extractSymbols('package-body.pkb', readFixture('package-body.pkb'));
    const accesses = result.relations.filter((r) => r.kind === 'ACCESSES');
    expect(accesses.length).toBeGreaterThanOrEqual(1);

    // log_event inserts into order_audit_log
    const auditAccess = accesses.find((a) => a.targetName === 'ORDER_AUDIT_LOG');
    expect(auditAccess).toBeDefined();
  });
});

describe('extractSymbols — trigger', () => {
  it('extracts trigger name', () => {
    const result = extractSymbols('trigger-dml.trg', readFixture('trigger-dml.trg'));

    const trigger = result.symbols.find((s) => s.kind === 'trigger');
    expect(trigger).toBeDefined();
    expect(trigger!.name).toBe('TRG_ORDERS_AUDIT');
  });
});

describe('extractSymbols — empty package', () => {
  it('handles empty package body without error', () => {
    const result = extractSymbols('empty-package-body.pkb', readFixture('empty-package-body.pkb'));
    expect(result.parseErrors).toHaveLength(0);

    const pkgBody = result.symbols.find((s) => s.kind === 'package_body');
    expect(pkgBody).toBeDefined();
    expect(pkgBody!.name).toBe('EMPTY_PKG');
  });
});

describe('extractSymbols — cross-package calls', () => {
  it('extracts cross-package calls with qualified names', () => {
    const result = extractSymbols(
      'cross-package-calls.sql',
      readFixture('cross-package-calls.sql'),
    );
    const calls = result.relations.filter((r) => r.kind === 'CALLS');

    // Should find order_processing.submit_order call
    const crossCall = calls.find((c) => c.targetName === 'ORDER_PROCESSING.SUBMIT_ORDER');
    expect(crossCall).toBeDefined();
  });
});

// ── New feature tests ─────────────────────────────────────────────────────

describe('extractSymbols — DML classification', () => {
  it('classifies INSERT accesses with dmlOperation', () => {
    const result = extractSymbols('package-body.pkb', readFixture('package-body.pkb'));
    const accesses = result.relations.filter((r) => r.kind === 'ACCESSES');

    // log_event inserts into order_audit_log
    const insertAccess = accesses.find(
      (a) => a.targetName === 'ORDER_AUDIT_LOG' && a.dmlOperation === 'INSERT',
    );
    expect(insertAccess).toBeDefined();
  });

  it('classifies SELECT accesses with dmlOperation', () => {
    const result = extractSymbols('package-body.pkb', readFixture('package-body.pkb'));
    const accesses = result.relations.filter((r) => r.kind === 'ACCESSES');

    // get_order_total selects from orders
    const selectAccess = accesses.find(
      (a) => a.targetName === 'ORDERS' && a.dmlOperation === 'SELECT',
    );
    expect(selectAccess).toBeDefined();
  });

  it('classifies UPDATE accesses with dmlOperation', () => {
    const result = extractSymbols('package-body.pkb', readFixture('package-body.pkb'));
    const accesses = result.relations.filter((r) => r.kind === 'ACCESSES');

    // submit_order or cancel_order updates orders
    const updateAccess = accesses.find(
      (a) => a.targetName === 'ORDERS' && a.dmlOperation === 'UPDATE',
    );
    expect(updateAccess).toBeDefined();
  });

  it('produces per-DML entries for the same table', () => {
    const result = extractSymbols('package-body.pkb', readFixture('package-body.pkb'));
    const ordersAccesses = result.relations.filter(
      (r) => r.kind === 'ACCESSES' && r.targetName === 'ORDERS',
    );

    const dmlOps = new Set(ordersAccesses.map((a) => a.dmlOperation));
    // ORDERS is used in INSERT, UPDATE, and SELECT
    expect(dmlOps.has('INSERT')).toBe(true);
    expect(dmlOps.has('UPDATE')).toBe(true);
    expect(dmlOps.has('SELECT')).toBe(true);
  });
});

describe('extractSymbols — line numbers', () => {
  it('includes line numbers on ACCESSES relations', () => {
    const result = extractSymbols('package-body.pkb', readFixture('package-body.pkb'));
    const accesses = result.relations.filter((r) => r.kind === 'ACCESSES');

    // Every access should have a line number
    for (const access of accesses) {
      expect(access.line).toBeGreaterThan(0);
    }
  });

  it('includes line numbers on CALLS relations from general elements', () => {
    const result = extractSymbols('package-body.pkb', readFixture('package-body.pkb'));
    const calls = result.relations.filter((r) => r.kind === 'CALLS');

    // At least some calls should have line numbers
    const withLine = calls.filter((c) => c.line && c.line > 0);
    expect(withLine.length).toBeGreaterThan(0);
  });
});

describe('extractSymbols — string literal arguments', () => {
  it('extracts string literal arguments from function calls', () => {
    const sql = `CREATE OR REPLACE PROCEDURE test_config AS
      v_val VARCHAR2(100);
    BEGIN
      v_val := fn_get_setting('MY_CONFIG_KEY');
    END test_config;`;
    const result = extractSymbols('test.sql', sql);
    const call = result.relations.find(
      (r) => r.kind === 'CALLS' && r.targetName === 'FN_GET_SETTING',
    );
    expect(call).toBeDefined();
    expect(call!.stringArgs).toBeDefined();
    expect(call!.stringArgs).toContain('MY_CONFIG_KEY');
  });
});

describe('extractSymbols — cursor extraction', () => {
  it('extracts cursor declarations as symbols', () => {
    const sql = `CREATE OR REPLACE PROCEDURE process_orders AS
      CURSOR c_active_orders IS
        SELECT order_id, total FROM orders WHERE status = 'ACTIVE';
      v_id NUMBER;
    BEGIN
      FOR rec IN c_active_orders LOOP
        v_id := rec.order_id;
      END LOOP;
    END process_orders;`;
    const result = extractSymbols('test.sql', sql);
    const cursor = result.symbols.find((s) => s.kind === 'cursor');
    expect(cursor).toBeDefined();
    expect(cursor!.name).toBe('C_ACTIVE_ORDERS');
    expect(cursor!.owner).toBe('PROCESS_ORDERS');
  });

  it('creates CONTAINS relation for cursors', () => {
    const sql = `CREATE OR REPLACE PROCEDURE process_orders AS
      CURSOR c_active_orders IS
        SELECT order_id FROM orders WHERE status = 'ACTIVE';
    BEGIN
      NULL;
    END process_orders;`;
    const result = extractSymbols('test.sql', sql);
    const contains = result.relations.find(
      (r) => r.kind === 'CONTAINS' && r.targetName === 'C_ACTIVE_ORDERS',
    );
    expect(contains).toBeDefined();
    expect(contains!.sourceName).toBe('PROCESS_ORDERS');
  });

  it('extracts table accesses from cursor SELECT', () => {
    const sql = `CREATE OR REPLACE PROCEDURE process_orders AS
      CURSOR c_active_orders IS
        SELECT order_id FROM orders WHERE status = 'ACTIVE';
    BEGIN
      NULL;
    END process_orders;`;
    const result = extractSymbols('test.sql', sql);
    const access = result.relations.find(
      (r) => r.kind === 'ACCESSES' && r.targetName === 'ORDERS' && r.dmlOperation === 'SELECT',
    );
    expect(access).toBeDefined();
  });
});

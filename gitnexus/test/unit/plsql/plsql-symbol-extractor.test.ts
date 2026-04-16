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

/**
 * TDD: PL/SQL regex fallback tests.
 */
import { describe, it, expect } from 'vitest';
import { extractWithRegex } from '../../../src/core/ingestion/plsql/plsql-regex-fallback.js';

describe('extractWithRegex', () => {
  it('extracts a standalone procedure', () => {
    const result = extractWithRegex(
      'test.prc',
      `CREATE OR REPLACE PROCEDURE calculate_bonus(
  p_employee_id IN NUMBER
) AS
BEGIN
  NULL;
END calculate_bonus;`,
    );
    expect(result.symbols).toHaveLength(1);
    expect(result.symbols[0].kind).toBe('procedure');
    expect(result.symbols[0].name).toBe('CALCULATE_BONUS');
    expect(result.usedFallback).toBe(true);
  });

  it('extracts a standalone function', () => {
    const result = extractWithRegex(
      'test.fnc',
      `CREATE OR REPLACE FUNCTION get_name(p_id IN NUMBER) RETURN VARCHAR2 AS
BEGIN
  RETURN 'hello';
END get_name;`,
    );
    expect(result.symbols).toHaveLength(1);
    expect(result.symbols[0].kind).toBe('function');
    expect(result.symbols[0].name).toBe('GET_NAME');
  });

  it('extracts a package spec', () => {
    const result = extractWithRegex(
      'test.pks',
      `CREATE OR REPLACE PACKAGE my_pkg AS
  PROCEDURE do_stuff(p1 IN NUMBER);
  FUNCTION get_stuff(p1 IN VARCHAR2) RETURN BOOLEAN;
END my_pkg;`,
    );
    const pkg = result.symbols.find((s) => s.kind === 'package');
    expect(pkg).toBeDefined();
    expect(pkg!.name).toBe('MY_PKG');

    const proc = result.symbols.find((s) => s.kind === 'procedure');
    expect(proc).toBeDefined();
    expect(proc!.name).toBe('DO_STUFF');

    const func = result.symbols.find((s) => s.kind === 'function');
    expect(func).toBeDefined();
    expect(func!.name).toBe('GET_STUFF');
  });

  it('extracts a package body', () => {
    const result = extractWithRegex(
      'test.pkb',
      `CREATE OR REPLACE PACKAGE BODY my_pkg AS
  PROCEDURE impl(p1 IN NUMBER) IS
  BEGIN
    NULL;
  END impl;
END my_pkg;`,
    );
    const pkg = result.symbols.find((s) => s.kind === 'package_body');
    expect(pkg).toBeDefined();
    expect(pkg!.name).toBe('MY_PKG');
  });

  it('extracts a trigger', () => {
    const result = extractWithRegex(
      'test.trg',
      `CREATE OR REPLACE TRIGGER trg_audit
  BEFORE INSERT ON orders
  FOR EACH ROW
BEGIN
  :NEW.created_at := SYSDATE;
END trg_audit;`,
    );
    expect(result.symbols).toHaveLength(1);
    expect(result.symbols[0].kind).toBe('trigger');
    expect(result.symbols[0].name).toBe('TRG_AUDIT');
  });

  it('extracts a type', () => {
    const result = extractWithRegex(
      'test.typ',
      `CREATE OR REPLACE TYPE order_rec AS OBJECT (
  order_id NUMBER,
  total NUMBER
);`,
    );
    expect(result.symbols).toHaveLength(1);
    expect(result.symbols[0].kind).toBe('type');
    expect(result.symbols[0].name).toBe('ORDER_REC');
  });

  it('extracts schema-qualified names', () => {
    const result = extractWithRegex(
      'test.prc',
      `CREATE OR REPLACE PROCEDURE hr.my_proc AS BEGIN NULL; END;`,
    );
    expect(result.symbols[0].name).toBe('MY_PROC');
    expect(result.symbols[0].schema).toBe('HR');
  });

  it('handles EDITIONABLE/NONEDITIONABLE keywords', () => {
    const result = extractWithRegex(
      'test.prc',
      `CREATE OR REPLACE EDITIONABLE PROCEDURE my_proc AS BEGIN NULL; END;`,
    );
    expect(result.symbols).toHaveLength(1);
    expect(result.symbols[0].name).toBe('MY_PROC');
  });

  it('does not crash on empty content', () => {
    const result = extractWithRegex('test.sql', '');
    expect(result.symbols).toHaveLength(0);
    expect(result.usedFallback).toBe(true);
  });

  it('does not false-positive on plain DDL', () => {
    const result = extractWithRegex(
      'test.sql',
      `CREATE TABLE employees (
  id NUMBER PRIMARY KEY,
  name VARCHAR2(100)
);
INSERT INTO employees VALUES (1, 'Alice');`,
    );
    expect(result.symbols).toHaveLength(0);
  });

  it('creates DEFINES relations for each symbol', () => {
    const result = extractWithRegex(
      'test.prc',
      `CREATE OR REPLACE PROCEDURE my_proc AS BEGIN NULL; END;`,
    );
    expect(result.relations).toHaveLength(1);
    expect(result.relations[0].kind).toBe('DEFINES');
    expect(result.relations[0].targetName).toBe('MY_PROC');
  });
});

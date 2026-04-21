/**
 * TDD: PL/SQL utility function tests.
 */
import { describe, it, expect } from 'vitest';
import {
  isPlSqlFile,
  normalizeIdentifier,
  buildQualifiedName,
} from '../../../src/core/ingestion/plsql/plsql-utils.js';

describe('isPlSqlFile', () => {
  it.each(['.pls', '.pck', '.pks', '.pkb', '.prc', '.fnc', '.trg', '.typ', '.tps', '.tpb', '.vw'])(
    'returns true for %s',
    (ext) => {
      expect(isPlSqlFile(`path/file${ext}`)).toBe(true);
    },
  );

  it('returns false for .sql', () => {
    expect(isPlSqlFile('path/file.sql')).toBe(false);
  });

  it('returns false for .plb (wrapped binary)', () => {
    expect(isPlSqlFile('path/file.plb')).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(isPlSqlFile('path/file.PKS')).toBe(true);
    expect(isPlSqlFile('path/file.Pkb')).toBe(true);
  });
});

describe('normalizeIdentifier', () => {
  it('uppercases identifiers', () => {
    expect(normalizeIdentifier('my_proc')).toBe('MY_PROC');
  });

  it('strips double quotes from quoted identifiers', () => {
    expect(normalizeIdentifier('"MyProc"')).toBe('MYPROC');
  });

  it('trims whitespace', () => {
    expect(normalizeIdentifier('  my_proc  ')).toBe('MY_PROC');
  });

  it('handles empty string', () => {
    expect(normalizeIdentifier('')).toBe('');
  });
});

describe('buildQualifiedName', () => {
  it('returns name alone when no schema or owner', () => {
    expect(buildQualifiedName({ name: 'MY_PROC' })).toBe('MY_PROC');
  });

  it('returns owner.name when owner provided', () => {
    expect(buildQualifiedName({ name: 'MY_PROC', owner: 'MY_PKG' })).toBe('MY_PKG.MY_PROC');
  });

  it('returns schema.owner.name when both provided', () => {
    expect(buildQualifiedName({ name: 'MY_PROC', owner: 'MY_PKG', schema: 'HR' })).toBe(
      'HR.MY_PKG.MY_PROC',
    );
  });

  it('returns schema.name when schema but no owner', () => {
    expect(buildQualifiedName({ name: 'MY_PROC', schema: 'HR' })).toBe('HR.MY_PROC');
  });
});

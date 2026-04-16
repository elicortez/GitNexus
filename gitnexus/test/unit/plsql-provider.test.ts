/**
 * TDD: PL/SQL Language Provider tests.
 *
 * Tests that:
 * 1. PL/SQL extensions are detected → SupportedLanguages.PlSql
 * 2. plsqlProvider exists with parseStrategy: 'standalone'
 * 3. Provider is registered in the exhaustive providers table
 * 4. getProvider(PlSql) returns the plsql provider
 */
import { describe, it, expect } from 'vitest';
import { SupportedLanguages } from '../../src/config/supported-languages.js';
import { getLanguageFromFilename } from 'gitnexus-shared';

describe('PL/SQL language detection', () => {
  const plsqlExtensions = [
    '.pls',
    '.pck',
    '.pks',
    '.pkb',
    '.prc',
    '.fnc',
    '.trg',
    '.typ',
    '.tps',
    '.tpb',
    '.vw',
  ];

  it.each(plsqlExtensions)('detects %s as PlSql', (ext) => {
    expect(getLanguageFromFilename(`some/path/file${ext}`)).toBe(SupportedLanguages.PlSql);
  });

  it('does not detect .sql as PlSql (ambiguous, not auto-mapped)', () => {
    // .sql is NOT in the extension map — heuristic detection is separate
    const result = getLanguageFromFilename('schema/init.sql');
    expect(result).not.toBe(SupportedLanguages.PlSql);
  });

  it('does not detect .plb (wrapped binary) as PlSql', () => {
    const result = getLanguageFromFilename('pkg/wrapped.plb');
    expect(result).toBeNull();
  });
});

describe('PL/SQL language provider', () => {
  it('plsqlProvider has parseStrategy standalone', async () => {
    const { plsqlProvider } = await import('../../src/core/ingestion/languages/plsql.js');
    expect(plsqlProvider).toBeDefined();
    expect(plsqlProvider.id).toBe(SupportedLanguages.PlSql);
    expect(plsqlProvider.parseStrategy).toBe('standalone');
  });

  it('plsqlProvider has empty tree-sitter queries', async () => {
    const { plsqlProvider } = await import('../../src/core/ingestion/languages/plsql.js');
    expect(plsqlProvider.treeSitterQueries).toBe('');
  });

  it('plsqlProvider exportChecker returns true (PL/SQL symbols are public)', async () => {
    const { plsqlProvider } = await import('../../src/core/ingestion/languages/plsql.js');
    expect(plsqlProvider.exportChecker(null as any)).toBe(true);
  });
});

describe('PL/SQL provider registration', () => {
  it('providers table includes PlSql', async () => {
    const { providers } = await import('../../src/core/ingestion/languages/index.js');
    expect(providers[SupportedLanguages.PlSql]).toBeDefined();
  });

  it('getProvider(PlSql) returns the plsql provider', async () => {
    const { getProvider } = await import('../../src/core/ingestion/languages/index.js');
    const provider = getProvider(SupportedLanguages.PlSql);
    expect(provider.id).toBe(SupportedLanguages.PlSql);
    expect(provider.parseStrategy).toBe('standalone');
  });
});

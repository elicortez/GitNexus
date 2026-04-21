import { readFileSync } from 'node:fs';
import { extractSymbols } from './src/core/ingestion/plsql/plsql-symbol-extractor.js';
const file = process.argv[2];
if (!file) {
  console.error('Usage: npx tsx _extract.ts <file>');
  process.exit(1);
}
const content = readFileSync(file, 'utf-8');
const result = extractSymbols(file, content);
const calls = result.relations.filter((r) => r.kind === 'CALLS');
const accesses = result.relations.filter((r) => r.kind === 'ACCESSES');
console.log(
  JSON.stringify(
    { symbols: result.symbols, calls, accesses, parseErrors: result.parseErrors },
    null,
    2,
  ),
);

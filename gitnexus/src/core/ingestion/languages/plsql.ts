/**
 * PL/SQL Language Provider
 *
 * Standalone ANTLR4-based processor — no tree-sitter grammar.
 * PL/SQL files (.pls, .pck, .pks, .pkb, .prc, .fnc, .trg, .typ, .tps, .tpb, .vw)
 * are detected and processed by the plsql pipeline phase using an ANTLR4 Visitor,
 * not by the tree-sitter pipeline.
 *
 * This provider exists to satisfy the SupportedLanguages exhaustiveness
 * checks and to declare parseStrategy: 'standalone'.
 */
import { SupportedLanguages } from 'gitnexus-shared';
import { defineLanguage } from '../language-provider.js';

export const plsqlProvider = defineLanguage({
  id: SupportedLanguages.PlSql,
  parseStrategy: 'standalone',
  extensions: [],
  treeSitterQueries: '',
  typeConfig: {
    declarationNodeTypes: new Set(),
    extractDeclaration: () => null,
    extractParameter: () => null,
  },
  exportChecker: () => true, // PL/SQL symbols are public by default
  importResolver: () => null,
});

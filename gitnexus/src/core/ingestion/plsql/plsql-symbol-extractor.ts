/**
 * PL/SQL ANTLR4 Symbol Extractor.
 *
 * Parses PL/SQL source using the ANTLR4-generated PlSqlParser and walks the
 * parse tree with a custom Visitor to extract symbols and relationships.
 */
import antlr4 from 'antlr4';
const { CharStream, CommonTokenStream, ParserRuleContext } = antlr4 as any;
// @ts-ignore — generated file
import PlSqlLexer from './generated/PlSqlLexer.js';
// @ts-ignore — generated file
import PlSqlParser from './generated/PlSqlParser.js';

import type {
  ExtractedSymbol,
  ExtractedRelation,
  FileExtractionResult,
  PlSqlParamMode,
  ExtractedParam,
  DmlOperation,
} from './plsql-types.js';
import { normalizeIdentifier } from './plsql-utils.js';

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Parse PL/SQL source and extract symbols + relations using ANTLR4.
 * Returns extraction result with parse errors if any.
 */
export function extractSymbols(filePath: string, content: string): FileExtractionResult {
  const symbols: ExtractedSymbol[] = [];
  const relations: ExtractedRelation[] = [];
  const parseErrors: string[] = [];

  try {
    // PL/SQL is case-insensitive — normalize to uppercase for consistent parsing
    const upperContent = content.toUpperCase();
    const chars = new CharStream(upperContent);
    const lexer = new PlSqlLexer(chars);

    // Suppress console noise from lexer errors
    (lexer as any).removeErrorListeners();
    const errorListener = {
      syntaxError(
        _recognizer: any,
        _offendingSymbol: any,
        line: number,
        column: number,
        msg: string,
      ) {
        parseErrors.push(`Lexer error at ${line}:${column}: ${msg}`);
      },
      reportAmbiguity() {},
      reportAttemptingFullContext() {},
      reportContextSensitivity() {},
    };
    (lexer as any).addErrorListener(errorListener);

    const tokens = new CommonTokenStream(lexer as any);
    const parser = new PlSqlParser(tokens as any);

    // Suppress console noise from parser errors
    (parser as any).removeErrorListeners();
    (parser as any).addErrorListener({
      syntaxError(
        _recognizer: any,
        _offendingSymbol: any,
        line: number,
        column: number,
        msg: string,
      ) {
        parseErrors.push(`Parser error at ${line}:${column}: ${msg}`);
      },
      reportAmbiguity() {},
      reportAttemptingFullContext() {},
      reportContextSensitivity() {},
    });

    const tree = parser.sql_script();

    // Walk the tree and extract
    walkTree(tree, filePath, content, symbols, relations);
  } catch (e: any) {
    parseErrors.push(`Fatal parse error: ${e.message}`);
  }

  return {
    filePath,
    symbols,
    relations,
    parseErrors,
    usedFallback: false,
  };
}

// ── Tree walking ──────────────────────────────────────────────────────────

/**
 * Walk the parse tree recursively, extracting symbols from key rule contexts.
 * We use manual tree walking rather than the Visitor interface to have
 * explicit control over recursion and context passing.
 */
function walkTree(
  node: any,
  filePath: string,
  originalContent: string,
  symbols: ExtractedSymbol[],
  relations: ExtractedRelation[],
  currentProcName?: string,
): void {
  if (!node || !node.children) return;

  for (const child of node.children) {
    if (!(child instanceof ParserRuleContext)) continue;

    const ruleIndex = child.ruleIndex;

    if (ruleIndex === PlSqlParser.RULE_create_package) {
      extractPackage(child, filePath, originalContent, symbols, relations);
    } else if (ruleIndex === PlSqlParser.RULE_create_package_body) {
      extractPackageBody(child, filePath, originalContent, symbols, relations);
    } else if (ruleIndex === PlSqlParser.RULE_create_procedure_body) {
      extractStandaloneProcedure(child, filePath, originalContent, symbols, relations);
    } else if (ruleIndex === PlSqlParser.RULE_create_function_body) {
      extractStandaloneFunction(child, filePath, originalContent, symbols, relations);
    } else if (ruleIndex === PlSqlParser.RULE_create_trigger) {
      extractTrigger(child, filePath, originalContent, symbols, relations);
    } else {
      // Continue walking for other nodes
      walkTree(child, filePath, originalContent, symbols, relations, currentProcName);
    }
  }
}

// ── Package extraction ────────────────────────────────────────────────────

function extractPackage(
  ctx: any,
  filePath: string,
  originalContent: string,
  symbols: ExtractedSymbol[],
  relations: ExtractedRelation[],
): void {
  const nameCtx = ctx.package_name?.(0);
  if (!nameCtx) return;

  const name = getIdentifierText(nameCtx);
  const { startLine, endLine } = getLineRange(ctx, originalContent);

  symbols.push({
    kind: 'package',
    name,
    filePath,
    startLine,
    endLine,
  });

  // Extract procedure/function specs inside the package
  extractPackageMembers(ctx, filePath, originalContent, name, symbols, relations);
}

function extractPackageBody(
  ctx: any,
  filePath: string,
  originalContent: string,
  symbols: ExtractedSymbol[],
  relations: ExtractedRelation[],
): void {
  const nameCtx = ctx.package_name?.(0);
  if (!nameCtx) return;

  const name = getIdentifierText(nameCtx);
  const { startLine, endLine } = getLineRange(ctx, originalContent);

  symbols.push({
    kind: 'package_body',
    name,
    filePath,
    startLine,
    endLine,
  });

  // Extract procedure/function bodies inside the package body
  extractPackageBodyMembers(ctx, filePath, originalContent, name, symbols, relations);
}

function extractPackageMembers(
  ctx: any,
  filePath: string,
  originalContent: string,
  packageName: string,
  symbols: ExtractedSymbol[],
  relations: ExtractedRelation[],
): void {
  visitDescendants(ctx, (child: any) => {
    if (child.ruleIndex === PlSqlParser.RULE_procedure_spec) {
      const nameCtx = child.identifier?.();
      if (nameCtx) {
        const pName = getIdentifierText(nameCtx);
        const { startLine, endLine } = getLineRange(child, originalContent);
        const params = extractParameters(child);
        symbols.push({
          kind: 'procedure',
          name: pName,
          owner: packageName,
          filePath,
          startLine,
          endLine,
          params,
        });
        relations.push({ kind: 'CONTAINS', sourceName: packageName, targetName: pName });
      }
    } else if (child.ruleIndex === PlSqlParser.RULE_function_spec) {
      const nameCtx = child.identifier?.();
      if (nameCtx) {
        const fName = getIdentifierText(nameCtx);
        const { startLine, endLine } = getLineRange(child, originalContent);
        const params = extractParameters(child);
        const returnType = extractReturnType(child);
        symbols.push({
          kind: 'function',
          name: fName,
          owner: packageName,
          filePath,
          startLine,
          endLine,
          params,
          returnType,
        });
        relations.push({ kind: 'CONTAINS', sourceName: packageName, targetName: fName });
      }
    }
  });
}

function extractPackageBodyMembers(
  ctx: any,
  filePath: string,
  originalContent: string,
  packageName: string,
  symbols: ExtractedSymbol[],
  relations: ExtractedRelation[],
): void {
  visitDescendants(ctx, (child: any) => {
    if (child.ruleIndex === PlSqlParser.RULE_procedure_body) {
      const nameCtx = child.identifier?.();
      if (nameCtx) {
        const pName = getIdentifierText(nameCtx);
        const { startLine, endLine } = getLineRange(child, originalContent);
        const params = extractParameters(child);
        symbols.push({
          kind: 'procedure',
          name: pName,
          owner: packageName,
          filePath,
          startLine,
          endLine,
          params,
        });
        relations.push({ kind: 'CONTAINS', sourceName: packageName, targetName: pName });

        // Extract calls inside this procedure
        extractCallsAndAccesses(child, pName, relations, symbols, filePath, originalContent);
      }
      return 'skip'; // Don't recurse into procedure body children
    } else if (child.ruleIndex === PlSqlParser.RULE_function_body) {
      const nameCtx = child.identifier?.();
      if (nameCtx) {
        const fName = getIdentifierText(nameCtx);
        const { startLine, endLine } = getLineRange(child, originalContent);
        const params = extractParameters(child);
        const returnType = extractReturnType(child);
        symbols.push({
          kind: 'function',
          name: fName,
          owner: packageName,
          filePath,
          startLine,
          endLine,
          params,
          returnType,
        });
        relations.push({ kind: 'CONTAINS', sourceName: packageName, targetName: fName });

        // Extract calls inside this function
        extractCallsAndAccesses(child, fName, relations, symbols, filePath, originalContent);
      }
      return 'skip'; // Don't recurse into function body children
    }
  });
}

// ── Standalone extraction ─────────────────────────────────────────────────

function extractStandaloneProcedure(
  ctx: any,
  filePath: string,
  originalContent: string,
  symbols: ExtractedSymbol[],
  relations: ExtractedRelation[],
): void {
  const nameCtx = ctx.procedure_name?.();
  if (!nameCtx) return;

  const name = getIdentifierText(nameCtx);
  const { startLine, endLine } = getLineRange(ctx, originalContent);
  const params = extractParameters(ctx);

  symbols.push({
    kind: 'procedure',
    name,
    filePath,
    startLine,
    endLine,
    params,
  });

  // Extract calls inside this procedure
  extractCallsAndAccesses(ctx, name, relations, symbols, filePath, originalContent);
}

function extractStandaloneFunction(
  ctx: any,
  filePath: string,
  originalContent: string,
  symbols: ExtractedSymbol[],
  relations: ExtractedRelation[],
): void {
  const nameCtx = ctx.function_name?.();
  if (!nameCtx) return;

  const name = getIdentifierText(nameCtx);
  const { startLine, endLine } = getLineRange(ctx, originalContent);
  const params = extractParameters(ctx);
  const returnType = extractReturnType(ctx);

  symbols.push({
    kind: 'function',
    name,
    filePath,
    startLine,
    endLine,
    params,
    returnType,
  });

  // Extract calls inside this function
  extractCallsAndAccesses(ctx, name, relations, symbols, filePath, originalContent);
}

// ── Trigger extraction ────────────────────────────────────────────────────

function extractTrigger(
  ctx: any,
  filePath: string,
  originalContent: string,
  symbols: ExtractedSymbol[],
  relations: ExtractedRelation[],
): void {
  const nameCtx = ctx.trigger_name?.();
  if (!nameCtx) return;

  const name = getIdentifierText(nameCtx);
  const { startLine, endLine } = getLineRange(ctx, originalContent);

  symbols.push({
    kind: 'trigger',
    name,
    filePath,
    startLine,
    endLine,
  });

  // Extract trigger target table from dml_event_clause
  visitDescendants(ctx, (child: any) => {
    if (child.ruleIndex === PlSqlParser.RULE_tableview_name) {
      const tableName = getIdentifierText(child);
      if (tableName && tableName !== name) {
        relations.push({
          kind: 'ACCESSES',
          sourceName: name,
          targetName: tableName,
          triggerEvent: 'TRIGGER',
        });
      }
    }
  });
}

// ── Call & DML extraction ─────────────────────────────────────────────────

function extractCallsAndAccesses(
  ctx: any,
  currentSymbolName: string,
  relations: ExtractedRelation[],
  symbols?: ExtractedSymbol[],
  filePath?: string,
  originalContent?: string,
): void {
  const seenCalls = new Set<string>();
  const seenAccesses = new Set<string>();

  visitDescendants(ctx, (child: any) => {
    // Skip nested procedure/function bodies (they have their own scope)
    if (
      child.ruleIndex === PlSqlParser.RULE_procedure_body ||
      child.ruleIndex === PlSqlParser.RULE_function_body
    ) {
      return 'skip'; // Signal to skip this subtree
    }

    // Cursor declarations: CURSOR name IS SELECT ...
    if (child.ruleIndex === PlSqlParser.RULE_cursor_declaration && symbols && filePath) {
      const nameCtx = child.identifier?.();
      if (nameCtx) {
        const cursorName = getIdentifierText(nameCtx);
        const { startLine, endLine } = getLineRange(child, originalContent ?? '');
        symbols.push({
          kind: 'cursor',
          name: cursorName,
          owner: currentSymbolName,
          filePath,
          startLine,
          endLine,
        });
        relations.push({ kind: 'CONTAINS', sourceName: currentSymbolName, targetName: cursorName });

        // Extract table accesses from the cursor's SELECT statement
        const selectStmt = child.select_statement?.();
        if (selectStmt) {
          extractTableAccesses(selectStmt, currentSymbolName, relations, seenAccesses, 'SELECT');
        }
      }
    }

    // Call statements: CALL pkg.proc(args)
    if (child.ruleIndex === PlSqlParser.RULE_call_statement) {
      const routineNames = child.routine_name_list?.();
      if (routineNames && routineNames.length > 0) {
        const targetName = getIdentifierText(routineNames[0]);
        const line = child.start?.line;
        const key = `${currentSymbolName}->${targetName}`;
        if (targetName && !seenCalls.has(key)) {
          seenCalls.add(key);
          relations.push({
            kind: 'CALLS',
            sourceName: currentSymbolName,
            targetName,
            line,
          });
        }
      }
    }

    // General element calls: pkg.proc(args) or proc(args) as expression statements
    if (child.ruleIndex === PlSqlParser.RULE_general_element) {
      const callInfo = extractCallFromGeneralElement(child);
      if (callInfo) {
        const key = `${currentSymbolName}->${callInfo.name}`;
        if (!seenCalls.has(key)) {
          seenCalls.add(key);
          relations.push({
            kind: 'CALLS',
            sourceName: currentSymbolName,
            targetName: callInfo.name,
            line: callInfo.line,
            stringArgs: callInfo.stringArgs.length > 0 ? callInfo.stringArgs : undefined,
          });
        } else if (callInfo.stringArgs.length > 0) {
          // Aggregate string args from duplicate calls into the existing relation
          const existing = relations.find(
            (r) =>
              r.kind === 'CALLS' &&
              r.sourceName === currentSymbolName &&
              r.targetName === callInfo.name,
          );
          if (existing) {
            const merged = new Set([...(existing.stringArgs ?? []), ...callInfo.stringArgs]);
            // Replace with updated relation (readonly workaround)
            const idx = relations.indexOf(existing);
            relations[idx] = { ...existing, stringArgs: [...merged] };
          }
        }
      }
    }

    // DML: INSERT, UPDATE, DELETE, SELECT — extract ACCESSES edges with DML type
    if (child.ruleIndex === PlSqlParser.RULE_insert_statement) {
      extractTableAccesses(child, currentSymbolName, relations, seenAccesses, 'INSERT');
    } else if (child.ruleIndex === PlSqlParser.RULE_update_statement) {
      extractTableAccesses(child, currentSymbolName, relations, seenAccesses, 'UPDATE');
    } else if (child.ruleIndex === PlSqlParser.RULE_delete_statement) {
      extractTableAccesses(child, currentSymbolName, relations, seenAccesses, 'DELETE');
    } else if (child.ruleIndex === PlSqlParser.RULE_merge_statement) {
      extractTableAccesses(child, currentSymbolName, relations, seenAccesses, 'MERGE');
    } else if (child.ruleIndex === PlSqlParser.RULE_select_statement) {
      extractTableAccesses(child, currentSymbolName, relations, seenAccesses, 'SELECT');
    }
  });
}

interface CallInfo {
  name: string;
  line?: number;
  stringArgs: string[];
}

function extractCallFromGeneralElement(ctx: any): CallInfo | null {
  // A general_element is a function/procedure call if any of its
  // general_element_part children have function_argument children.
  //
  // Tree structure for `pkg.proc(args)`:
  //   general_element
  //     general_element (nested) → "PKG"
  //       general_element_part → id_expression: "PKG"
  //     general_element_part → id_expression: "PROC", function_argument: "(args)"
  //
  // For simple `proc(args)`:
  //   general_element
  //     general_element_part → id_expression: "PROC", function_argument: "(args)"

  const parts = ctx.general_element_part_list?.();
  if (!parts || parts.length === 0) return null;

  // Check if any part has function_argument (indicates a call)
  let hasCallArgs = false;
  let funcArgCtx: any = null;
  for (const part of parts) {
    const funcArgs = part.function_argument_list?.();
    if (funcArgs && funcArgs.length > 0) {
      hasCallArgs = true;
      funcArgCtx = funcArgs[0];
      break;
    }
  }
  if (!hasCallArgs) return null;

  // Build the full name from all parts
  const nameParts: string[] = [];

  // Collect name from nested general_element (for qualified names like pkg.proc)
  const nestedElement = ctx.general_element?.();
  if (nestedElement) {
    const nestedText = normalizeIdentifier(nestedElement.getText());
    if (nestedText) nameParts.push(nestedText);
  }

  // Collect name parts from general_element_part children
  for (const part of parts) {
    const idExpr = part.id_expression?.();
    if (idExpr) {
      const text = normalizeIdentifier(idExpr.getText());
      if (text) nameParts.push(text);
    }
  }

  if (nameParts.length === 0) return null;

  // Extract string literal arguments
  const stringArgs = extractStringLiteralArgs(funcArgCtx);

  return {
    name: nameParts.join('.'),
    line: ctx.start?.line,
    stringArgs,
  };
}

/**
 * Extract string literal arguments from a function_argument context.
 * Walks the argument subtree to find string literals at any depth.
 * Returns de-quoted uppercase strings (e.g., 'MY_KEY' → MY_KEY).
 */
function extractStringLiteralArgs(funcArgCtx: any): string[] {
  if (!funcArgCtx) return [];
  const args: string[] = [];
  try {
    const argList = funcArgCtx.argument_list?.();
    if (!argList || argList.length === 0) return [];
    for (const arg of argList) {
      // Walk the full argument text looking for string literals
      const text = arg.getText();
      // Match all PL/SQL string literals: 'value' anywhere in the expression
      const matches = text.matchAll(/'([^']*)'/g);
      for (const match of matches) {
        if (match[1]) {
          args.push(match[1]);
        }
      }
    }
  } catch {
    // Gracefully handle unexpected grammar shapes
  }
  return args;
}

function extractTableAccesses(
  ctx: any,
  currentSymbolName: string,
  relations: ExtractedRelation[],
  seenAccesses: Set<string>,
  dmlOperation: DmlOperation,
): void {
  visitDescendants(ctx, (child: any) => {
    if (child.ruleIndex === PlSqlParser.RULE_tableview_name) {
      const tableName = getIdentifierText(child);
      // Use DML-qualified key so the same table can appear as both SELECT and INSERT
      const key = `${currentSymbolName}->${tableName}:${dmlOperation}`;
      if (tableName && !seenAccesses.has(key)) {
        seenAccesses.add(key);
        relations.push({
          kind: 'ACCESSES',
          sourceName: currentSymbolName,
          targetName: tableName,
          dmlOperation,
          line: child.start?.line,
        });
      }
    }
  });
}

// ── Parameter extraction ──────────────────────────────────────────────────

function extractParameters(ctx: any): ExtractedParam[] {
  const params: ExtractedParam[] = [];
  try {
    const paramList = ctx.parameter_list?.();
    if (!paramList || !Array.isArray(paramList) || paramList.length === 0) return params;

    for (const paramCtx of paramList) {
      try {
        const nameCtx = paramCtx.parameter_name?.();
        if (!nameCtx) continue;

        const name = normalizeIdentifier(nameCtx.getText());

        let mode: PlSqlParamMode = 'IN'; // default
        try {
          // Check for INOUT first (must come before OUT check)
          const inoutTokens = paramCtx.INOUT_list?.();
          const outTokens = paramCtx.OUT_list?.();
          if (inoutTokens && inoutTokens.length > 0) {
            mode = 'IN OUT';
          } else if (outTokens && outTokens.length > 0) {
            mode = 'OUT';
          }
          // IN is default
        } catch {
          // Some contexts don't have these methods
        }

        let type = '';
        try {
          const typeCtx = paramCtx.type_spec?.();
          if (typeCtx) {
            type = normalizeIdentifier(typeCtx.getText());
          }
        } catch {
          // type_spec may not exist
        }

        params.push({ name, type, mode });
      } catch {
        // Skip individual parameter if extraction fails
      }
    }
  } catch {
    // parameter_list accessor not available on this context type
  }

  return params;
}

// ── Return type extraction ────────────────────────────────────────────────

function extractReturnType(ctx: any): string | undefined {
  try {
    // Look for RETURN keyword followed by type_spec
    const typeSpec = ctx.type_spec?.();
    if (typeSpec) {
      return normalizeIdentifier(typeSpec.getText());
    }
  } catch {
    // Not all contexts have type_spec
  }
  return undefined;
}

// ── AST helpers ───────────────────────────────────────────────────────────

/**
 * Extract a normalized identifier string from a name context.
 * Handles package_name, procedure_name, function_name, trigger_name, etc.
 */
function getIdentifierText(ctx: any): string {
  if (!ctx) return '';
  const text = ctx.getText();
  // Handle schema.name patterns — extract just the last part for simple names
  // but return the full qualified name for dotted references
  return normalizeIdentifier(text);
}

/**
 * Map an ANTLR4 context's token positions to 1-based line numbers.
 * We use the original content (not uppercased) for line counting.
 */
function getLineRange(ctx: any, _originalContent: string): { startLine: number; endLine: number } {
  const start = ctx.start;
  const stop = ctx.stop ?? ctx.start;
  return {
    startLine: start?.line ?? 1,
    endLine: stop?.line ?? start?.line ?? 1,
  };
}

/**
 * Visit all descendants of a node, calling the callback for each.
 * If the callback returns 'skip', that subtree is not descended into.
 */
function visitDescendants(node: any, callback: (child: any) => void | 'skip'): void {
  if (!node || !node.children) return;
  for (const child of node.children) {
    if (!(child instanceof ParserRuleContext)) continue;
    const result = callback(child);
    if (result !== 'skip') {
      visitDescendants(child, callback);
    }
  }
}

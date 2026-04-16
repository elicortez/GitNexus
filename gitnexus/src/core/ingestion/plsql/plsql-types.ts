/**
 * PL/SQL extraction types.
 *
 * Types shared between the ANTLR4 visitor, graph mapper, and regex fallback.
 */

/** Parameter mode: IN, OUT, or IN OUT */
export type PlSqlParamMode = 'IN' | 'OUT' | 'IN OUT';

/** Extracted parameter from a procedure/function signature. */
export interface ExtractedParam {
  readonly name: string;
  readonly type: string;
  readonly mode: PlSqlParamMode;
}

/** Kind of extracted PL/SQL symbol. */
export type PlSqlSymbolKind =
  | 'package'
  | 'package_body'
  | 'procedure'
  | 'function'
  | 'trigger'
  | 'type'
  | 'type_body'
  | 'variable'
  | 'constant'
  | 'cursor'
  | 'exception';

/** A symbol extracted from PL/SQL source. */
export interface ExtractedSymbol {
  readonly kind: PlSqlSymbolKind;
  readonly name: string;
  readonly schema?: string;
  readonly owner?: string; // containing package name
  readonly filePath: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly params?: readonly ExtractedParam[];
  readonly returnType?: string;
  readonly isPrivate?: boolean; // body-only, not in spec
}

/** Kind of extracted relationship. */
export type PlSqlRelationKind =
  | 'CALLS'
  | 'ACCESSES'
  | 'CONTAINS'
  | 'HAS_METHOD'
  | 'HAS_PROPERTY'
  | 'EXTENDS'
  | 'DEFINES';

/** DML operation type for ACCESSES edges. */
export type DmlOperation = 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE' | 'MERGE';

/** A relationship extracted between two symbols. */
export interface ExtractedRelation {
  readonly kind: PlSqlRelationKind;
  readonly sourceName: string;
  readonly targetName: string;
  readonly dmlOperation?: DmlOperation;
  readonly triggerEvent?: string;
}

/** Result of extracting symbols from a single PL/SQL file. */
export interface FileExtractionResult {
  readonly filePath: string;
  readonly symbols: readonly ExtractedSymbol[];
  readonly relations: readonly ExtractedRelation[];
  readonly parseErrors: readonly string[];
  readonly usedFallback: boolean;
}

/** Aggregated stats from the PL/SQL pipeline phase. */
export interface PlSqlStats {
  packages: number;
  procedures: number;
  functions: number;
  triggers: number;
  types: number;
  parseErrors: number;
  fallbacks: number;
}

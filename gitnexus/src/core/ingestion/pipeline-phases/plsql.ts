/**
 * Phase: plsql
 *
 * Processes PL/SQL files via ANTLR4 AST parsing (no tree-sitter).
 *
 * @deps    structure
 * @reads   scannedFiles, allPaths (from structure phase)
 * @writes  graph (PL/SQL package/procedure/function/trigger nodes)
 */

import type { PipelinePhase, PipelineContext, PhaseResult } from './types.js';
import { getPhaseOutput } from './types.js';
import { isPlSqlFile } from '../plsql/plsql-utils.js';
import { readFileContents } from '../filesystem-walker.js';
import { processPlSql } from '../plsql-processor.js';
import type { StructureOutput } from './structure.js';
import { isDev } from '../utils/env.js';

export interface PlSqlOutput {
  packages: number;
  procedures: number;
  functions: number;
  triggers: number;
}

export const plsqlPhase: PipelinePhase<PlSqlOutput> = {
  name: 'plsql',
  deps: ['structure'],

  async execute(
    ctx: PipelineContext,
    deps: ReadonlyMap<string, PhaseResult<unknown>>,
  ): Promise<PlSqlOutput> {
    const { scannedFiles } = getPhaseOutput<StructureOutput>(deps, 'structure');

    const plsqlScanned = scannedFiles.filter((f) => isPlSqlFile(f.path));

    if (plsqlScanned.length === 0) {
      return { packages: 0, procedures: 0, functions: 0, triggers: 0 };
    }

    const plsqlContents = await readFileContents(
      ctx.repoPath,
      plsqlScanned.map((f) => f.path),
    );
    const plsqlFiles = plsqlScanned
      .filter((f) => plsqlContents.has(f.path))
      .map((f) => ({ path: f.path, content: plsqlContents.get(f.path)! }));

    const result = processPlSql(ctx.graph, plsqlFiles);

    if (isDev) {
      console.log(
        `  PL/SQL: ${result.packages} packages, ${result.procedures} procedures, ${result.functions} functions, ${result.triggers} triggers from ${plsqlFiles.length} files`,
      );
      if (result.fallbacks > 0) {
        console.log(`  PL/SQL fallbacks: ${result.fallbacks} files used regex extraction`);
      }
    }

    return {
      packages: result.packages,
      procedures: result.procedures,
      functions: result.functions,
      triggers: result.triggers,
    };
  },
};

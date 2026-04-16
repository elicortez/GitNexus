/* eslint-disable */
import { CommonToken, Lexer, CharStream, Token } from 'antlr4';
import PlSqlParser from './generated/PlSqlParser.js';

export default abstract class PlSqlLexerBase extends Lexer {
  IsNewlineAtPos(pos: number): boolean {
    const la = this._input.LA(pos);
    return la == -1 || String.fromCharCode(la) == '\n';
  }
}

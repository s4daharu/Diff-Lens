import type { LanguageRegistration } from 'shiki';

const lexemes = (name: string, words: string[]) => ({
  name,
  match: String.raw`(?i)(?<![\w/-])(?:${words.join('|')})(?![\w/-])`,
});

// ABAP's keywords are case-insensitive, and comments beginning with * start in column one.
const abap: LanguageRegistration = {
  name: 'abap',
  scopeName: 'source.abap',
  patterns: [{ include: '#code' }],
  repository: {
    code: {
      patterns: [
        { name: 'comment.line.asterisk.abap', match: String.raw`^\*.*$` },
        { name: 'comment.line.double-quote.abap', match: '".*$' },
        {
          name: 'string.quoted.single.abap',
          match: String.raw`'(?:''|[^'])*'`,
        },
        {
          name: 'string.quoted.other.abap',
          match: '`(?:``|[^`])*`',
        },
        {
          name: 'string.template.abap',
          begin: String.raw`\|`,
          end: String.raw`\|`,
          patterns: [
            { name: 'constant.character.escape.abap', match: String.raw`\\.` },
            {
              name: 'meta.interpolation.abap',
              begin: String.raw`\{(?=\s)`,
              end: String.raw`(?<=\s)\}`,
              beginCaptures: { 0: { name: 'punctuation.section.interpolation.begin.abap' } },
              endCaptures: { 0: { name: 'punctuation.section.interpolation.end.abap' } },
              patterns: [{ include: '#code' }],
            },
          ],
        },
        { name: 'meta.annotation.abap', match: String.raw`##[A-Za-z_]\w*` },
        { name: 'variable.other.abap', match: String.raw`<[A-Za-z_][\w-]*>` },
        lexemes('keyword.control.abap', [
          'IF', 'ELSEIF', 'ELSE', 'ENDIF', 'CASE', 'WHEN', 'ENDCASE', 'DO', 'ENDDO',
          'WHILE', 'ENDWHILE', 'LOOP', 'ENDLOOP', 'TRY', 'CATCH', 'CLEANUP', 'ENDTRY',
          'CONTINUE', 'CHECK', 'EXIT', 'RETURN', 'RAISE', 'STOP', 'START-OF-SELECTION',
          'END-OF-SELECTION', 'INITIALIZATION', 'AT\\s+SELECTION-SCREEN',
          'SELECT', 'ENDSELECT', 'FROM', 'WHERE', 'INTO', 'APPENDING', 'ORDER\\s+BY',
          'GROUP\\s+BY', 'HAVING', 'JOIN', 'ON', 'UNION',
        ]),
        lexemes('storage.type.abap', [
          'REPORT', 'PROGRAM', 'INCLUDE', 'CLASS', 'ENDCLASS', 'INTERFACE', 'ENDINTERFACE',
          'DEFINITION', 'IMPLEMENTATION', 'METHOD', 'ENDMETHOD', 'METHODS', 'CLASS-METHODS',
          'PUBLIC\\s+SECTION', 'PROTECTED\\s+SECTION', 'PRIVATE\\s+SECTION',
          'FUNCTION', 'ENDFUNCTION', 'FORM', 'ENDFORM', 'DATA', 'CLASS-DATA',
          'FIELD-SYMBOLS?', 'CONSTANTS', 'STATICS', 'TYPES', 'TYPE', 'LIKE', 'TABLE',
          'PARAMETERS', 'SELECT-OPTIONS', 'IMPORTING', 'EXPORTING', 'CHANGING', 'RETURNING',
          'RAISING', 'BEGIN\\s+OF', 'END\\s+OF', 'INHERITING\\s+FROM', 'VALUE', 'FINAL', 'NEW',
          'STRING', 'XSTRING', 'INT8', 'DECFLOAT16', 'DECFLOAT34', 'ABAP_BOOL',
        ]),
        lexemes('keyword.other.abap', [
          'WRITE', 'CLEAR', 'FREE', 'MOVE', 'ASSIGN', 'UNASSIGN', 'APPEND', 'INSERT',
          'MODIFY', 'UPDATE', 'DELETE', 'READ\\s+TABLE', 'SORT', 'COLLECT', 'MESSAGE',
          'CALL\\s+(?:FUNCTION|METHOD|SCREEN|TRANSACTION)', 'PERFORM', 'ASSERT',
          'TRANSLATE', 'REPLACE', 'SPLIT', 'CONCATENATE', 'CONDENSE', 'FIND',
        ]),
        lexemes('constant.language.abap', ['ABAP_TRUE', 'ABAP_FALSE', 'ABAP_UNDEFINED', 'SPACE']),
        lexemes('keyword.operator.abap', [
          'AND', 'OR', 'NOT', 'EQUIV', 'EQ', 'NE', 'LT', 'LE', 'GT', 'GE',
          'IS\\s+(?:NOT\\s+)?(?:INITIAL|BOUND|ASSIGNED|SUPPLIED)', 'DIV', 'MOD',
        ]),
        { name: 'constant.numeric.abap', match: String.raw`\b\d+(?:\.\d+)?(?:[Ee][+-]?\d+)?\b` },
        { name: 'keyword.operator.abap', match: String.raw`->|=>|\?=|&&|\*\*|<>|<=|>=|[-+*/=<>]` },
      ],
    },
  },
};

export default abap;

export const SYNTAX_LANGUAGES = {
  abap: 'ABAP',
  bash: 'Bash',
  css: 'CSS',
  html: 'HTML',
  javascript: 'JavaScript',
  json: 'JSON',
  markdown: 'Markdown',
  python: 'Python',
  sql: 'SQL',
  typescript: 'TypeScript',
  text: 'Plain text',
} as const;

export type LangId = keyof typeof SYNTAX_LANGUAGES;
export type SyntaxLanguage = 'auto' | LangId;

export function normalizeSyntaxLanguage(value: unknown): SyntaxLanguage {
  return typeof value === 'string' && Object.hasOwn(SYNTAX_LANGUAGES, value)
    ? value as LangId
    : 'auto';
}

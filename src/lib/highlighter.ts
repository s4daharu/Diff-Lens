import {
  createHighlighterCore,
  type HighlighterCore,
  type LanguageInput,
  type ThemedToken,
} from 'shiki';
import { createOnigurumaEngine } from 'shiki/engine/oniguruma';
import type { LangId } from './syntaxLanguages';

const LANG_IMPORTS: Record<Exclude<LangId, 'text'>, LanguageInput> = {
  abap: () => import('./grammars/abap'),
  json: () => import('shiki/langs/json.mjs'),
  python: () => import('shiki/langs/python.mjs'),
  typescript: () => import('shiki/langs/typescript.mjs'),
  javascript: () => import('shiki/langs/javascript.mjs'),
  markdown: () => import('shiki/langs/markdown.mjs'),
  sql: () => import('shiki/langs/sql.mjs'),
  html: () => import('shiki/langs/html.mjs'),
  css: () => import('shiki/langs/css.mjs'),
  bash: () => import('shiki/langs/bash.mjs'),
};

let highlighterPromise: Promise<HighlighterCore> | null = null;

const EXT_MAP: Record<string, LangId> = {
  abap: 'abap',
  json: 'json',
  jsonc: 'json',
  py: 'python',
  pyw: 'python',
  ts: 'typescript',
  tsx: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  md: 'markdown',
  markdown: 'markdown',
  mdx: 'markdown',
  sql: 'sql',
  html: 'html',
  htm: 'html',
  vue: 'html',
  svg: 'html',
  css: 'css',
  scss: 'css',
  less: 'css',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
};

const THEME = {
  light: 'github-light',
  dark: 'github-dark',
} as const;

export function themeId(theme: 'light' | 'dark'): string {
  return THEME[theme];
}

export async function getHighlighter(): Promise<HighlighterCore> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighterCore({
      themes: [
        import('@shikijs/themes/github-light'),
        import('@shikijs/themes/github-dark'),
      ],
      langs: [],
      engine: createOnigurumaEngine(import('shiki/wasm')),
    }).catch((error: unknown) => {
      highlighterPromise = null;
      throw error;
    });
  }
  return highlighterPromise;
}

export function detectLang(
  oldName: string | null,
  newName: string | null,
  text: string,
  alternateText = '',
): LangId {
  for (const name of [newName, oldName]) {
    const ext = name?.split('.').pop()?.toLowerCase();
    if (ext && Object.hasOwn(EXT_MAP, ext)) return EXT_MAP[ext];
  }
  const language = sniffLang(text);
  return language === 'text' && alternateText ? sniffLang(alternateText) : language;
}

function sniffLang(text: string): LangId {
  const head = text.slice(0, 2048);
  if (/^\s*(\{|\[)/.test(head)) {
    try {
      JSON.parse(text);
      return 'json';
    } catch {
      // fall through to other heuristics
    }
  }
  if (/^#!\s*\/.*\b(bash|sh|zsh)\b/m.test(head)) return 'bash';
  if (
    /^[ \t]*(?:REPORT[ \t]+[ZY]\w*|START-OF-SELECTION)[ \t]*\./im.test(head) ||
    /^[ \t]*CLASS[ \t]+[\w/]+[ \t]+(?:DEFINITION|IMPLEMENTATION)(?:[ \t]+[^.\n]+)?[ \t]*\./im.test(head) ||
    /^[ \t]*(?:CLASS-)?DATA(?:[ \t]*:?[ \t]+[\w/]+[ \t]+(?:TYPE|LIKE)[ \t]+[^.\n]+|\(\w+\)[ \t]*=[ \t]*[^.\n]+)\./im.test(head) ||
    /^[ \t]*LOOP[ \t]+AT[ \t]+[^.\n]+[ \t]+(?:INTO|ASSIGNING)[ \t]+[^.\n]+\./im.test(head)
  )
    return 'abap';
  if (/^\s*<(?:!doctype|html|\w+[\s>])/im.test(head) && /<\/\w+>/i.test(head))
    return 'html';
  if (/(^|\n)\s*(def |class \w+[(:]|import \w+$|from \w+ import )/m.test(head))
    return 'python';
  if (
    /(^|\n)\s*(import .+ from |export (default|const|function|class)|const \w+ =|=>|function \w+\()/m.test(
      head,
    )
  )
    return 'typescript';
  if (/(^|\n)\s*(select\b.+from\b|insert into\b|create table\b|update \w+ set\b)/im.test(head))
    return 'sql';
  if (/(^|\n)#{1,3} \S/m.test(head) && /(^|\n)(\*\*|- |\d\. )/m.test(head))
    return 'markdown';
  return 'text';
}

const cache = new Map<string, ThemedToken[]>();
const CACHE_LIMIT = 8000;
const MAX_HIGHLIGHT_LINE_LENGTH = 10_000;

export interface LineTokenizer {
  lang: LangId;
  getTokens(line: string): ThemedToken[] | null;
}

const tokenizerCache = new Map<string, Promise<LineTokenizer>>();
const languageLoads = new Map<Exclude<LangId, 'text'>, Promise<void>>();

async function loadLanguage(lang: Exclude<LangId, 'text'>): Promise<HighlighterCore> {
  const highlighter = await getHighlighter();
  if (!highlighter.getLoadedLanguages().includes(lang)) {
    let load = languageLoads.get(lang);
    if (!load) {
      load = highlighter.loadLanguage(LANG_IMPORTS[lang]).finally(() => languageLoads.delete(lang));
      languageLoads.set(lang, load);
    }
    await load;
  }
  return highlighter;
}

export function createLineTokenizer(
  lang: LangId,
  theme: 'light' | 'dark',
): Promise<LineTokenizer> {
  const key = `${lang}:${theme}`;
  let entry = tokenizerCache.get(key);
  if (!entry) {
    entry = buildLineTokenizer(lang, theme).catch((error: unknown) => {
      tokenizerCache.delete(key);
      throw error;
    });
    tokenizerCache.set(key, entry);
  }
  return entry;
}

async function buildLineTokenizer(
  lang: LangId,
  theme: 'light' | 'dark',
): Promise<LineTokenizer> {
  if (lang === 'text') {
    return { lang, getTokens: () => null };
  }
  const hl = await loadLanguage(lang);
  const themeName = THEME[theme];
  const cacheKeyPrefix = `${lang}:${themeName}:`;
  const tokenizer: LineTokenizer = {
    lang,
    getTokens(line: string): ThemedToken[] | null {
      if (line.length > MAX_HIGHLIGHT_LINE_LENGTH || !line.trim()) return null;
      const key = cacheKeyPrefix + line;
      const hit = cache.get(key);
      if (hit) return hit;
      let tokens: ThemedToken[][];
      try {
        ({ tokens } = hl.codeToTokens(line, {
          lang,
          theme: themeName,
        }));
      } catch {
        return null;
      }
      const result = tokens[0] ?? [];
      if (cache.size >= CACHE_LIMIT) cache.clear();
      cache.set(key, result);
      return result;
    },
  };
  return tokenizer;
}

import type { IgnoreRule } from './types';

export const MAX_IGNORE_RULES = 20;
export const MAX_LITERAL_PATTERN_LENGTH = 500;
export const MAX_REGEX_PATTERN_LENGTH = 160;
export interface CompiledIgnoreRule {
  kind: IgnoreRule['kind'];
  pattern: string;
  regex?: RegExp;
}

export interface MaskedUnit {
  raw: string;
  ignoredBefore: string;
}

export function validateIgnoreRule(rule: IgnoreRule): string | null {
  const pattern = rule.pattern;
  if (pattern.length === 0) return 'Enter a pattern.';

  if (rule.kind === 'literal') {
    if (pattern.length > MAX_LITERAL_PATTERN_LENGTH) {
      return `Literal patterns are limited to ${MAX_LITERAL_PATTERN_LENGTH} characters.`;
    }
    return null;
  }

  if (pattern.length > MAX_REGEX_PATTERN_LENGTH) {
    return `Regex patterns are limited to ${MAX_REGEX_PATTERN_LENGTH} characters.`;
  }

  // Exclude constructs that are disproportionately risky in a browser regex
  // engine. The diff itself runs in a worker and App also has a watchdog, but
  // rejecting these keeps custom rules deterministic and recoverable.
  if (/\\[1-9]/.test(pattern)) {
    return 'Regex backreferences are not supported.';
  }
  if (/\(\?<([=!])/.test(pattern)) {
    return 'Regex lookbehind is not supported.';
  }
  if (/\((?:[^()\\]|\\.)*[+*](?:[^()\\]|\\.)*\)\s*(?:[+*]|\{)/.test(pattern)) {
    return 'Nested quantified regex groups are not supported.';
  }

  try {
    const regex = new RegExp(pattern, 'g');
    if (regex.test('')) {
      return 'Regex patterns must consume at least one character.';
    }
  } catch (error) {
    return error instanceof Error
      ? `Invalid regex: ${error.message}`
      : 'Invalid regex.';
  }

  return null;
}

export function sanitizeIgnoreRules(raw: unknown): IgnoreRule[] {
  if (!Array.isArray(raw)) return [];
  const rules: IgnoreRule[] = [];
  for (const value of raw.slice(0, MAX_IGNORE_RULES)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const candidate = value as Partial<IgnoreRule>;
    if (
      (candidate.kind !== 'literal' && candidate.kind !== 'regex') ||
      typeof candidate.pattern !== 'string' ||
      typeof candidate.enabled !== 'boolean'
    ) {
      continue;
    }
    const rule: IgnoreRule = {
      kind: candidate.kind,
      pattern:
        candidate.kind === 'regex'
          ? candidate.pattern.slice(0, MAX_REGEX_PATTERN_LENGTH)
          : candidate.pattern.slice(0, MAX_LITERAL_PATTERN_LENGTH),
      enabled: candidate.enabled,
    };
    if (!rule.enabled || validateIgnoreRule(rule) === null) rules.push(rule);
  }
  return rules;
}

export function compileIgnoreRules(rules: IgnoreRule[]): CompiledIgnoreRule[] {
  if (rules.length > MAX_IGNORE_RULES) {
    throw new Error(`Custom ignore rules are limited to ${MAX_IGNORE_RULES}.`);
  }

  return rules
    .filter((rule) => rule.enabled)
    .map((rule) => {
      const error = validateIgnoreRule(rule);
      if (error) throw new Error(`Invalid custom ignore rule: ${error}`);
      return rule.kind === 'regex'
        ? {
            kind: rule.kind,
            pattern: rule.pattern,
            regex: new RegExp(rule.pattern, 'g'),
          }
        : { kind: rule.kind, pattern: rule.pattern };
    });
}

export function maskIgnoredText(
  value: string,
  rules: CompiledIgnoreRule[],
): string {
  let masked = value;
  for (const rule of rules) {
    if (rule.kind === 'literal') {
      masked = masked.split(rule.pattern).join('');
    } else {
      masked = masked.replace(rule.regex!, '');
    }
  }
  return masked;
}

function findRanges(
  masked: string,
  rule: CompiledIgnoreRule,
): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  if (rule.kind === 'literal') {
    let from = 0;
    while (from <= masked.length - rule.pattern.length) {
      const index = masked.indexOf(rule.pattern, from);
      if (index < 0) break;
      ranges.push([index, index + rule.pattern.length]);
      from = index + Math.max(1, rule.pattern.length);
    }
    return ranges;
  }

  const regex = new RegExp(rule.pattern, 'g');
  let match: RegExpExecArray | null;
  while ((match = regex.exec(masked)) !== null) {
    if (match[0].length === 0) {
      regex.lastIndex++;
      continue;
    }
    ranges.push([match.index, match.index + match[0].length]);
  }
  return ranges;
}

export function maskIgnoredUnits(
  value: string,
  rules: CompiledIgnoreRule[],
): { text: string; units: MaskedUnit[]; trailingIgnored: string } {
  const source = value.split('').map((raw) => ({
    raw,
    ignored: false,
  }));

  for (const rule of rules) {
    const visibleMap: number[] = [];
    let visible = '';
    source.forEach((unit, sourceIndex) => {
      if (!unit.ignored) {
        visibleMap.push(sourceIndex);
        visible += unit.raw;
      }
    });

    const ranges = findRanges(visible, rule);
    for (const [start, end] of ranges) {
      for (let index = start; index < end; index++) {
        const sourceIndex = visibleMap[index];
        if (sourceIndex != null) source[sourceIndex].ignored = true;
      }
    }
  }

  const units: MaskedUnit[] = [];
  let pendingIgnored = '';
  for (const unit of source) {
    if (unit.ignored) {
      pendingIgnored += unit.raw;
      continue;
    }
    units.push({
      raw: unit.raw,
      ignoredBefore: pendingIgnored,
    });
    pendingIgnored = '';
  }

  return {
    text: units.map((unit) => unit.raw).join(''),
    units,
    trailingIgnored: pendingIgnored,
  };
}

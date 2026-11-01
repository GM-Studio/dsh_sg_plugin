// Conservative stable numeric release ranges shared by every environment entry.
// Unsupported syntax (including pre-release constraints) fails closed.
export function versionTuple(value) {
  const match = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:[+_][\w.+-]+)?$/.exec(String(value).trim());
  if (!match) return null;
  const parts = match.slice(1, 4).map((entry) => Number(entry || 0));
  return parts.every(Number.isSafeInteger) ? parts : null;
}
const compare = (left, right) => {
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i] - right[i];
  return 0;
};
function parseAlternative(input) {
  const tokens = [
    ...input.matchAll(
      /(?:>=|<=|==|!=|~=|[<>=^~])?\s*v?\d+(?:\.(?:\d+|[xX*]))?(?:\.(?:\d+|[xX*]))?/g,
    ),
  ];
  if (
    !tokens.length ||
    tokens
      .map((m) => m[0])
      .join('')
      .replace(/\s/g, '') !== input.replace(/\s/g, '')
  )
    return null;
  const parsed = tokens.map(([token]) => {
    const match = /^(>=|<=|==|!=|~=|[<>=^~])?\s*v?(.*)$/.exec(token.trim());
    const op = match[1] || '',
      parts = match[2].split('.');
    const wildcard = parts.findIndex((p) => /^[xX*]$/.test(p));
    if (
      wildcard >= 0 &&
      (!['', '==', '=', '!='].includes(op) || parts.slice(wildcard).some((p) => !/^[xX*]$/.test(p)))
    )
      return null;
    if (op === '~=' && parts.length < 2) return null;
    const base = parts.map((p) => (/^\d+$/.test(p) ? Number(p) : 0));
    if (!base.every(Number.isSafeInteger)) return null;
    while (base.length < 3) base.push(0);
    return { op, parts, base };
  });
  return parsed.every(Boolean) ? parsed : null;
}
export function matchesVersion(version, requirement = '') {
  const current = versionTuple(version);
  if (!current) return false;
  const text = String(requirement ?? '').trim();
  if (!text || text === '*') return true;
  const alternatives = text.split('||').map((s) => s.trim().replace(/,/g, ' '));
  const parsed = alternatives.map(parseAlternative);
  if (!parsed.every(Boolean)) return false;
  return parsed.some((tokens) =>
    tokens.every(({ op, parts, base }) => {
      const delta = compare(current, base);
      if (op === '>=') return delta >= 0;
      if (op === '>') return delta > 0;
      if (op === '<=') return delta <= 0;
      if (op === '<') return delta < 0;
      if (['^', '~', '~='].includes(op)) {
        const upper = [...base];
        const position =
          op === '^'
            ? parts.length === 1 || base[0]
              ? 0
              : parts.length === 2 || base[1]
                ? 1
                : 2
            : op === '~='
              ? parts.length >= 3
                ? 1
                : 0
              : parts.length >= 2
                ? 1
                : 0;
        upper[position]++;
        for (let i = position + 1; i < 3; i++) upper[i] = 0;
        return delta >= 0 && compare(current, upper) < 0;
      }
      const equal = parts.every((p, i) => /^[xX*]$/.test(p) || current[i] === Number(p));
      if (['==', '!='].includes(op) && !parts.some((p) => /^[xX*]$/.test(p)))
        return op === '!=' ? delta !== 0 : delta === 0;
      return op === '!=' ? !equal : equal;
    }),
  );
}

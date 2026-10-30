// Conservative numeric version ranges. Unsupported syntax is never a match.
export function versionTuple(value) {
  const match = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:[+_-][\w.+-]+)?$/.exec(String(value).trim());
  return match ? match.slice(1, 4).map((entry) => Number(entry || 0)) : null;
}
const compare = (left, right) => {
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i] - right[i];
  return 0;
};

export function matchesVersion(version, requirement = '') {
  const current = versionTuple(version);
  if (!current) return false;
  if (!requirement || requirement === '*') return true;
  return String(requirement)
    .split('||')
    .some((alternative) => {
      const input = alternative.trim().replace(/,/g, ' ');
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
        return false;
      return tokens.every(([token]) => {
        const match = /^(>=|<=|==|!=|~=|[<>=^~])?\s*v?(.*)$/.exec(token.trim());
        const op = match[1] || '',
          parts = match[2].split('.'),
          base = parts.map((part) => (/^\d+$/.test(part) ? Number(part) : 0));
        while (base.length < 3) base.push(0);
        const delta = compare(current, base);
        if (op === '>=') return delta >= 0;
        if (op === '>') return delta > 0;
        if (op === '<=') return delta <= 0;
        if (op === '<') return delta < 0;
        if (op === '^' || op === '~' || op === '~=') {
          const upper = [...base];
          const position =
            op === '^'
              ? base[0]
                ? 0
                : base[1]
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
        const equal = parts.every(
          (part, index) => /^[xX*]$/.test(part) || current[index] === Number(part),
        );
        return op === '!=' ? !equal : equal;
      });
    });
}

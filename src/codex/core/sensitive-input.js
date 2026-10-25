// Check content before persistence. Redacted placeholders do not match the
// credential alphabet; errors must never echo a matched value back to callers.
export function hasSensitiveInput(value) {
  let content;
  try {
    content = typeof value === 'string' ? value : JSON.stringify(value);
  } catch {
    return false; // The caller's JSON validation rejects nonserializable input.
  }
  return (
    typeof content === 'string' &&
    /(?:\bBearer\s+[A-Za-z0-9._~+/-]{12,}|\b(?:password|passwd|secret|token|api[_-]?key|access[_-]?token|client[_-]?secret|authorization)["']?\s*[:=]\s*["']?[A-Za-z0-9_./+=-]{8,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/i.test(
      content,
    )
  );
}

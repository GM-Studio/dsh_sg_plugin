export function gitSafeDirectory(root) {
  return String(root).replaceAll('\\', '/');
}

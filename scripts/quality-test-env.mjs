// Git hooks export repository-local variables. Never leak them into tests
// that create independent repositories, or they can mutate the source index.
export function isolatedTestEnvironment(env, localVariables) {
  const excluded = new Set(localVariables.map((name) => name.toUpperCase()));
  return Object.fromEntries(
    Object.entries(env).filter(([name]) => !excluded.has(name.toUpperCase())),
  );
}

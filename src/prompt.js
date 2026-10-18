export function registerPrompt(ctx, runtime) {
  const systemPrompt =
    ctx.systemPrompt ||
    (typeof ctx.get === 'function' ? ctx.get('systemPrompt') : undefined);
  if (!systemPrompt) return () => {};
  return systemPrompt.context({
    name: 'specgate-workflow',
    order: 900,
    text: (context) => runtime.promptText(context?.scope),
  });
}

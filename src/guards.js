export function registerGuards(ctx, runtime) {
  const disposers = [];

  if (ctx.tools && typeof ctx.tools.guard === 'function') {
    disposers.push(ctx.tools.guard((exec) => runtime.checkWrite(exec)));
  }

  if (typeof ctx.on === 'function') {
    disposers.push(
      ctx.on('tools/post-execute', async (exec, result, next) => {
        const decision = await next();
        try {
          if (result && !result.isError) runtime.afterWrite(exec);
        } catch {
          // Never let audit/invalidation break the tool result.
        }
        return decision;
      }),
    );
  }

  return () => {
    for (const dispose of disposers) {
      try {
        dispose();
      } catch {
        // ignore teardown errors
      }
    }
  };
}

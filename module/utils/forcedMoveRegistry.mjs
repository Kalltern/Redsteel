/**
 * Tokens this client is moving by force right now (forcedMovement.mjs).
 *
 * Kept in its own import-free module so the movement hooks that consult it
 * (token.mjs movement counter, actionTracker noteMovement, allyPassage) do not
 * pull forcedMovement.mjs and the whole Apply Damage graph in behind them.
 * Those hooks all run on the moving client, which is the one that filled the
 * set, so a local set is enough.
 */
const forcedTokenIds = new Set();

/** Is this token being moved by force on this client? */
export function isForcedMove(tokenDocOrId) {
  const id = typeof tokenDocOrId === "string" ? tokenDocOrId : tokenDocOrId?.id;
  return !!id && forcedTokenIds.has(id);
}

/** Run `fn` with the token marked as force-moved, however it ends. */
export async function withForcedFlag(tokenDoc, fn) {
  forcedTokenIds.add(tokenDoc.id);
  try {
    return await fn();
  } finally {
    forcedTokenIds.delete(tokenDoc.id);
  }
}

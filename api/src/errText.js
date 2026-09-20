// Some libraries throw errors with an empty `.message`:
//   - pg on Windows dual-stack: AggregateError, message "", only .code
//   - node-redis when the socket is closed: only .name (ClientClosedError)
// Logging `err.message` alone then prints "undefined", which tells you nothing.
export function errText(err) {
  if (!err) return "unknown error";
  return err.message || err.code || err.constructor?.name || err.name || String(err);
}

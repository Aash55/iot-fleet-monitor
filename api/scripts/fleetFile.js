// The fleet file holds device API keys, and the repo is PUBLIC.
// So only a bare file name inside scripts/ is allowed, and it must end in `.local.json`
// (the root .gitignore line `*.local.json` is what hides it).
import path from "node:path";

export const DEFAULT_FLEET = "fleet.local.json";

export function fleetPath(name = DEFAULT_FLEET) {
  const onlyName = name === path.basename(name);          // no paths like "../x" or "C:\x"
  const gitignored = /^[\w.-]+\.local\.json$/.test(name); // e.g. fleet.prod.local.json
  if (!onlyName || !gitignored) {
    throw new Error(
      `--fleet takes only a file name ending in .local.json (e.g. fleet.prod.local.json). Got: ${name}`
    );
  }
  return path.join(import.meta.dirname, name);
}

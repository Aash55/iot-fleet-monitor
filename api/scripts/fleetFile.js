// api/scripts/fleetFile.js  -> ye f-step P6.3-f3 pe daalni hai (naya: --fleet flag ka ek hi check)
// Fleet file mein device API keys hoti hain. Repo PUBLIC hai.
// Isliye sirf scripts/ ke andar ka naam, aur naam `.local.json` pe khatam hona chahiye
// (root .gitignore ki line `*.local.json` usi ko chhupati hai).
import path from "node:path";

export const DEFAULT_FLEET = "fleet.local.json";

export function fleetPath(name = DEFAULT_FLEET) {
  const onlyName = name === path.basename(name);          // "../x" ya "C:\x" jaisa path nahi
  const gitignored = /^[\w.-]+\.local\.json$/.test(name); // jaise fleet.prod.local.json
  if (!onlyName || !gitignored) {
    throw new Error(
      `--fleet mein sirf file ka naam do, jo .local.json pe khatam ho (jaise fleet.prod.local.json). Mila: ${name}`
    );
  }
  return path.join(import.meta.dirname, name);
}

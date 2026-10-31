// Builds the resource into dist/voiceprobe/: copies src/ and stream/ (if present) and writes the manifest.
// Copy dist/voiceprobe/ into your KCDC server's resources/ folder and start it (ensure voiceprobe).
import { cpSync, copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "dist", "voiceprobe");
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const f of ["server.js", "client.js"]) copyFileSync(join(here, "src", f), join(out, f));
if (existsSync(join(here, "stream"))) cpSync(join(here, "stream"), join(out, "stream"), { recursive: true });
writeFileSync(join(out, "package.json"), JSON.stringify({
  name: "voiceprobe",
  version: "0.1.0",
  description: "Probe: does a sound KCDC plays on an entity respond to the game's own occlusion (ObstrOcclCalcType)?",
  mafiahub: {
    serverScripts: ["server.js"],
    clientScripts: ["client.js"],
    files: [],
    resourceDependencies: [],
    exports: [],
    errorBehavior: "continue",
  },
}, null, 2) + "\n");
console.log("voiceprobe -> " + out);

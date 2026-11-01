// Builds the resource into dist/voiceprobe/: copies src/ and stream/ (if present) and writes the manifest.
// Copy dist/voiceprobe/ into your KCDC server's resources/ folder and start it (ensure voiceprobe).
// A localised build (other command name and texts) swaps src/strings.js; see the header of that file.
import { cpSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "dist", "voiceprobe");
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const f of ["strings.js", "server.js"]) copyFileSync(join(here, "src", f), join(out, f));
// one client file: strings first, then the client code (client scripts may not share globals)
writeFileSync(join(out, "client.js"), readFileSync(join(here, "src", "strings.js"), "utf8") + "\n" + readFileSync(join(here, "src", "client.js"), "utf8"));
if (existsSync(join(here, "stream"))) cpSync(join(here, "stream"), join(out, "stream"), { recursive: true });
writeFileSync(join(out, "package.json"), JSON.stringify({
  name: "voiceprobe",
  version: "0.2.0",
  description: "Probe: does a sound KCDC plays on an entity respond to the game's own occlusion (ObstrOcclCalcType)? Also records results, lists who you hear, times raycasts and reads the navmesh.",
  mafiahub: {
    serverScripts: ["strings.js", "server.js"],
    clientScripts: ["client.js"],
    files: [],
    resourceDependencies: [],
    exports: [],
    errorBehavior: "continue",
  },
}, null, 2) + "\n");
console.log("voiceprobe -> " + out);

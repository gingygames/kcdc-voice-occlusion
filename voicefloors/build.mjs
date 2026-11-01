// Builds the resource into dist/voicefloors/. Copy that folder into your KCDC server's resources/ and start it.
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "dist", "voicefloors");
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const f of ["config.js", "server.js"]) copyFileSync(join(here, "src", f), join(out, f));
writeFileSync(join(out, "package.json"), JSON.stringify({
  name: "voicefloors",
  version: "0.2.0",
  description: "Stops proximity voice carrying between floors (server-only, Voice.setLocalMute + client raycasts)",
  mafiahub: {
    serverScripts: ["config.js", "server.js"],
    clientScripts: [],
    files: [],
    resourceDependencies: [],
    exports: [],
    errorBehavior: "continue",
  },
}, null, 2) + "\n");
console.log("voicefloors -> " + out);

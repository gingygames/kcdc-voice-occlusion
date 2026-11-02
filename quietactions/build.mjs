// Builds the resource into dist/quietactions/. Copy that folder into your KCDC server's resources/ and start it.
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "dist", "quietactions");
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const f of ["config.js", "server.js", "client.js"]) copyFileSync(join(here, "src", f), join(out, f));
writeFileSync(join(out, "package.json"), JSON.stringify({
  name: "quietactions",
  version: "0.1.0",
  description: "Silences other players' never-culled first-person game sounds (dice, washing, cooking) and plays positioned dice sounds instead",
  mafiahub: {
    serverScripts: ["config.js", "server.js"],
    clientScripts: ["client.js"],
    files: [],
    resourceDependencies: [],
    exports: [],
    errorBehavior: "continue",
  },
}, null, 2) + "\n");
console.log("quietactions -> " + out);

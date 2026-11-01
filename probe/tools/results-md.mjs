#!/usr/bin/env node
// Turns the results the probe recorded (/voiceprobe result ...) into Markdown tables for README.md.
//   node probe/tools/results-md.mjs <server>/resources/voiceprobe/data/results.json [> results.md]
import { readFileSync } from "node:fs";

const file = process.argv[2];
if (!file) {
  console.error("usage: node probe/tools/results-md.mjs <path to results.json>");
  process.exit(2);
}
const rows = JSON.parse(readFileSync(file, "utf8"));
const esc = (s) => String(s ?? "").replace(/\|/g, "\\|").trim();
const lines = [
  "| place | mode | occl. param | score (0 = no difference, 5 = silent) | distance / height | note | tester | when |",
  "|---|---|---|---|---|---|---|---|",
];
for (const r of rows) {
  const dist = r.distance == null ? "" : `${r.distance} m / ${r.heightDiff > 0 ? "+" : ""}${r.heightDiff} m`;
  lines.push(`| ${esc(r.place)} | ${esc(r.mode ?? "-")} | ${r.occlusionParam ?? "-"} | ${r.score} | ${dist} | ${esc(r.note)} | ${esc(r.player)} | ${esc((r.time ?? "").slice(0, 16).replace("T", " "))} |`);
}
const agg = new Map(); // place x mode x param -> average
for (const r of rows) {
  const k = `${r.place}|${r.mode ?? "-"}|${r.occlusionParam ?? "-"}`;
  const a = agg.get(k) ?? { n: 0, sum: 0 };
  a.n++;
  a.sum += Number(r.score) || 0;
  agg.set(k, a);
}
lines.push("", "| place | mode | occl. param | average score | samples |", "|---|---|---|---|---|");
for (const [k, a] of [...agg].sort()) {
  const [place, mode, param] = k.split("|");
  lines.push(`| ${esc(place)} | ${esc(mode)} | ${param} | ${(a.sum / a.n).toFixed(1)} | ${a.n} |`);
}
console.log(lines.join("\n"));

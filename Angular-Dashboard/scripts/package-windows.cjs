// Runs electron-builder with an output folder outside the VS Code workspace,
// named after the version and build time, e.g.
// ../../EdgeBox-Release-1.0.0-20261126-1030. Each release is kept separately
// and a locked app.asar from an earlier build never blocks packaging.
// Usage: node scripts/package-windows.cjs <electron-builder args...>
// Passing --config.directories.output=<dir> overrides the generated folder.
const { spawnSync } = require("node:child_process");
const { version } = require("../package.json");

const pad = (n) => String(n).padStart(2, "0");
const now = new Date();
const stamp =
  `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
  `-${pad(now.getHours())}${pad(now.getMinutes())}`;

const args = process.argv.slice(2);
if (!args.some((arg) => arg.startsWith("--config.directories.output"))) {
  args.push(
    `--config.directories.output=../../EdgeBox-Release-${version}-${stamp}`,
  );
}
args.push("--config.electronDist=node_modules/electron/dist");

console.log(`electron-builder ${args.join(" ")}`);
// shell is required on Windows to run the .cmd shim from node_modules/.bin.
const result = spawnSync(
  "electron-builder",
  args.map((arg) => `"${arg}"`),
  { stdio: "inherit", shell: true },
);
process.exit(result.status ?? 1);

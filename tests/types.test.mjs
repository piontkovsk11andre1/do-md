import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tsc = path.join(
  root,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "tsc.cmd" : "tsc",
);

test("strict NodeNext declarations compile", () => {
  const command = process.platform === "win32" ? "cmd.exe" : tsc;
  const args =
    process.platform === "win32"
      ? ["/d", "/s", "/c", tsc, "--project", "tests/types/tsconfig.json"]
      : ["--project", "tests/types/tsconfig.json"];
  const compiled = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
  });
  assert.equal(compiled.status, 0, `${compiled.stdout}\n${compiled.stderr}`);
});

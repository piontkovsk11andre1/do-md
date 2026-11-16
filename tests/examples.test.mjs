import test from "node:test";
import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { handleReference } from "../sources/MCP/tools/reference.mjs";

const exec = promisify(execFile);
const root = fileURLToPath(new URL("../", import.meta.url));
const cli = join(root, "bin/do-md.mjs");
const examples = ["release-notes", "query-sections", "structured-document", "precise-editing", "markdown-to-js"];

for (const name of examples) {
    test(`documented example/${name}: run its README commands and check results`, async t => {
        const cwd = await mkdtemp(join(tmpdir(), `do-md-${name}-`));
        t.after(() => rm(cwd, { recursive: true, force: true }));
        await cp(join(root, "examples", name), cwd, { recursive: true });
        const read = file => readFile(join(cwd, file), "utf8");
        const original = await read("document.md");
        const readme = await read("README.md");
        const commands = [...readme.matchAll(/```sh\n([\s\S]*?)\n```/g)]
            .flatMap(match => match[1].split("\n")).filter(line => line.trim());
        assert.ok(commands.length > 0, "README must provide runnable commands");
        const outputs = [];
        for (const line of commands) {
            // These examples intentionally use single-line argv, not a shell script.
            const [command, ...args] = line.match(/'[^']*'|"[^"]*"|\S+/g)
                .map(token => /^["']/.test(token) ? token.slice(1, -1) : token);
            assert.ok(["do-md", "node"].includes(command), `Unsupported README command: ${line}`);
            const result = await exec(process.execPath, command === "do-md" ? [cli, ...args] : args, { cwd });
            assert.equal(result.stderr, "", line);
            outputs.push(result.stdout);
        }
        assert.equal(await read("document.md"), original, "Source document must stay unchanged");

        if (name === "release-notes") {
            assert.deepEqual(JSON.parse(await read("context.json")), JSON.parse(await read("data.json")));
            assert.equal(await read("roundtrip.md"), original);
            assert.equal(await read("next-release.md"), original.replace(/^# 1\.2\.0/, "# 2.0.0"));
        } else if (name === "query-sections") {
            const first = JSON.parse(outputs[0]);
            const all = JSON.parse(outputs[1]);
            assert.deepEqual(all.map(match => match.context.content), [
                "First target: prepare the release.",
                "Second target: verify the package.",
                "Third target: publish the changelog.",
            ]);
            assert.deepEqual(first, all[0]);
            for (const match of all) assert.equal(original.slice(match.start, match.end), `## Target\n\n${match.context.content}`);
        } else if (name === "structured-document") {
            const data = JSON.parse(await read("context.json"));
            assert.deepEqual(data, JSON.parse(await read("expected.json")));
            assert.equal(data.metadata.data.project, "Orchard");
            assert.equal(data.settings.rows[1][1], "2");
            assert.equal(data.tasks.items[0].checked, false);
            assert.equal(data.tasks.items[0].children[1].children[0].checked, true);
            assert.deepEqual(data.command, { language: "sh", meta: "", value: "npm test" });
        } else if (name === "precise-editing") {
            const checked = await read("checked.md");
            const updated = await read("updated.md");
            assert.equal(checked, await read("expected.checked.md"));
            assert.equal(updated, await read("expected.updated.md"));
            assert.equal(checked, original.replace("- [ ] Run", "- [x] Run"));
            assert.equal(updated.slice(0, updated.indexOf("| Field")), checked.slice(0, checked.indexOf("| Field")));
            assert.ok(updated.endsWith(original.slice(original.indexOf("\nThe footer"))));
            assert.match(updated, /production/);
        } else {
            assert.deepEqual(JSON.parse(await read("context.json")), JSON.parse(await read("expected.json")));
            assert.equal(await read("report.mjs"), await read("expected.mjs"));
            assert.equal(outputs[1], "", "do-md render does not execute the generated program");
            assert.deepEqual(JSON.parse(outputs[2]), { title: "Work inventory", total: 5 });
        }
    });
}

test("CLI and MCP reference expose the same registry entry", async () => {
    const { stdout } = await exec(process.execPath, [cli, "reference", "listTree", "--format", "json"]);
    const mcp = await handleReference({ topic: "listTree", format: "json" });
    assert.equal(mcp.ok, true);
    assert.deepEqual(JSON.parse(stdout), mcp.reference);
});

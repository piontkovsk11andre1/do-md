import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

test("Node and browser imports leave the shared error prototype unchanged", async () => {
  const { stdout } = await promisify(execFile)(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
    import assert from 'node:assert/strict';
    import { inspect } from 'node:util';
    const { DoMdError } = await import('@p10i/do-md/browser');
    const before = Object.getOwnPropertyDescriptors(DoMdError.prototype);
    const error = new DoMdError('stable');
    const rendered = inspect(error, { colors: true });
    await import('@p10i/do-md');
    await import('@p10i/do-md/io');
    await import('@p10i/do-md/http');
    assert.deepEqual(Object.getOwnPropertyDescriptors(DoMdError.prototype), before);
    assert.equal(inspect(error, { colors: true }), rendered);
    assert.equal(rendered, String(error));
    console.log('stable');
  `,
    ],
    { cwd: fileURLToPath(new URL("../", import.meta.url)) },
  );
  assert.equal(stdout.trim(), "stable");
});

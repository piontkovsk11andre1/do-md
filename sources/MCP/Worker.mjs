import { parentPort, workerData } from "node:worker_threads";

import { handleValidate } from "./tools/validate.mjs";
import { handleExport } from "./tools/export.mjs";
import { handleCreate } from "./tools/create.mjs";
import { handleSet } from "./tools/set.mjs";
import { handleRender } from "./tools/render.mjs";
import { handleMatch } from "./tools/match.mjs";
import { handleQuery } from "./tools/query.mjs";

const handlers = {
  validate: handleValidate,
  export: handleExport,
  create: handleCreate,
  set: handleSet,
  render: handleRender,
  match: handleMatch,
  query: handleQuery,
};

try {
  const handler = handlers[workerData.name];
  if (!handler) throw new Error(`unknown tool: ${workerData.name}`);
  parentPort.postMessage(await handler(workerData.params, workerData.context));
} catch (error) {
  parentPort.postMessage({
    ok: false,
    errors: [{
      code: error?.code ?? "DO_MD_INTERNAL_ERROR",
      message: error?.message ?? String(error),
      file: error?.file ?? null,
      line: error?.line ?? 1,
      column: error?.column ?? 1,
      snippet: error?.snippet ?? null,
    }],
  });
}

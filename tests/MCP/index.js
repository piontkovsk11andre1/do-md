import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadTests } from "../load-tests.mjs";

await loadTests(dirname(fileURLToPath(import.meta.url)));

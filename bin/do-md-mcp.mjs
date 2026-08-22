#!/usr/bin/env node
import { run } from "../sources/McpServer.mjs";

const exitCode = await run();
process.exitCode = exitCode;

#!/usr/bin/env node
import { execute, formatUsage } from "../sources/Shell.mjs";

const argv = process.argv.slice(2);
if (argv.length === 0) {
  process.stdout.write(formatUsage());
  process.exitCode = 1;
} else {
  process.exitCode = await execute(argv);
}

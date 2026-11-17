import { Server } from "./HTTP/Server.mjs";
import { portNumber, positiveInteger } from "./Service/Definitions.mjs";

export { Server };

export function parseArgv(argv = []) {
  const options = {};
  const names = {
    "--root": "root",
    "--host": "host",
    "--port": "port",
    "--max-input-bytes": "maxInputBytes",
    "--timeout-ms": "timeoutMs",
    "--max-body-bytes": "maxBodyBytes",
    "--max-response-bytes": "maxResponseBytes",
    "--max-concurrency": "maxConcurrency",
  };
  for (let index = 0; index < argv.length; index++) {
    const [name, ...joined] = argv[index].split("=");
    if (name === "--no-snippets" && joined.length === 0) {
      options.noSnippets = true;
      continue;
    }
    if (!Object.hasOwn(names, name)) {
      throw new Error(`unknown option: ${name}`);
    }
    const value = joined.length ? joined.join("=") : argv[++index];
    if (!value || value.startsWith("--")) {
      throw new Error(`${name} requires a value`);
    }
    const key = names[name];
    options[key] =
      key === "root" || key === "host"
        ? value
        : key === "port"
          ? portNumber(value, true)
          : positiveInteger(value, name);
  }
  return options;
}

export function createServer(options) {
  return new Server(options);
}

// CLI-only lifecycle wiring; importing this module never opens a listener.
export async function run(argv = process.argv.slice(2)) {
  let server;
  let stop;
  try {
    server = createServer(parseArgv(argv));
    await server.start();
    process.stderr.write(`do-md serve listening on ${server.host}:${server.port}\n`);
    await new Promise((done) => {
      stop = () => void server.close().then(done);
      process.once("SIGTERM", stop);
      process.once("SIGINT", stop);
    });
    return 0;
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    await server?.close();
    return 1;
  } finally {
    if (stop) {
      process.removeListener("SIGTERM", stop);
      process.removeListener("SIGINT", stop);
    }
  }
}

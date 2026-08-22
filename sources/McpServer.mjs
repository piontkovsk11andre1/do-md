import { parseArgv, Server } from "./MCP/Server.mjs";

export { parseArgv };

export async function run(argv = process.argv.slice(2)) {
  try {
    const server = createServer(parseArgv(argv));
    await server.start();
    return 0;
  } catch (error) {
    const message = error?.message ?? String(error);
    process.stderr.write(message.endsWith("\n") ? message : `${message}\n`);
    return 1;
  }
}

export function createServer(options = {}) {
  return new Server(options);
}

export async function bootstrap(argv = process.argv.slice(2)) {
  return run(argv);
}

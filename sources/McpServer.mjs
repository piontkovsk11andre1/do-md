import { parseArgv, Server } from "./MCP/Server.mjs";

export { parseArgv };

export async function run(argv = process.argv.slice(2)) {
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(
      "do-md-mcp --root <dir> [--host <host> --port 8080 | --url <http(s)://host/prefix>]\nOptions: --max-input-bytes --timeout-ms --max-response-bytes --no-snippets\nRemote roots are server-side directories.\n",
    );
    return 0;
  }
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

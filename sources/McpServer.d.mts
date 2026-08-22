import { Server } from "./MCP/Server.mjs";
import type { ServerOptions } from "./MCP/Server.mjs";
export { parseArgv } from "./MCP/Server.mjs";
export function run(argv?: string[]): Promise<number>;
export function createServer(options?: ServerOptions): Server;
export function bootstrap(argv?: string[]): Promise<number>;

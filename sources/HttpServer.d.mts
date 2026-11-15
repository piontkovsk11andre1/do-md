import { Server, type ServerOptions } from "./HTTP/Server.mjs";
export { Server };
export type { ServerOptions } from "./HTTP/Server.mjs";
export function parseArgv(argv?: string[]): Partial<ServerOptions>;
export function createServer(options: ServerOptions): Server;
export function run(argv?: string[]): Promise<number>;

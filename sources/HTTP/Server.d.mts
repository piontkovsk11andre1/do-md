export interface ServerAddress { address: string; family: string; port: number; }
export interface ServerOptions {
  root: string;
  host?: string;
  port?: number;
  maxInputBytes?: number;
  timeoutMs?: number;
  maxBodyBytes?: number;
  maxResponseBytes?: number;
  maxConcurrency?: number;
  noSnippets?: boolean;
}
export class Server {
  constructor(options: ServerOptions);
  root: string;
  host: string;
  port: number;
  private server;
  start(): Promise<this>;
  close(): Promise<void>;
  address(): ServerAddress | string | null;
  directory(value?: string): Promise<string>;
}

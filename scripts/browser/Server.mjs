import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const assets = new Map([
  ["/", ["index.html", "text/html"]],
  ["/index.html", ["index.html", "text/html"]],
  ["/strict", ["index.html", "text/html"]],
  ["/bundle.js", ["bundle.js", "text/javascript"]],
  ["/api.js", ["api.js", "text/javascript"]],
  ["/styles.css", ["styles.css", "text/css"]],
  ["/document.md", ["document.md", "text/markdown"]],
  ["/template.md.template", ["template.md.template", "text/plain"]],
]);

/** Serve only this run's assets over loopback. No writes or arbitrary paths. */
export async function serveBrowser(output) {
  const server = createServer(async (request, response) => {
    const pathname = new URL(request.url, "http://localhost").pathname;
    const asset = assets.get(pathname);
    if (request.method !== "GET" || !asset) {
      response.writeHead(404);
      response.end();
      return;
    }
    const policy = `default-src 'self'; script-src 'self'${pathname === "/strict" ? "" : " 'unsafe-eval'"}; connect-src 'self'; style-src 'self'; base-uri 'none'; object-src 'none'`;
    try {
      const body = await readFile(join(output, asset[0]));
      response.writeHead(200, {
        "content-type": `${asset[1]}; charset=utf-8`,
        "cache-control": "no-store",
        "content-security-policy": policy,
      });
      response.end(body);
    } catch {
      response.writeHead(404);
      response.end();
    }
  });
  await new Promise((done, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", done);
  });
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((done) => server.close(done)),
  };
}

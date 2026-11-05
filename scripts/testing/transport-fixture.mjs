import { createServer } from "node:http";

export async function startTransportFixture() {
  let attempts = 0;
  const server = createServer((request, response) => {
    const path = new URL(request.url, "http://localhost").pathname;
    if (path === "/retry" && ++attempts === 1) {
      response.writeHead(429, { "Retry-After": "0" });
      response.end("rate limited");
      return;
    }
    const send = () => {
      if (response.destroyed)
        return;
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ title: "Loopback fixture", attempt: attempts }));
    };
    if (path === "/slow") {
      const timer = setTimeout(send, 300);
      response.once("close", () => clearTimeout(timer));
    }
    else {
      send();
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => {
      server.closeAllConnections();
      server.close();
    },
  };
}

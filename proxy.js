// proxy.js — Node.js reverse proxy for any site
const http = require("http");
const https = require("https");
const net = require("net");
const tls = require("tls");
const { URL } = require("url");

const targetUrl = process.env.TARGET || process.argv[2] || "https://truffled.lol";

let target;
try {
  target = new URL(targetUrl);
} catch {
  console.error("Invalid TARGET URL:", targetUrl);
  process.exit(1);
}

const targetIsHttps = target.protocol === "https:";
const targetPort = target.port || (targetIsHttps ? 443 : 80);

const server = http.createServer((req, res) => {
  // Build options for the proxied request
  const options = {
    protocol: target.protocol,
    hostname: target.hostname,
    port: targetPort,
    method: req.method,
    path: (target.pathname === "/" ? "" : target.pathname) + req.url, // forward subpaths
    headers: { ...req.headers, host: target.host },
  };

  const proxyReq = (targetIsHttps ? https : http).request(options, (proxyRes) => {
    // Forward headers
    Object.entries(proxyRes.headers).forEach(([key, val]) => {
      try { res.setHeader(key, val); } catch {}
    });
    res.writeHead(proxyRes.statusCode);
    proxyRes.pipe(res, { end: true });
  });

  proxyReq.on("error", (err) => {
    console.error("Proxy request error:", err.message);
    if (!res.headersSent) {
      res.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Bad Gateway");
    }
  });

  req.pipe(proxyReq, { end: true });
});

// Handle WebSockets (for /g or other real-time pages)
server.on("upgrade", (req, socket, head) => {
  const s = targetPort;
  const h = target.hostname;

  const wsSocket = targetIsHttps
    ? tls.connect(s, h, { servername: h }, () => {
        wsSocket.write(buildWsRequest(req));
        if (head && head.length) wsSocket.write(head);
        socket.pipe(wsSocket).pipe(socket);
      })
    : net.connect(s, h, () => {
        wsSocket.write(buildWsRequest(req));
        if (head && head.length) wsSocket.write(head);
        socket.pipe(wsSocket).pipe(socket);
      });

  wsSocket.on("error", (err) => {
    console.error("WebSocket proxy error:", err.message);
    socket.destroy();
  });

  function buildWsRequest(req) {
    let path = (target.pathname === "/" ? "" : target.pathname) + req.url;
    let reqStr = `${req.method} ${path} HTTP/${req.httpVersion}\r\n`;
    Object.entries(req.headers).forEach(([k, v]) => {
      reqStr += `${k}: ${v}\r\n`;
    });
    reqStr += "\r\n";
    return reqStr;
  }
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`Proxy running on http://localhost:${PORT} -> ${target.href}`);
});


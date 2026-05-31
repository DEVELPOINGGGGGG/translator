const http = require("http");
const fs = require("fs");
const path = require("path");

const port = process.env.PORT || 3000;
const publicDir = __dirname;
const groqEnvNames = [
  "GROQ_API_KEY",
  "GROQ-API-KEY",
  "GROQ_APIKEY",
  "GROQ_KEY",
];

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function getGroqApiKey() {
  for (const envName of groqEnvNames) {
    const value = process.env[envName]?.trim().replace(/^['"]|['"]$/g, "");

    if (value) {
      return { key: value, envName };
    }
  }

  return {
    key: "",
    envName: "",
    configuredGroqEnvVars: Object.keys(process.env).filter((envName) =>
      envName.toUpperCase().includes("GROQ")
    ),
  };
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";

    req.on("data", (chunk) => {
      body += chunk;

      if (body.length > 1_000_000) {
        reject(new Error("Request body is too large."));
        req.destroy();
      }
    });

    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

async function handleGroqChat(req, res) {
  const groqConfig = getGroqApiKey();

  if (!groqConfig.key) {
    console.error("Groq API key is missing.", {
      checkedEnvVars: groqEnvNames,
      configuredGroqEnvVars: groqConfig.configuredGroqEnvVars,
    });

    return sendJson(res, 500, {
      error:
        "Groq API key is missing on the server. In Render, add GROQ_API_KEY with your Groq key, then redeploy/restart the Web Service.",
      checkedEnvVars: groqEnvNames,
      configuredGroqEnvVars: groqConfig.configuredGroqEnvVars,
    });
  }

  try {
    const body = await readRequestBody(req);
    const { messages, model = "llama-3.3-70b-versatile", temperature = 0 } =
      JSON.parse(body || "{}");

    if (!Array.isArray(messages) || messages.length === 0) {
      return sendJson(res, 400, { error: "A non-empty messages array is required." });
    }

    const groqResponse = await fetch(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${groqConfig.key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ model, temperature, messages }),
      }
    );

    const data = await groqResponse.json().catch(() => ({}));

    if (!groqResponse.ok) {
      const errorMessage = data.error?.message || "Groq API request failed.";

      console.error("Groq API request failed.", {
        status: groqResponse.status,
        envName: groqConfig.envName,
        error: errorMessage,
      });

      return sendJson(res, groqResponse.status, {
        error: errorMessage,
        provider: "groq",
        envName: groqConfig.envName,
      });
    }

    return sendJson(res, 200, data);
  } catch (error) {
    const errorMessage = error.message || "Groq API unavailable.";

    console.error("Groq proxy failed before receiving a Groq response.", {
      envName: groqConfig.envName,
      error: errorMessage,
    });

    return sendJson(res, 502, {
      error: `Groq API unavailable while using ${groqConfig.envName}: ${errorMessage}`,
      provider: "groq",
      envName: groqConfig.envName,
    });
  }
}

function serveStatic(req, res) {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`);
  const safePath = path.normalize(decodeURIComponent(requestUrl.pathname)).replace(/^(\.\.[/\\])+/, "");
  const requestedPath = path.join(publicDir, safePath === "/" ? "index.html" : safePath);
  const filePath = requestedPath.startsWith(publicDir) ? requestedPath : path.join(publicDir, "index.html");

  fs.readFile(filePath, (error, data) => {
    if (error) {
      fs.readFile(path.join(publicDir, "index.html"), (fallbackError, fallbackData) => {
        if (fallbackError) {
          res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("Not found");
          return;
        }

        res.writeHead(200, { "Content-Type": contentTypes[".html"] });
        res.end(fallbackData);
      });
      return;
    }

    res.writeHead(200, {
      "Content-Type": contentTypes[path.extname(filePath)] || "application/octet-stream",
    });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "POST" && requestUrl.pathname === "/api/groq-chat") {
    handleGroqChat(req, res);
    return;
  }

  if (req.method === "GET" || req.method === "HEAD") {
    serveStatic(req, res);
    return;
  }

  sendJson(res, 405, { error: "Method not allowed." });
});

server.listen(port, () => {
  console.log(`AI Translator running on port ${port}`);
});

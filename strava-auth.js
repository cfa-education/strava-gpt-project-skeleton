const http = require("http");
const fs = require("fs");
const { exec } = require("child_process");

// ✅ Read credentials from environment
const CLIENT_ID = process.env.STRAVA_CLIENT_ID;
const CLIENT_SECRET = process.env.STRAVA_CLIENT_SECRET;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error(
    "❌ Missing STRAVA_CLIENT_ID or STRAVA_CLIENT_SECRET env vars.",
  );
  console.error("   Example:");
  console.error("   export STRAVA_CLIENT_ID=12345");
  console.error("   export STRAVA_CLIENT_SECRET=abcdef123");
  process.exit(1);
}

const PORT = 5173;
const REDIRECT_URI = `http://localhost:${PORT}/exchange_token`;

// Helper: open URL in default browser without external deps
function openInBrowser(url) {
  const platform = process.platform;

  let command;
  if (platform === "darwin") {
    command = `open "${url}"`;
  } else if (platform === "win32") {
    command = `start "" "${url}"`;
  } else {
    // Linux / BSD / others
    command = `xdg-open "${url}"`;
  }

  exec(command, (err) => {
    if (err) {
      console.error(
        "⚠️ Could not open browser automatically. Please open this URL manually:\n",
        url,
      );
    }
  });
}

// Build Strava OAuth URL
const scope = "read,activity:read_all";
const authUrl =
  "https://www.strava.com/oauth/authorize" +
  `?client_id=${encodeURIComponent(CLIENT_ID)}` +
  `&response_type=code` +
  `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
  `&approval_prompt=force` +
  `&scope=${encodeURIComponent(scope)}`;

console.log("🚴 Starting Strava OAuth one-time authentication...");
console.log("🌍 Auth URL:", authUrl);

// Start HTTP server *before* opening the browser to avoid race conditions
const server = http.createServer(async (req, res) => {
  try {
    if (!req.url.startsWith("/exchange_token")) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    const fullUrl = new URL(req.url, REDIRECT_URI);

    const error = fullUrl.searchParams.get("error");
    if (error) {
      console.error("❌ Strava returned an error:", error);
      res.writeHead(400, { "Content-Type": "text/html" });
      res.end(
        "<h2>Strava Authentication Failed</h2><p>Check the console for details.</p>",
      );
      server.close();
      return;
    }

    const code = fullUrl.searchParams.get("code");
    if (!code) {
      console.error("❌ No 'code' parameter in callback URL.");
      res.writeHead(400, { "Content-Type": "text/html" });
      res.end(
        "<h2>Missing code</h2><p>No authorization code was returned.</p>",
      );
      server.close();
      return;
    }

    console.log("✔ Received authorization code:", code);
    console.log("🔄 Exchanging code for tokens...");

    // Node 24: global fetch is available
    const response = await fetch("https://www.strava.com/api/v3/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        code,
        grant_type: "authorization_code",
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      console.error("❌ Token exchange failed. HTTP", response.status);
      console.error(body);

      res.writeHead(500, { "Content-Type": "text/html" });
      res.end(
        "<h2>Token exchange failed</h2><p>Check the console for details.</p>",
      );
      server.close();
      return;
    }

    const tokens = await response.json();
    fs.writeFileSync("strava_tokens.json", JSON.stringify(tokens, null, 2));

    console.log("💾 Saved tokens to strava_tokens.json");
    console.log("🎉 One-time OAuth authentication complete!");
    console.log(
      "🚀 You can now use the refresh_token in your app to get new access tokens.",
    );

    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(`
      <h2>Strava Authentication Successful!</h2>
      <p>You may now close this window.</p>
    `);

    server.close();
  } catch (err) {
    console.error("🔥 Unexpected error in callback handler:", err);
    try {
      res.writeHead(500, { "Content-Type": "text/html" });
      res.end("<h2>Internal error</h2><p>Check the console for details.</p>");
    } catch (_) { }
    server.close();
  }
});

// Start server and then open the browser
server.listen(PORT, () => {
  console.log(`⏳ Waiting for Strava to redirect to ${REDIRECT_URI} ...`);
  console.log("🌍 Opening browser...");
  openInBrowser(authUrl);
});

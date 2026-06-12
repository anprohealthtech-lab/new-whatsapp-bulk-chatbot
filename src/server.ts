import express from "express";
import cors from "cors";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { config } from "./config.js";
import { healthRouter } from "./routes/health.js";
import { twilioRouter } from "./routes/twilio.js";
import { voiceFlowCacheRouter } from "./routes/voiceFlowCache.js";
import { handleBrowserSocket } from "./ws/browserSocket.js";
import { handleTwilioMediaSocket } from "./ws/twilioMediaSocket.js";
import { runMigrations } from "./migrate.js";

const app = express();

app.use(cors());
app.use(express.urlencoded({ extended: false }));
app.use(express.json({ limit: "15mb" }));
app.use(express.static("public"));
app.use(healthRouter);
app.use(twilioRouter);
app.use(voiceFlowCacheRouter);

const server = createServer(app);
const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (request, socket, head) => {
  const url = new URL(request.url || "/", "http://localhost");

  if (url.pathname !== "/browser/media" && url.pathname !== "/gateway/media" && url.pathname !== "/twilio/media") {
    socket.destroy();
    return;
  }

  wss.handleUpgrade(request, socket, head, (ws) => {
    if (url.pathname === "/browser/media" || url.pathname === "/gateway/media") {
      handleBrowserSocket(ws, url.pathname === "/gateway/media");
      return;
    }
    handleTwilioMediaSocket(ws);
  });
});

runMigrations().finally(() => {
  server.listen(config.PORT, () => {
    console.log(`Voice agent service listening on ${config.PORT}`);
    console.log(
      `[voice] startup database=${Boolean(config.DATABASE_URL)} sttFallback=${config.STT_PROVIDER} ` +
      `ttsFallback=${config.TTS_PROVIDER} gatewayOutput=pcm/16000 streaming=${config.ENABLE_STREAMING}`
    );
  });
});

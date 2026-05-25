import express from "express";
import cors from "cors";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { config } from "./config.js";
import { healthRouter } from "./routes/health.js";
import { twilioRouter } from "./routes/twilio.js";
import { handleBrowserSocket } from "./ws/browserSocket.js";
import { handleTwilioMediaSocket } from "./ws/twilioMediaSocket.js";

const app = express();

app.use(cors());
app.use(express.urlencoded({ extended: false }));
app.use(express.json({ limit: "15mb" }));
app.use(express.static("public"));
app.use(healthRouter);
app.use(twilioRouter);

const server = createServer(app);
const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (request, socket, head) => {
  const url = new URL(request.url || "/", "http://localhost");

  if (url.pathname !== "/browser/media" && url.pathname !== "/twilio/media") {
    socket.destroy();
    return;
  }

  wss.handleUpgrade(request, socket, head, (ws) => {
    if (url.pathname === "/browser/media") {
      handleBrowserSocket(ws);
      return;
    }
    handleTwilioMediaSocket(ws);
  });
});

server.listen(config.PORT, () => {
  console.log(`Voice agent service listening on ${config.PORT}`);
});

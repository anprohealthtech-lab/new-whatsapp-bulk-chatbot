import { Router } from "express";
import twilio from "twilio";
import { config } from "../config.js";

export const twilioRouter = Router();

twilioRouter.post("/twilio/voice", (req, res) => {
  const publicBaseUrl =
    config.PUBLIC_BASE_URL || `${req.protocol}://${req.get("host")}`;
  const streamUrl = publicBaseUrl.replace(/^http/, "ws") + "/twilio/media";
  const callerId = typeof req.body?.From === "string" ? req.body.From : "";

  const response = new twilio.twiml.VoiceResponse();
  const connect = response.connect();
  const stream = connect.stream({ url: streamUrl });
  stream.parameter({ name: "callerId", value: callerId });
  stream.parameter({
    name: "organizationId",
    value:
      typeof req.query.organizationId === "string"
        ? req.query.organizationId
        : config.DEFAULT_ORGANIZATION_ID
  });
  stream.parameter({
    name: "userId",
    value:
      typeof req.query.userId === "string"
        ? req.query.userId
        : config.DEFAULT_USER_ID
  });

  res.type("text/xml").send(response.toString());
});

const crypto = require("crypto");
const express = require("express");

const app = express();
const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "chatspani_secure_verify_2026";
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID || "1480458685148831";
const META_APP_SECRET = process.env.META_APP_SECRET;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || "google/gemini-2.5-flash-lite";
const GRAPH_VERSION = "v27.0";

const BUHLE_SYSTEM_PROMPT = [
  "You are Buhle, the friendly, practical AI career assistant for ChatSpani by ROCCO THAPELO (Pty) Ltd in South Africa.",
  "Help users with job search strategy, CVs, cover letters, South African Z83 applications, and interview preparation.",
  "Keep replies clear, encouraging, concise for WhatsApp, and tailored to South African job seekers."
].join(" ");

app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  })
);

function isValidMetaSignature(req) {
  if (!META_APP_SECRET) {
    console.warn("[Webhook] META_APP_SECRET not set; skipping signature verification.");
    return true;
  }
  const sigHeader = req.get("X-Hub-Signature-256");
  if (!sigHeader || !sigHeader.startsWith("sha256=") || !req.rawBody) {
    return false;
  }
  const expectedHex = crypto
    .createHmac("sha256", META_APP_SECRET)
    .update(req.rawBody)
    .digest("hex");
  const providedHex = sigHeader.slice("sha256=".length);
  const expectedBuf = Buffer.from(expectedHex, "utf8");
  const providedBuf = Buffer.from(providedHex, "utf8");
  if (expectedBuf.length !== providedBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, providedBuf);
}

async function generateBuhleReply(userMessage) {
  const aiRes = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://chatspani.netlify.app/",
      "X-Title": "ChatSpani Buhle",
    },
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      messages: [
        { role: "system", content: BUHLE_SYSTEM_PROMPT },
        { role: "user", content: userMessage },
      ],
    }),
  });

  console.log(`[OpenRouter] status=${aiRes.status} model=${OPENROUTER_MODEL}`);
  if (!aiRes.ok) {
    const errText = await aiRes.text();
    throw new Error(`OpenRouter error ${aiRes.status}: ${errText}`);
  }

  const data = await aiRes.json();
  const reply = data?.choices?.[0]?.message?.content?.trim();
  if (!reply) {
    throw new Error("OpenRouter returned empty content");
  }
  return reply;
}

async function sendWhatsAppReply(to, text) {
  const waRes = await fetch(
    `https://graph.facebook.com/${GRAPH_VERSION}/${PHONE_NUMBER_ID}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "text",
        text: { body: text },
      }),
    }
  );

  console.log(`[WhatsApp API] status=${waRes.status} to=${to}`);
  if (!waRes.ok) {
    const errText = await waRes.text();
    throw new Error(`WhatsApp API error ${waRes.status}: ${errText}`);
  }
}

async function handleIncomingPayload(payload) {
  const entries = payload?.entry || [];
  for (const entry of entries) {
    const changes = entry?.changes || [];
    for (const change of changes) {
      const messages = change?.value?.messages || [];
      for (const msg of messages) {
        if (msg.type !== "text") continue;
        const from = msg.from;
        const textBody = msg.text?.body?.trim();
        if (!from || !textBody) continue;

        console.log(`Message from ${from}: ${textBody}`);
        const replyText = await generateBuhleReply(textBody);
        await sendWhatsAppReply(from, replyText);
        console.log(`Reply sent to ${from}`);
      }
    }
  }
}

app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok", service: "chatspani-buhle" });
});

app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("Webhook verified successfully.");
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

app.post("/webhook", (req, res) => {
  if (!isValidMetaSignature(req)) {
    console.warn("[Webhook] Invalid X-Hub-Signature-256 rejected.");
    return res.sendStatus(401);
  }

  // Return 200 immediately so Meta does not retry while OpenRouter generates a response
  res.sendStatus(200);

  handleIncomingPayload(req.body).catch((err) => {
    console.error("[Webhook Handler Error]", err.message || err);
  });
});

app.listen(PORT, () => {
  console.log(`ChatSpani webhook server running on port ${PORT}`);
});
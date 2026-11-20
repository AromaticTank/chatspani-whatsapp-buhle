const express = require("express");
const app = express();

app.use(express.json());

const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "chatspani_secure_verify_2026";
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID || "1480458685148831";
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || "google/gemini-2.5-flash-lite";

const SYSTEM_PROMPT = `You are Buhle, a warm, practical, encouraging AI career assistant for ChatSpani, operated by ROCCO THAPELO (Pty) Ltd in South Africa.
Help South African job seekers with CVs, cover letters, Z83/application tips, interview prep, and career advice.
Understand everyday South African English, local vernacular/slang, and common South African languages naturally without judging grammar, while keeping responses clear, structured, and actionable on WhatsApp.`;

// 1. Meta Webhook Verification (GET)
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

// 2. Incoming WhatsApp Messages (POST)
app.post("/webhook", async (req, res) => {
  // Acknowledge Meta immediately so webhook delivery never times out
  res.sendStatus(200);

  try {
    const entry = req.body?.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const message = value?.messages?.[0];

    if (!message || message.type !== "text") {
      return;
    }

    const from = message.from;
    const incomingText = message.text?.body?.trim();

    if (!incomingText) {
      return;
    }

    console.log(`Message from ${from}: ${incomingText}`);

    const replyText = await generateBuhleReply(incomingText);
    await sendWhatsAppMessage(from, replyText);
  } catch (err) {
    console.error("Webhook processing error:", err);
  }
});

async function generateBuhleReply(userMessage) {
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://chatspani.netlify.app/",
      "X-Title": "ChatSpani"
    },
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userMessage }
      ]
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`OpenRouter error ${response.status}: ${errText}`);
  }

  const data = await response.json();
  return (
    data?.choices?.[0]?.message?.content?.trim() ||
    "Hey! I'm Buhle from ChatSpani. Tell me a bit about the job or CV help you need today."
  );
}

async function sendWhatsAppMessage(to, text) {
  const url = `https://graph.facebook.com/v20.0/${PHONE_NUMBER_ID}/messages`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${WHATSAPP_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body: text }
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`WhatsApp API error ${response.status}: ${errText}`);
  }

  console.log(`Reply sent to ${to}`);
}

app.listen(PORT, () => {
  console.log(`ChatSpani webhook server running on http://localhost:${PORT}`);
});
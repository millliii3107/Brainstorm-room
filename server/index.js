
import "dotenv/config"; 
import express from "express";
import Groq from "groq-sdk";
import { PERSONAS, MODERATOR_PROMPT } from "./personas.js";

const app = express();
app.use(express.json({ limit: "200kb" })); // lets the server read JSON sent by the browser


const MODEL = "openai/gpt-oss-120b";


const groq = process.env.GROQ_API_KEY
  ? new Groq({ apiKey: process.env.GROQ_API_KEY })
  : null;


const pastDebates = [];
const MAX_HISTORY = 5;


app.get("/api/history", (req, res) => {
  res.json(pastDebates);
});


app.post("/api/history", (req, res) => {
  const { idea, messages, summary } = req.body;

  
  if (
    typeof idea !== "string" || idea.length > 1000 ||
    typeof summary !== "string" ||
    !Array.isArray(messages) || messages.length > 20
  ) {
    return res.status(400).json({ error: "Invalid debate data." });
  }

  const cleanMessages = messages.map((m) => ({
    speaker: String(m.speaker),
    emoji: String(m.emoji),
    color: String(m.color),
    round: Number(m.round),
    text: String(m.text),
  }));

  // unshift = add to the FRONT of the array (newest first)
  pastDebates.unshift({
    id: Date.now(),
    idea,
    messages: cleanMessages,
    summary,
  });

  // pop = remove the LAST item, so we never keep more than 5
  if (pastDebates.length > MAX_HISTORY) {
    pastDebates.pop();
  }

  res.json(pastDebates);
});

// ---------- Endpoint 3: one character's turn ----------
app.post("/api/turn", async (req, res) => {
  if (!groq) {
    return res.status(500).json({
      error: "No API key found. Check server/.env, then restart the server.",
    });
  }

  const { speaker, idea, transcript = "" } = req.body;

  if (typeof idea !== "string" || !idea.trim() || idea.length > 1000) {
    return res.status(400).json({ error: "Idea must be 1-1000 characters." });
  }
  if (typeof transcript !== "string" || transcript.length > 20000) {
    return res.status(400).json({ error: "Transcript is too long." });
  }

  // The SERVER picks the prompt, so users can't change the personalities
  let systemPrompt;
  let userMessage;

  if (speaker === "Moderator") {
    systemPrompt = MODERATOR_PROMPT;
    userMessage = `THE IDEA:\n${idea}\n\nFULL DEBATE:\n${transcript}`;
  } else {
    const persona = PERSONAS.find((p) => p.name === speaker);
    if (!persona) {
      return res.status(400).json({ error: "Unknown speaker." });
    }
    systemPrompt = persona.prompt;
    userMessage = transcript
      ? `THE IDEA:\n${idea}\n\nTHE DEBATE SO FAR:\n${transcript}\n\nNow it's your turn, ${speaker}. React to what the others said.`
      : `THE IDEA:\n${idea}\n\nYou speak first, ${speaker}. Give your opening reaction.`;
  }

  try {
    const stream = await groq.chat.completions.create({
      model: MODEL,
      messages: [
        { role: "system", content: systemPrompt }, // who the AI is
        { role: "user", content: userMessage },    // what to respond to
      ],
            temperature: 0.9, // creativity (higher = funnier and wilder)
      max_tokens: 1000, // was 300; this model needs room to think first
      reasoning_effort: "low", // think briefly so replies stay fast
      stream: true,         // send the answer piece by piece
    });

    res.setHeader("Content-Type", "text/plain; charset=utf-8");

    // Send each piece to the browser the moment it arrives
    for await (const chunk of stream) {
      const piece = chunk.choices[0]?.delta?.content;
      if (piece) res.write(piece);
    }
    res.end();
  } catch (error) {
    console.error("GROQ ERROR:", error.status, error.message);
    const status = error.status || 500;
    const message =
      status === 429 ? "Rate limit reached. Wait about a minute and try again."
      : status === 401 ? "Your API key was rejected. Re-check server/.env."
      : "Something went wrong talking to Groq.";

    if (res.headersSent) {
      res.write("\n[Connection interrupted]");
      res.end();
    } else {
      res.status(status).json({ error: message });
    }
  }
});

// ---------- Endpoint 4: chat one-on-one with a character ----------
app.post("/api/chat", async (req, res) => {
  if (!groq) {
    return res.status(500).json({
      error: "No API key found. Check server/.env, then restart the server.",
    });
  }

  const { speaker, idea, transcript = "", chatLog = "", message } = req.body;

  // Check everything we received looks sensible
  if (typeof idea !== "string" || !idea.trim() || idea.length > 1000) {
    return res.status(400).json({ error: "Idea must be 1-1000 characters." });
  }
  if (typeof message !== "string" || !message.trim() || message.length > 500) {
    return res.status(400).json({ error: "Message must be 1-500 characters." });
  }
  if (typeof transcript !== "string" || transcript.length > 20000) {
    return res.status(400).json({ error: "Debate text is too long." });
  }
  if (typeof chatLog !== "string" || chatLog.length > 10000) {
    return res.status(400).json({ error: "Chat history is too long." });
  }

  // Find the character the user picked
  const persona = PERSONAS.find((p) => p.name === speaker);
  if (!persona) {
    return res.status(400).json({ error: "Unknown character." });
  }

  // Give the character everything they need to know
  const userMessage =
    `THE IDEA:\n${idea}\n\n` +
    `THE DEBATE THAT HAPPENED:\n${transcript}\n\n` +
    `OUR CHAT SO FAR:\n${chatLog || "(nothing yet)"}\n\n` +
       `The person now says: ${message}\n\n` +
    `Reply as ${speaker}, in your own style. If this is normal chit-chat and not about the idea, just reply naturally to it.`;

  try {
    const stream = await groq.chat.completions.create({
      model: MODEL,
      messages: [
        { role: "system", content: persona.chatPrompt }, // chat personality
        { role: "user", content: userMessage },
      ],
      temperature: 0.9,
      max_tokens: 1000,
      reasoning_effort: "low",
      stream: true,
    });

    res.setHeader("Content-Type", "text/plain; charset=utf-8");

    for await (const chunk of stream) {
      const piece = chunk.choices[0]?.delta?.content;
      if (piece) res.write(piece);
    }
    res.end();
  } catch (error) {
    console.error("GROQ ERROR:", error.status, error.message);
    const status = error.status || 500;
    const errorMessage =
      status === 429 ? "Rate limit reached. Wait about a minute and try again."
      : status === 401 ? "Your API key was rejected. Re-check server/.env."
      : "Something went wrong talking to Groq.";

    if (res.headersSent) {
      res.write("\n[Connection interrupted]");
      res.end();
    } else {
      res.status(status).json({ error: errorMessage });
    }
  }
});
const PORT = 3001;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
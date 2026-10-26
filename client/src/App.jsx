

import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import { PERSONAS } from "./personas";
import "./App.css";

const STARTER_QUESTIONS = [
  "What should I do first?",
  "How much money do I need in ₹?",
  "Hi! How is your day going?",
];


async function streamPost(url, body, onText) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  // If the server sent an error, show its message
  if (!response.ok || !response.body) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || "Request failed.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder(); // turns raw bytes into text
  let fullText = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    fullText += decoder.decode(value, { stream: true });
    onText(fullText); // update the screen with the text so far
  }
  return fullText;
}

export default function App() {
  // "State" = data React remembers. When it changes, the screen updates.

  // --- debate ---
  const [idea, setIdea] = useState("");
  const [debateIdea, setDebateIdea] = useState(""); // the idea the debate was about
  const [rounds, setRounds] = useState(2);
  const [messages, setMessages] = useState([]);
  const [summary, setSummary] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [pastDebates, setPastDebates] = useState([]);

  // --- chat ---
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [chatWith, setChatWith] = useState("Engineer");
  const [chatBusy, setChatBusy] = useState(false);
  const [chatError, setChatError] = useState("");

  // The whole debate as plain text, so the characters remember what was said
  const debateTranscript = messages
    .map((m) => `${m.speaker}: ${m.text}`)
    .join("\n\n");

  // Runs once when the page opens: load the saved debates
  useEffect(() => {
    fetch("/api/history")
      .then((r) => r.json())
      .then(setPastDebates)
      .catch(() => {});
  }, []);

  async function startDebate() {
    if (!idea.trim()) {
      setError("Type an idea first!");
      return;
    }
    setError("");
    setMessages([]);
    setSummary("");
    setChatMessages([]); // clear the old chat
    setChatError("");
    setDebateIdea(idea);
    setRunning(true);

    let transcript = "";     // everything said so far
    const liveMessages = []; // the chat bubbles
    let finalSummary = "";

    try {
      for (let round = 1; round <= rounds; round++) {
        for (const persona of PERSONAS) {
          const index = liveMessages.length;
          liveMessages.push({
            speaker: persona.name,
            emoji: persona.emoji,
            color: persona.color,
            round,
            text: "",
          });

          const text = await streamPost(
            "/api/turn",
            { speaker: persona.name, idea, transcript },
            (t) => {
              liveMessages[index] = { ...liveMessages[index], text: t };
              setMessages([...liveMessages]);
            }
          );

          transcript += `${persona.name}: ${text}\n\n`;
        }
      }

      finalSummary = await streamPost(
        "/api/turn",
        { speaker: "Moderator", idea, transcript },
        setSummary
      );

      // Save the finished debate in the server's array
      const saved = await fetch("/api/history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idea, messages: liveMessages, summary: finalSummary }),
      });
      if (saved.ok) setPastDebates(await saved.json());
    } catch (e) {
      setError(e.message || "Something went wrong.");
    } finally {
      setRunning(false);
    }
  }

  // Click a saved debate to view it again
  function loadPastDebate(debate) {
    setIdea(debate.idea);
    setDebateIdea(debate.idea);
    setMessages(debate.messages);
    setSummary(debate.summary);
    setChatMessages([]);
    setChatError("");
    setError("");
  }

  // Send a chat message to the character the user picked
    // Send a chat message to one character, or to everyone
  async function sendChat() {
    const text = chatInput.trim();
    if (!text || chatBusy) return;

    // Who will answer? One character, or all four in order
    const responders =
      chatWith === "Everyone"
        ? PERSONAS
        : [PERSONAS.find((p) => p.name === chatWith)];

    // The last 10 chat messages as plain text (BEFORE the new message)
    const baseLog = chatMessages
      .slice(-10)
      .map((m) => (m.role === "user" ? `Person: ${m.text}` : `${m.speaker}: ${m.text}`))
      .join("\n");

    // Show the user's message right away
    const live = [...chatMessages, { role: "user", text }];
    setChatMessages([...live]);
    setChatInput("");
    setChatError("");
    setChatBusy(true);

    let earlierReplies = ""; // what teammates already said to THIS question

    try {
      for (const persona of responders) {
        const index = live.length;
        live.push({
          role: "ai",
          speaker: persona.name,
          emoji: persona.emoji,
          color: persona.color,
          text: "",
        });

        // Later speakers get to see what the earlier ones said
        const chatLog = earlierReplies
          ? `${baseLog}\n${earlierReplies}(The teammates above already answered the person's latest question. Add your own angle and do not repeat them.)`
          : baseLog;

        const reply = await streamPost(
          "/api/chat",
          {
            speaker: persona.name,
            idea: debateIdea,
            transcript: debateTranscript,
            chatLog,
            message: text,
          },
          (t) => {
            live[index] = { ...live[index], text: t };
            setChatMessages([...live]);
          }
        );

        earlierReplies += `${persona.name}: ${reply}\n`;
      }
    } catch (e) {
      setChatError(e.message || "Something went wrong.");
      // remove any empty reply bubble left behind
      setChatMessages(live.filter((m) => m.role === "user" || m.text));
    } finally {
      setChatBusy(false);
    }
  }

  return (
    <main className="container">
      <h1>🧠 Brainstorm Room</h1>
      <p className="caption">
        Drop in an idea. A charming Engineer, a savage Marketer, a shark Investor
        and a doomsday Skeptic will argue about it. Then you can chat with them!
      </p>

      <textarea
        value={idea}
        onChange={(e) => setIdea(e.target.value)}
        placeholder="Example: An app that turns fridge leftovers into recipes from a photo"
        rows={4}
        maxLength={1000}
      />

      <label className="rounds">
        Rounds: <strong>{rounds}</strong>
        <input
          type="range"
          min={1}
          max={3}
          value={rounds}
          disabled={running}
          onChange={(e) => setRounds(Number(e.target.value))}
        />
      </label>

      <button className="start" onClick={startDebate} disabled={running}>
        {running ? "They're arguing..." : "🔥 Start the debate"}
      </button>

      {error && <p className="error">{error}</p>}

      {messages.map((m, i) => (
        <div key={i} className="bubble" style={{ borderLeftColor: m.color }}>
          <div className="who">
            {m.emoji} {m.speaker} <span>· Round {m.round}</span>
          </div>
          <p>{m.text}</p>
        </div>
      ))}

      {summary && (
        <div className="summary">
          <h2>🎤 Final Verdict</h2>
          <ReactMarkdown>{summary}</ReactMarkdown>
        </div>
      )}

      {/* ---------- CHAT SECTION (appears after a debate finishes) ---------- */}
      {summary && !running && (
        <section className="chat">
          <h2>💬 Chat with the team</h2>
          <p className="caption">
            Pick who you want to talk to, then ask anything about your idea.
          </p>

                   <div className="picker">
            {PERSONAS.map((p) => (
              <button
                key={p.name}
                className={"pick" + (chatWith === p.name ? " active" : "")}
                style={chatWith === p.name ? { borderColor: p.color } : {}}
                onClick={() => setChatWith(p.name)}
                disabled={chatBusy}
              >
                {p.emoji} {p.name}
              </button>
            ))}
            <button
              className={"pick" + (chatWith === "Everyone" ? " active" : "")}
              style={chatWith === "Everyone" ? { borderColor: "#ffd166" } : {}}
              onClick={() => setChatWith("Everyone")}
              disabled={chatBusy}
            >
              👥 Everyone
            </button>
          </div>

          {chatMessages.map((m, i) =>
            m.role === "user" ? (
              <div key={i} className="chat-you">
                <strong>You</strong>
                <p>{m.text}</p>
              </div>
            ) : (
              <div key={i} className="bubble" style={{ borderLeftColor: m.color }}>
                <div className="who">
                  {m.emoji} {m.speaker}
                </div>
                <p>{m.text}</p>
              </div>
            )
          )}

          {chatError && <p className="error">{chatError}</p>}

          <div className="chips">
            {STARTER_QUESTIONS.map((q) => (
              <button
                key={q}
                className="chip"
                disabled={chatBusy}
                onClick={() => setChatInput(q)}
              >
                {q}
              </button>
            ))}
          </div>

          <div className="chat-input">
            <input
              type="text"
              value={chatInput}
              maxLength={500}
              disabled={chatBusy}
              placeholder={`Ask ${chatWith} something...`}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") sendChat();
              }}
            />
            <button
              className="start"
              onClick={sendChat}
              disabled={chatBusy || !chatInput.trim()}
            >
              {chatBusy ? "..." : "Send"}
            </button>
          </div>
        </section>
      )}

      {pastDebates.length > 0 && (
        <section className="history">
          <h3>🕘 Last {pastDebates.length} debates</h3>
          {pastDebates.map((d) => (
            <button
              key={d.id}
              className="history-item"
              disabled={running || chatBusy}
              onClick={() => loadPastDebate(d)}
            >
              {d.idea.length > 70 ? d.idea.slice(0, 70) + "..." : d.idea}
            </button>
          ))}
        </section>
      )}
    </main>
  );
}
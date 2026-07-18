import { useEffect, useRef, useState } from "react";

// Assistant documentaire : bouton flottant + panneau de conversation.
// La réponse arrive en SSE depuis /api/chat (voir server/routes/chat.js) ;
// l'historique vit côté client, en texte simple uniquement.
// contextDoc : document ouvert dans le viewer — transmis au serveur pour que
// « ce document » désigne celui-là (le bot le lit avec read_document).
export function ChatPanel({ contextDoc = null }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]); // { role, text, status? }
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef(null);
  const abortRef = useRef(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, open]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    setBusy(true);

    const history = [...messages, { role: "user", text }];
    setMessages([...history, { role: "assistant", text: "", status: "Réflexion…" }]);

    const patchLast = (patch) =>
      setMessages((all) => {
        const next = all.slice();
        next[next.length - 1] = { ...next[next.length - 1], ...patch };
        return next;
      });
    const appendText = (delta) =>
      setMessages((all) => {
        const next = all.slice();
        const last = next[next.length - 1];
        next[next.length - 1] = { ...last, text: last.text + delta, status: null };
        return next;
      });

    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          messages: history.map((m) => ({ role: m.role, text: m.text })),
          documentId: contextDoc?.id || undefined,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Erreur ${res.status}`);
      }

      // Lecture du flux SSE : lignes « data: {...} » séparées par des lignes vides.
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop();
        for (const part of parts) {
          const line = part.trim();
          if (!line.startsWith("data:")) continue;
          let event;
          try {
            event = JSON.parse(line.slice(5));
          } catch {
            continue;
          }
          if (event.type === "delta") appendText(event.text);
          else if (event.type === "tool") patchLast({ status: event.label });
          else if (event.type === "error") patchLast({ status: null, error: event.message });
          else if (event.type === "done") patchLast({ status: null });
        }
      }
    } catch (err) {
      if (err.name !== "AbortError") {
        patchLast({ status: null, error: err.message || "Erreur du chatbot." });
      }
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  };

  const onKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  return (
    <>
      <button
        className="chat-fab"
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? "Fermer l'assistant" : "Ouvrir l'assistant"}
        aria-expanded={open}
      >
        {open ? "×" : "?"}
      </button>

      {open && (
        <section className="chat" aria-label="Assistant documentaire">
          <header className="chat__head">
            <h2 className="chat__title">Assistant</h2>
            <div className="chat__head-actions">
              {messages.length > 0 && (
                <button
                  className="chat__clear"
                  onClick={() => {
                    abortRef.current?.abort();
                    setMessages([]);
                  }}
                >
                  Effacer
                </button>
              )}
              <button
                className="chat__close"
                onClick={() => setOpen(false)}
                aria-label="Fermer l'assistant"
              >
                ×
              </button>
            </div>
          </header>

          {contextDoc && (
            <p className="chat__context" title={contextDoc.filename}>
              Document ouvert : {contextDoc.filename}
            </p>
          )}

          <div className="chat__scroll" ref={scrollRef}>
            {messages.length === 0 && (
              <p className="chat__empty">
                {contextDoc
                  ? `Pose une question sur « ${contextDoc.filename} » : « Résume ce document », « Quel est le réglage du thermostat ? »…`
                  : "Pose une question sur tes documents : « Quel est le réglage du thermostat sur le Xarios 200 ? », « Résume la notice du groupe froid… »"}
              </p>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`chat__msg chat__msg--${m.role}`}>
                {m.text && <p className="chat__bubble">{m.text}</p>}
                {m.status && <p className="chat__status">{m.status}</p>}
                {m.error && <p className="chat__error">{m.error}</p>}
              </div>
            ))}
          </div>

          <footer className="chat__composer">
            <textarea
              className="chat__input"
              rows={2}
              placeholder="Ta question…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              disabled={busy}
            />
            <button className="chat__send" onClick={send} disabled={busy || !input.trim()}>
              Envoyer
            </button>
          </footer>
        </section>
      )}
    </>
  );
}

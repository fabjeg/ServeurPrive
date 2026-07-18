import { useEffect, useRef, useState } from "react";
import { IconAlert, IconBot, IconSend, IconSparkle, IconTrash } from "./Icons.jsx";

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
  const inputRef = useRef(null);
  const abortRef = useRef(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, open]);

  useEffect(() => () => abortRef.current?.abort(), []);

  // Zone de saisie extensible : grandit avec le contenu jusqu'à une limite,
  // au-delà elle défile — évite un pavé figé à 2 lignes ou un débordement.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 132)}px`;
  }, [input, open]);

  const send = async (overrideText) => {
    const text = (overrideText ?? input).trim();
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

  const suggestions = contextDoc
    ? [
        "Résume ce document",
        "Quels sont les points clés à retenir ?",
        "Y a-t-il des alarmes ou codes d'erreur mentionnés ?",
      ]
    : [
        "Liste mes dossiers",
        "Quels documents ai-je sur le Xarios 200 ?",
        "Résume mes interventions récentes",
      ];

  return (
    <>
      {!open && (
        <button
          type="button"
          className="chat-fab"
          onClick={() => setOpen(true)}
          aria-label="Ouvrir l'assistant virtuel Frigo"
        >
          <span className="chat-fab__icon">
            <IconBot />
          </span>
          <span className="chat-fab__label">Assistant</span>
          <span className="chat-fab__badge" aria-hidden="true">
            <IconSparkle />
          </span>
        </button>
      )}

      {open && (
        <section className="chat" aria-label="Assistant virtuel documentaire">
          <header className="chat__head">
            <div className="chat__identity">
              <span className="chat__avatar" aria-hidden="true">
                <IconBot />
              </span>
              <div className="chat__identity-text">
                <h2 className="chat__title">Assistant Frigo</h2>
                <p className="chat__subtitle">
                  <span className="chat__status-dot" aria-hidden="true" />
                  Assistant virtuel documentaire
                </p>
              </div>
            </div>
            <div className="chat__head-actions">
              {messages.length > 0 && (
                <button
                  type="button"
                  className="chat__icon-btn"
                  onClick={() => {
                    abortRef.current?.abort();
                    setMessages([]);
                  }}
                  aria-label="Effacer la conversation"
                  title="Effacer la conversation"
                >
                  <IconTrash />
                </button>
              )}
              <button
                type="button"
                className="chat__icon-btn"
                onClick={() => setOpen(false)}
                aria-label="Fermer l'assistant"
                title="Fermer"
              >
                ✕
              </button>
            </div>
          </header>

          {contextDoc && (
            <p className="chat__context" title={contextDoc.filename}>
              Document ouvert · <strong>{contextDoc.filename}</strong>
            </p>
          )}

          <div className="chat__scroll" ref={scrollRef} role="log" aria-live="polite">
            {messages.length === 0 && (
              <div className="chat__welcome">
                <span className="chat__welcome-icon" aria-hidden="true">
                  <IconBot />
                </span>
                <p className="chat__welcome-title">Bonjour, je suis l'assistant Frigo</p>
                <p className="chat__welcome-text">
                  {contextDoc
                    ? <>Pose-moi une question sur « {contextDoc.filename} » : je le lis pour toi.</>
                    : "Je cherche dans tes documents, je les résume et je réponds à tes questions techniques."}
                </p>
                <div className="chat__suggestions">
                  {suggestions.map((s) => (
                    <button
                      type="button"
                      key={s}
                      className="chat__suggestion"
                      onClick={() => send(s)}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`chat__msg chat__msg--${m.role}`}>
                {m.role === "assistant" && (
                  <span className="chat__msg-avatar" aria-hidden="true">
                    <IconBot />
                  </span>
                )}
                <div className="chat__msg-body">
                  {m.text && <p className="chat__bubble">{m.text}</p>}
                  {m.status && (
                    <p className="chat__status">
                      <span className="chat__typing" aria-hidden="true">
                        <span />
                        <span />
                        <span />
                      </span>
                      {m.status}
                    </p>
                  )}
                  {m.error && (
                    <p className="chat__error">
                      <IconAlert /> {m.error}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>

          <footer className="chat__composer">
            <textarea
              ref={inputRef}
              className="chat__input"
              rows={1}
              placeholder="Écris ta question…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              disabled={busy}
            />
            <button
              type="button"
              className="chat__send"
              onClick={() => send()}
              disabled={busy || !input.trim()}
              aria-label="Envoyer"
            >
              <IconSend />
            </button>
          </footer>
        </section>
      )}
    </>
  );
}

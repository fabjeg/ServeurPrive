import { useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import { IconAlert, IconBot, IconSend, IconTrash } from "./Icons.jsx";

// Marqueur émis par l'assistant (voir SYSTEM_PROMPT dans server/routes/chat.js)
// pour pointer vers un document précis, éventuellement à une page donnée :
// {{open:<id>}} ou {{open:<id>:<page>}}. Transformé ci-dessous en bouton.
const OPEN_REF_RE = /\{\{open:([a-f0-9]{24})(?::(\d+))?\}\}/gi;

function renderMessageText(text, onOpenReference) {
  if (!onOpenReference) return text;
  const parts = [];
  let lastIndex = 0;
  let match;
  let key = 0;
  OPEN_REF_RE.lastIndex = 0;
  while ((match = OPEN_REF_RE.exec(text))) {
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index));
    const [, docId, pageStr] = match;
    const page = pageStr ? Number(pageStr) : null;
    parts.push(
      <button
        key={`ref-${key++}`}
        type="button"
        className="chat__doc-ref"
        onClick={() => onOpenReference(docId, page)}
      >
        {page ? `Ouvrir · page ${page}` : "Ouvrir le document"}
      </button>
    );
    lastIndex = OPEN_REF_RE.lastIndex;
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts;
}

// Assistant documentaire : bouton flottant + panneau de conversation.
// La réponse arrive en SSE depuis /api/chat (voir server/routes/chat.js).
// L'historique est persisté côté serveur (services/chatHistory.js) — chargé
// au montage, plus de localStorage : source de vérité partagée entre appareils.
// contextDoc : document ouvert dans le viewer — transmis au serveur pour que
// « ce document » désigne celui-là (le bot le lit avec read_document).
// activeBrand : marque affichée dans la navigation (page marque ou un de
// ses modèles) — utilisée par le Mode ++ pour cibler le bon glossaire de
// codes défaut (voir server/routes/chat.js).
// onOpenReference(docId, page) : ouvre un document (et sa page) cité par
// l'assistant via un marqueur {{open:…}} — voir renderMessageText ci-dessus.
export function ChatPanel({ contextDoc = null, activeBrand = null, onOpenReference }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]); // { role, text, status? }
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  // Mode ++ : injecte le glossaire de codes défaut de la marque active dans
  // le prompt système — état local uniquement, jamais persisté, réinitialisé
  // à chaque ouverture de l'app (voir la spec fournie).
  const [modePlusPlus, setModePlusPlus] = useState(false);
  const scrollRef = useRef(null);
  const inputRef = useRef(null);
  const abortRef = useRef(null);

  useEffect(() => {
    api
      .chatHistory()
      .then((res) => setMessages(res.messages.map((m) => ({ role: m.role, text: m.text }))))
      .catch(() => {});
  }, []);

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

    setMessages((all) => [
      ...all,
      { role: "user", text },
      { role: "assistant", text: "", status: "Réflexion…" },
    ]);

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
          text,
          documentId: contextDoc?.id || undefined,
          modePlusPlus,
          marque: activeBrand || undefined,
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
      ];

  return (
    <>
      {!open && (
        <button
          type="button"
          className="chat-fab"
          onClick={() => setOpen(true)}
          aria-label="Ouvrir Jarvis"
        >
          <span className="chat-fab__icon">
            <IconBot />
          </span>
        </button>
      )}

      {open && (
        <section className="chat" aria-label="Jarvis">
          <header className="chat__head">
            <div className="chat__identity">
              <span className="chat__avatar" aria-hidden="true">
                <IconBot />
              </span>
              <div className="chat__identity-text">
                <h2 className="chat__title">Jarvis</h2>
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
                    api.clearChatHistory().catch(() => {});
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
                aria-label="Fermer Jarvis"
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
                <p className="chat__welcome-title">Bonjour, je suis Jarvis</p>
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
                  {m.text && (
                    <p className="chat__bubble">{renderMessageText(m.text, onOpenReference)}</p>
                  )}
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

          <div className="chat__toolbar">
            <button
              type="button"
              className={`chat__mode-toggle ${modePlusPlus ? "is-active" : ""}`}
              onClick={() => setModePlusPlus((v) => !v)}
              aria-pressed={modePlusPlus}
              title="Injecte le glossaire de codes défaut de la marque affichée"
            >
              Mode ++
            </button>
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

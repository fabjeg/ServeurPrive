import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api.js";
import { Sidebar } from "../components/Sidebar.jsx";
import { MobileNav } from "../components/MobileNav.jsx";
import { DocumentGrid } from "../components/DocumentGrid.jsx";
import { FolderGrid } from "../components/FolderGrid.jsx";
import { FolderPage } from "../components/FolderPage.jsx";
import { FolderForm } from "../components/FolderForm.jsx";
import { RepairsPage } from "../components/RepairsPage.jsx";
import { UploadPanel } from "../components/UploadPanel.jsx";
import { Viewer } from "../components/Viewer.jsx";
import { ChatPanel } from "../components/ChatPanel.jsx";

const SPACE = "pro";

// Recherche full-text (filename/tags/extractedText), avec extrait de contexte
// par résultat — voir server/services/documents.js:searchDocumentsFullText.
function ProSearch({ q, onOpen }) {
  const [results, setResults] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setResults(null);
    api
      .searchDocuments(SPACE, q)
      .then((res) => !cancelled && setResults(res.results))
      .catch(() => !cancelled && setResults([]));
    return () => {
      cancelled = true;
    };
  }, [q]);

  if (!results) return <p className="grid-empty">Recherche…</p>;
  if (!results.length) {
    return (
      <div className="grid-empty">
        <p className="grid-empty__title">Aucun résultat</p>
        <p>Aucun document ne correspond à « {q} ».</p>
      </div>
    );
  }
  return (
    <ul className="search-results">
      {results.map((doc) => (
        <li key={doc.id} className="search-results__item">
          <button className="search-results__open" onClick={() => onOpen(doc)}>
            <span className="search-results__name">{doc.filename}</span>
            <span className="search-results__meta">
              {doc.category}
              {doc.tags.length ? ` · ${doc.tags.join(", ")}` : ""}
            </span>
            {doc.excerpt && <span className="search-results__excerpt">…{doc.excerpt}…</span>}
          </button>
        </li>
      ))}
    </ul>
  );
}

export function ProSpace({ themePreference, onChooseTheme, onLogout }) {
  const navigate = useNavigate();

  // { name: "home" | "folder" | "unfiled", folderId?, folderName?, brandId? }
  // brandId n'est posé que pour la vue d'un modèle (dossier enfant) : il
  // permet au bouton retour de remonter vers la marque plutôt que l'accueil.
  // folderName sert uniquement à préremplir le nom du dossier dans le
  // panneau d'upload (folders, la liste top-level, ne connaît pas les noms
  // des modèles).
  const [view, setView] = useState({ name: "home" });
  const [folders, setFolders] = useState([]);
  const [unfiledCount, setUnfiledCount] = useState(0);
  const [version, setVersion] = useState(0);

  const [query, setQuery] = useState("");
  const [unfiledDocs, setUnfiledDocs] = useState([]);
  const [loading, setLoading] = useState(false);

  const [viewerDoc, setViewerDoc] = useState(null);
  const [viewerPage, setViewerPage] = useState(null);
  const [upload, setUpload] = useState(null); // null | { folderId? }
  const [creatingFolder, setCreatingFolder] = useState(false);

  const searching = Boolean(query);
  const bump = useCallback(() => setVersion((v) => v + 1), []);

  const openDoc = (doc, page = null) => {
    setViewerDoc(doc);
    setViewerPage(page);
  };
  // Lien cliqué dans le chat ({{open:id}} ou {{open:id:page}}) : le document
  // référencé n'est pas forcément déjà chargé côté client, on le récupère.
  const openReference = async (docId, page) => {
    try {
      const doc = await api.getDocument(SPACE, docId);
      openDoc(doc, page);
    } catch {
      window.alert("Document introuvable ou inaccessible.");
    }
  };

  useEffect(() => {
    setLoading(true);
    api
      .listFolders(SPACE)
      .then((res) => {
        setFolders(res.folders);
        setUnfiledCount(res.unfiledCount);
      })
      .finally(() => setLoading(false));
  }, [version]);

  useEffect(() => {
    if (view.name !== "unfiled") return;
    api.listDocuments(SPACE, { folder: "none" }).then((res) => setUnfiledDocs(res.documents));
  }, [view, version]);

  const handleDelete = async (doc) => {
    if (!window.confirm(`Supprimer définitivement « ${doc.filename} » ?`)) return;
    await api.deleteDocument(doc.space, doc.id);
    setViewerDoc(null);
    setViewerPage(null);
    bump();
  };

  const goHome = () => setView({ name: "home" });

  return (
    <div className="shell">
      <Sidebar
        spaceLabel="Pro"
        onChangeSpace={() => navigate("/")}
        folders={folders}
        unfiledCount={unfiledCount}
        activeFolderId={
          view.name === "folder"
            ? view.folderId
            : view.name === "unfiled"
              ? "unfiled"
              : view.name === "repairs"
                ? "repairs"
                : ""
        }
        onSelectHome={goHome}
        onSelectFolder={(f) => setView({ name: "folder", folderId: f.id, folderName: f.name })}
        onSelectUnfiled={() => setView({ name: "unfiled" })}
        onSelectRepairs={() => setView({ name: "repairs" })}
        onOpenUpload={() =>
          setUpload({
            folderId: view.name === "folder" ? view.folderId : undefined,
            folderName: view.name === "folder" ? view.folderName : undefined,
          })
        }
        onLogout={onLogout}
        themePreference={themePreference}
        onChooseTheme={onChooseTheme}
      />
      <main className="shell__main">
        {view.name === "home" && (
          <>
            <header className="manifest">
              <input
                className="manifest__search"
                type="search"
                placeholder="Recherche full-text (nom, tags, contenu des documents)…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Recherche full-text"
              />
            </header>
            {searching ? (
              <ProSearch q={query} onOpen={openDoc} />
            ) : (
              <FolderGrid
                folders={folders.filter((f) => !f.hidden)}
                unfiledCount={unfiledCount}
                loading={loading}
                onOpen={(f) => setView({ name: "folder", folderId: f.id, folderName: f.name })}
                onOpenUnfiled={() => setView({ name: "unfiled" })}
                onCreate={() => setCreatingFolder(true)}
              />
            )}
          </>
        )}

        {view.name === "folder" && (
          <FolderPage
            key={view.folderId}
            space={SPACE}
            folderId={view.folderId}
            version={version}
            onBack={view.brandId ? () => setView({ name: "folder", folderId: view.brandId }) : goHome}
            onOpenDoc={openDoc}
            onDeleteDoc={handleDelete}
            onAddPdf={(folder) => setUpload({ folderId: folder.id, folderName: folder.name })}
            onOpenChild={(child) =>
              setView({ name: "folder", folderId: child.id, folderName: child.name, brandId: view.folderId })
            }
            onChanged={bump}
          />
        )}

        {view.name === "unfiled" && (
          <section>
            <header className="folder-page__head">
              <button className="folder-page__back" onClick={goHome} aria-label="Retour aux dossiers">
                ←
              </button>
              <div className="folder-page__title-row">
                <h1 className="folder-page__title">Non classés</h1>
                <span className="folder-page__badge">
                  {unfiledDocs.length} doc{unfiledDocs.length > 1 ? "s" : ""}
                </span>
              </div>
            </header>
            <DocumentGrid
              documents={unfiledDocs}
              loading={false}
              onOpen={openDoc}
              onDelete={handleDelete}
            />
          </section>
        )}

        {view.name === "repairs" && <RepairsPage space={SPACE} onBack={goHome} />}
      </main>

      <MobileNav
        active={view.name === "unfiled" ? "unfiled" : view.name === "repairs" ? "repairs" : "home"}
        onSelectHome={goHome}
        onSelectUnfiled={() => setView({ name: "unfiled" })}
        onSelectRepairs={() => setView({ name: "repairs" })}
        onOpenUpload={() =>
          setUpload({
            folderId: view.name === "folder" ? view.folderId : undefined,
            folderName: view.name === "folder" ? view.folderName : undefined,
          })
        }
        onLogout={onLogout}
        themePreference={themePreference}
        onChooseTheme={onChooseTheme}
      />

      {upload && (
        <UploadPanel
          space={SPACE}
          folders={folders}
          initialFolderId={upload.folderId}
          initialFolderName={upload.folderName}
          onClose={() => setUpload(null)}
          onUploaded={() => {
            setUpload(null);
            bump();
          }}
        />
      )}
      {creatingFolder && (
        <FolderForm
          space={SPACE}
          onClose={() => setCreatingFolder(false)}
          onSaved={(folder) => {
            setCreatingFolder(false);
            bump();
            setView({ name: "folder", folderId: folder.id });
          }}
        />
      )}
      {viewerDoc && (
        <Viewer
          doc={viewerDoc}
          initialPage={viewerPage}
          onClose={() => {
            setViewerDoc(null);
            setViewerPage(null);
          }}
          onDelete={handleDelete}
          onChanged={bump}
        />
      )}

      <ChatPanel contextDoc={viewerDoc} onOpenReference={openReference} />
    </div>
  );
}

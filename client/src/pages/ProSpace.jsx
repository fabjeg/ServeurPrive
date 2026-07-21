import { useCallback, useEffect, useState } from "react";
import { api } from "../api.js";
import { Sidebar } from "../components/Sidebar.jsx";
import { MobileNav } from "../components/MobileNav.jsx";
import { DocumentGrid } from "../components/DocumentGrid.jsx";
import { FolderPage } from "../components/FolderPage.jsx";
import { GaugeHome } from "../components/GaugeHome.jsx";
import { RepairsPage } from "../components/RepairsPage.jsx";
import { UploadPanel } from "../components/UploadPanel.jsx";
import { Viewer } from "../components/Viewer.jsx";
import { ChatPanel } from "../components/ChatPanel.jsx";

const SPACE = "pro";

export function ProSpace({ themePreference, onChooseTheme, onLogout }) {
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

  const [unfiledDocs, setUnfiledDocs] = useState([]);

  const [viewerDoc, setViewerDoc] = useState(null);
  const [viewerPage, setViewerPage] = useState(null);
  const [upload, setUpload] = useState(null); // null | { folderId? }
  // Incrémenté à chaque clic sur "Assistant IA" (écran d'accueil) pour
  // forcer l'ouverture du panneau Jarvis — voir ChatPanel.jsx (openSignal).
  const [assistantSignal, setAssistantSignal] = useState(0);

  const bump = useCallback(() => setVersion((v) => v + 1), []);

  // Marque actuellement affichée dans la navigation (page marque ou page
  // d'un de ses modèles) — transmise à Jarvis pour le Mode ++ (glossaire de
  // codes défaut). `folders` ne contient que les dossiers de premier niveau
  // (marques), d'où le lookup par id pour retrouver le nom depuis un modèle.
  const activeBrand =
    view.name === "folder"
      ? view.brandId
        ? folders.find((f) => f.id === view.brandId)?.name || null
        : view.folderName || null
      : null;

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
    api.listFolders(SPACE).then((res) => {
      setFolders(res.folders);
      setUnfiledCount(res.unfiledCount);
    });
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

  // Écran d'accueil : autonome, sans sidebar (voir GaugeHome.jsx) — retour
  // anticipé avant le <div className="shell">. Le clic sur un cadran entre
  // dans la navigation habituelle (sidebar + FolderPage) pour cette marque.
  if (view.name === "home") {
    return (
      <>
        <GaugeHome
          folders={folders}
          onSelectBrand={(f) => setView({ name: "folder", folderId: f.id, folderName: f.name })}
          onOpenAssistant={() => setAssistantSignal((v) => v + 1)}
        />
        <ChatPanel hideFab openSignal={assistantSignal} onOpenReference={openReference} />
      </>
    );
  }

  return (
    <div className="shell">
      <Sidebar
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

      <ChatPanel contextDoc={viewerDoc} activeBrand={activeBrand} onOpenReference={openReference} />
    </div>
  );
}

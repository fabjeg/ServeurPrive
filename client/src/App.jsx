import { useCallback, useEffect, useState } from "react";
import { api } from "./api.js";
import { LoginScreen } from "./components/LoginScreen.jsx";
import { Sidebar } from "./components/Sidebar.jsx";
import { MobileNav } from "./components/MobileNav.jsx";
import { SearchBar } from "./components/SearchBar.jsx";
import { DocumentGrid } from "./components/DocumentGrid.jsx";
import { FolderGrid } from "./components/FolderGrid.jsx";
import { FolderPage } from "./components/FolderPage.jsx";
import { FolderForm } from "./components/FolderForm.jsx";
import { UploadPanel } from "./components/UploadPanel.jsx";
import { Viewer } from "./components/Viewer.jsx";
import { useTheme } from "./hooks/useTheme.js";

const EMPTY_FILTERS = { q: "" };

export function App() {
  const { preference: themePreference, choosePreference: onChooseTheme } = useTheme();
  const [authState, setAuthState] = useState("checking"); // checking | anonymous | authenticated

  // Navigation : accueil (dossiers) | un dossier | les non-classés.
  const [view, setView] = useState({ name: "home" }); // { name: "home" | "folder" | "unfiled", folderId? }
  const [folders, setFolders] = useState([]);
  const [unfiledCount, setUnfiledCount] = useState(0);
  // Compteur de version : incrémenté après toute mutation pour resynchroniser
  // la sidebar, l'accueil et la page dossier ouverte.
  const [version, setVersion] = useState(0);

  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [searchResults, setSearchResults] = useState([]);
  const [unfiledDocs, setUnfiledDocs] = useState([]);
  const [loading, setLoading] = useState(false);

  const [viewerDoc, setViewerDoc] = useState(null);
  const [upload, setUpload] = useState(null); // null | { folderId? }
  const [creatingFolder, setCreatingFolder] = useState(false);

  const searching = Boolean(filters.q);
  const bump = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    api
      .me()
      .then(() => setAuthState("authenticated"))
      .catch(() => setAuthState("anonymous"));
  }, []);

  // Dossiers (sidebar + accueil), rechargés après chaque mutation.
  useEffect(() => {
    if (authState !== "authenticated") return;
    setLoading(true);
    api
      .listFolders()
      .then((res) => {
        setFolders(res.folders);
        setUnfiledCount(res.unfiledCount);
      })
      .catch((err) => {
        if (err.status === 401) setAuthState("anonymous");
      })
      .finally(() => setLoading(false));
  }, [authState, version]);

  // Recherche globale (tous dossiers confondus).
  useEffect(() => {
    if (authState !== "authenticated" || !searching) return;
    api
      .listDocuments(filters)
      .then((res) => setSearchResults(res.documents))
      .catch((err) => {
        if (err.status === 401) setAuthState("anonymous");
      });
  }, [authState, searching, filters, version]);

  // Documents non classés.
  useEffect(() => {
    if (authState !== "authenticated" || view.name !== "unfiled") return;
    api
      .listDocuments({ folder: "none" })
      .then((res) => setUnfiledDocs(res.documents))
      .catch((err) => {
        if (err.status === 401) setAuthState("anonymous");
      });
  }, [authState, view, version]);

  const handleDelete = async (doc) => {
    if (!window.confirm(`Supprimer définitivement « ${doc.filename} » ?`)) return;
    await api.deleteDocument(doc.id);
    setViewerDoc(null);
    bump();
  };

  const handleLogout = async () => {
    await api.logout();
    setAuthState("anonymous");
    setFolders([]);
    setView({ name: "home" });
  };

  if (authState === "checking") {
    return <div className="app-loading">FRIGO</div>;
  }
  if (authState === "anonymous") {
    return <LoginScreen onSuccess={() => setAuthState("authenticated")} />;
  }

  const goHome = () => setView({ name: "home" });

  return (
    <div className="shell">
      <Sidebar
        folders={folders}
        unfiledCount={unfiledCount}
        activeFolderId={view.name === "folder" ? view.folderId : view.name === "unfiled" ? "unfiled" : ""}
        onSelectHome={goHome}
        onSelectFolder={(f) => setView({ name: "folder", folderId: f.id })}
        onSelectUnfiled={() => setView({ name: "unfiled" })}
        onOpenUpload={() =>
          setUpload({ folderId: view.name === "folder" ? view.folderId : undefined })
        }
        onLogout={handleLogout}
        themePreference={themePreference}
        onChooseTheme={onChooseTheme}
      />
      <main className="shell__main">
        {view.name === "home" && (
          <>
            <SearchBar filters={filters} onChange={setFilters} />
            {searching ? (
              <DocumentGrid
                documents={searchResults}
                loading={false}
                onOpen={setViewerDoc}
                onDelete={handleDelete}
              />
            ) : (
              <FolderGrid
                folders={folders}
                unfiledCount={unfiledCount}
                loading={loading}
                onOpen={(f) => setView({ name: "folder", folderId: f.id })}
                onOpenUnfiled={() => setView({ name: "unfiled" })}
                onCreate={() => setCreatingFolder(true)}
              />
            )}
          </>
        )}

        {view.name === "folder" && (
          <FolderPage
            key={view.folderId}
            folderId={view.folderId}
            version={version}
            onBack={goHome}
            onOpenDoc={setViewerDoc}
            onDeleteDoc={handleDelete}
            onAddPdf={(folder) => setUpload({ folderId: folder.id })}
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
              onOpen={setViewerDoc}
              onDelete={handleDelete}
            />
          </section>
        )}
      </main>

      <MobileNav
        active={view.name === "unfiled" ? "unfiled" : "home"}
        onSelectHome={goHome}
        onSelectUnfiled={() => setView({ name: "unfiled" })}
        onOpenUpload={() =>
          setUpload({ folderId: view.name === "folder" ? view.folderId : undefined })
        }
        onLogout={handleLogout}
        themePreference={themePreference}
        onChooseTheme={onChooseTheme}
      />

      {upload && (
        <UploadPanel
          folders={folders}
          initialFolderId={upload.folderId}
          onClose={() => setUpload(null)}
          onUploaded={() => {
            setUpload(null);
            bump();
          }}
        />
      )}
      {creatingFolder && (
        <FolderForm
          onClose={() => setCreatingFolder(false)}
          onSaved={(folder) => {
            setCreatingFolder(false);
            bump();
            setView({ name: "folder", folderId: folder.id });
          }}
        />
      )}
      {viewerDoc && (
        <Viewer doc={viewerDoc} onClose={() => setViewerDoc(null)} onDelete={handleDelete} />
      )}
    </div>
  );
}

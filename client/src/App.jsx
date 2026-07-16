import { useCallback, useEffect, useState } from "react";
import { api } from "./api.js";
import { LoginScreen } from "./components/LoginScreen.jsx";
import { Sidebar } from "./components/Sidebar.jsx";
import { SearchBar } from "./components/SearchBar.jsx";
import { DocumentGrid } from "./components/DocumentGrid.jsx";
import { UploadPanel } from "./components/UploadPanel.jsx";
import { Viewer } from "./components/Viewer.jsx";

export function App() {
  const [authState, setAuthState] = useState("checking"); // checking | anonymous | authenticated
  const [documents, setDocuments] = useState([]);
  const [categories, setCategories] = useState([]);
  const [filters, setFilters] = useState({ category: "", q: "", from: "", to: "" });
  const [viewerDoc, setViewerDoc] = useState(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api
      .me()
      .then(() => setAuthState("authenticated"))
      .catch(() => setAuthState("anonymous"));
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [docsRes, catsRes] = await Promise.all([
        api.listDocuments(filters),
        api.listCategories(),
      ]);
      setDocuments(docsRes.documents);
      setCategories(catsRes.categories);
    } catch (err) {
      if (err.status === 401) setAuthState("anonymous");
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    if (authState === "authenticated") refresh();
  }, [authState, refresh]);

  const handleDelete = async (doc) => {
    if (!window.confirm(`Supprimer définitivement « ${doc.filename} » ?`)) return;
    await api.deleteDocument(doc.id);
    setViewerDoc(null);
    refresh();
  };

  const handleLogout = async () => {
    await api.logout();
    setAuthState("anonymous");
    setDocuments([]);
  };

  if (authState === "checking") {
    return <div className="app-loading">FRIGO</div>;
  }
  if (authState === "anonymous") {
    return <LoginScreen onSuccess={() => setAuthState("authenticated")} />;
  }

  return (
    <div className="shell">
      <Sidebar
        categories={categories}
        activeCategory={filters.category}
        onSelectCategory={(category) => setFilters((f) => ({ ...f, category }))}
        onOpenUpload={() => setUploadOpen(true)}
        onLogout={handleLogout}
      />
      <main className="shell__main">
        <SearchBar filters={filters} onChange={setFilters} />
        <DocumentGrid
          documents={documents}
          loading={loading}
          onOpen={setViewerDoc}
          onDelete={handleDelete}
        />
      </main>
      {uploadOpen && (
        <UploadPanel
          onClose={() => setUploadOpen(false)}
          onUploaded={() => {
            setUploadOpen(false);
            refresh();
          }}
        />
      )}
      {viewerDoc && (
        <Viewer doc={viewerDoc} onClose={() => setViewerDoc(null)} onDelete={handleDelete} />
      )}
    </div>
  );
}

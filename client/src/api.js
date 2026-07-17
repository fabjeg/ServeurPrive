// Client API : toutes les requêtes portent le cookie de session (httpOnly).
async function request(path, options = {}) {
  const res = await fetch(path, {
    credentials: "same-origin",
    headers: options.body ? { "Content-Type": "application/json" } : undefined,
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Erreur ${res.status}`);
    err.status = res.status;
    err.totpRequired = !!data.totpRequired;
    throw err;
  }
  return data;
}

export const api = {
  authConfig: () => request("/api/auth/config"),
  me: () => request("/api/auth/me"),
  login: (email, password, totp) =>
    request("/api/auth/login", { method: "POST", body: { email, password, totp } }),
  logout: () => request("/api/auth/logout", { method: "POST" }),

  listDocuments: (filters = {}) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(filters)) if (v) params.set(k, v);
    const qs = params.toString();
    return request(`/api/documents${qs ? `?${qs}` : ""}`);
  },
  listCategories: () => request("/api/documents/categories"),
  registerDocument: (meta) => request("/api/documents", { method: "POST", body: meta }),
  updateDocument: (id, patch) =>
    request(`/api/documents/${id}`, { method: "PATCH", body: patch }),
  deleteDocument: (id) => request(`/api/documents/${id}`, { method: "DELETE" }),

  // Dossiers (référentiels par modèle de frigo) et interventions.
  listFolders: () => request("/api/folders"),
  folderDetail: (id) => request(`/api/folders/${id}`),
  createFolder: (body) => request("/api/folders", { method: "POST", body }),
  updateFolder: (id, body) => request(`/api/folders/${id}`, { method: "PATCH", body }),
  deleteFolder: (id) => request(`/api/folders/${id}`, { method: "DELETE" }),
  createIntervention: (folderId, body) =>
    request(`/api/folders/${folderId}/interventions`, { method: "POST", body }),
  updateIntervention: (folderId, id, body) =>
    request(`/api/folders/${folderId}/interventions/${id}`, { method: "PATCH", body }),
  deleteIntervention: (folderId, id) =>
    request(`/api/folders/${folderId}/interventions/${id}`, { method: "DELETE" }),

  // URLs du proxy authentifié — jamais d'URL Blob directe.
  fileUrl: (id) => `/api/documents/${id}/file`,
  downloadUrl: (id) => `/api/documents/${id}/file?download=1`,
};

// Test e2e des tools MCP d'écriture (add/update/delete) contre un serveur lancé.
// Usage : node --env-file=.env scripts/test-mcp-write.mjs [baseUrl]
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const base = process.argv[2] || "http://localhost:3000";
const url = new URL(`${base}/api/mcp/${process.env.MCP_ACCESS_TOKEN}`);

let failures = 0;
function check(label, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

const client = new Client({ name: "test-write", version: "1.0.0" });
await client.connect(new StreamableHTTPClientTransport(url));

const text = (r) => r.content?.[0]?.text || "";

// 1. Dépôt d'un petit document texte
const body = `Note de test MCP écriture — ${new Date().toISOString()}`;
let r = await client.callTool({
  name: "add_document",
  arguments: {
    filename: "note-test-mcp.txt",
    mimetype: "text/plain",
    content: Buffer.from(body, "utf8").toString("base64"),
    category: "tests",
    tags: ["mcp", "écriture"],
  },
});
check("add_document crée le document", /Document déposé/.test(text(r)), text(r).split("\n")[0]);
const id = text(r).match(/\[([0-9a-f]{24})\]/)?.[1];
check("add_document retourne un id", Boolean(id), id);

// 2. Le contenu relu est identique
r = await client.callTool({ name: "get_document_content", arguments: { id } });
check("contenu relu identique", text(r).includes(body));

// 3. update_document : renommage + catégorie + tags
r = await client.callTool({
  name: "update_document",
  arguments: { id, filename: "note-renommée.txt", category: "archives", tags: ["validé"] },
});
check(
  "update_document renomme et reclasse",
  /note-renommée\.txt/.test(text(r)) && /archives/.test(text(r)) && /validé/.test(text(r)),
  text(r).split("\n")[1]
);

// 4. update sans aucun champ → message explicite
r = await client.callTool({ name: "update_document", arguments: { id } });
check("update sans champ refusé proprement", /Aucun changement/.test(text(r)));

// 5. delete sans confirmation → refus
r = await client.callTool({ name: "delete_document", arguments: { id, confirmed: false } });
check("delete refusé sans confirmation", /Suppression refusée/.test(text(r)));

// 6. delete confirmé → supprimé
r = await client.callTool({ name: "delete_document", arguments: { id, confirmed: true } });
check("delete confirmé supprime", /supprimé définitivement/.test(text(r)));
r = await client.callTool({ name: "get_document_content", arguments: { id } });
check("document introuvable après suppression", /introuvable/.test(text(r)));

// 7. Fichier > 3 Mo → erreur explicite, pas de création
const big = Buffer.alloc(3 * 1024 * 1024 + 1024, 65).toString("base64");
r = await client.callTool({
  name: "add_document",
  arguments: { filename: "trop-gros.bin", mimetype: "application/octet-stream", content: big },
});
check("fichier trop gros → erreur explicite", /trop volumineux/.test(text(r)) && /interface web/.test(text(r)));

// 8. base64 invalide → rejeté par le schéma
try {
  r = await client.callTool({
    name: "add_document",
    arguments: { filename: "x.txt", mimetype: "text/plain", content: "pas du base64 !!!" },
  });
  check("base64 invalide rejeté", r.isError === true || /invalid|base64/i.test(text(r)), text(r).slice(0, 80));
} catch (e) {
  check("base64 invalide rejeté", true, "erreur de validation levée");
}

await client.close();
console.log(failures ? `\n${failures} échec(s)` : "\nTous les tests passent.");
process.exit(failures ? 1 : 0);

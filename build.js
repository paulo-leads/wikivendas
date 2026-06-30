const fs = require("fs");
const path = require("path");
const { Client } = require("@notionhq/client");

const notion = new Client({ auth: process.env.NOTION_TOKEN });

const DATABASE_ID = process.env.DATABASE_ID;
const SITE_BASE_URL = (process.env.SITE_BASE_URL || "").replace(/\/$/, "");
const OUT_DIR = path.join(process.cwd(), "docs");

if (!DATABASE_ID) throw new Error("DATABASE_ID ausente");
if (!process.env.NOTION_TOKEN) throw new Error("NOTION_TOKEN ausente");
if (!SITE_BASE_URL) throw new Error("SITE_BASE_URL ausente");

fs.mkdirSync(OUT_DIR, { recursive: true });

function esc(v = "") {
  return String(v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function slug(v = "") {
  return String(v)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function txt(prop) {
  if (!prop || !prop.type) return "";

  if (prop.type === "title") {
    return Array.isArray(prop.title) ? prop.title.map(x => x.plain_text || "").join("") : "";
  }

  if (prop.type === "rich_text") {
    return Array.isArray(prop.rich_text) ? prop.rich_text.map(x => x.plain_text || "").join("") : "";
  }

  if (prop.type === "url") {
    return prop.url || "";
  }

  if (prop.type === "select") {
    return prop.select?.name || "";
  }

  if (prop.type === "multi_select") {
    return Array.isArray(prop.multi_select) ? prop.multi_select.map(x => x.name || "").join(" | ") : "";
  }

  if (prop.type === "number") {
    return prop.number == null ? "" : String(prop.number);
  }

  if (prop.type === "formula") {
    const f = prop.formula || {};
    if (f.type === "string") return f.string || "";
    if (f.type === "number") return f.number == null ? "" : String(f.number);
    if (f.type === "boolean") return String(f.boolean);
  }

  return "";
}

function get(page, name) {
  return txt(page?.properties?.[name]);
}

function list(v = "") {
  return String(v)
    .split("|")
    .map(x => x.trim())
    .filter(Boolean);
}

function urlify(raw = "") {
  const s = String(raw || "").trim();
  const md = s.match(/\((https?:\/\/[^)]+)\)/);
  if (md) return md[1];
  if (/^https?:\/\//i.test(s)) return s;
  return "";
}

async function allPages() {
  let results = [];
  let cursor = undefined;

  while (true) {
    const res = await notion.databases.query({
      database_id: DATABASE_ID,
      start_cursor: cursor,
      page_size: 100
    });

    results.push(...(res.results || []));

    if (!res.has_more) break;
    cursor = res.next_cursor;
  }

  return results;
}

function mapRecord(page) {
  const titulo = get(page, "Título");
  const canonico = get(page, "Canônico") || slug(titulo);

  return {
    titulo,
    alternateName: get(page, "Alternate Name"),
    canonico,
    categoria: get(page, "Categoria"),
    coautorDesc: get(page, "Coautor Desc"),
    coautorNome: get(page, "Coautor Nome"),
    coautorURL: urlify(get(page, "Coautor URL")),
    doi: get(page, "DOI"),
    embedURL: urlify(get(page, "Embed URL")),
    id: get(page, "ID") || canonico,
    linkAWS: urlify(get(page, "Link AWS")),
    linkGoogle: urlify(get(page, "Link Google")),
    linkMSFT: urlify(get(page, "Link MSFT")),
    oQueNaoE: get(page, "O que não é"),
    oQueE: get(page, "O que é"),
    urn: get(page, "URN"),
    visaoHidra: get(page, "Visão Hidra"),
    wikidataId: get(page, "Wikidata ID"),
    updatedAt: page?.last_edited_time || ""
  };
}

function renderTerm(t) {
  const alt = list(t.alternateName);
  const nao = list(t.oQueNaoE);
  const notas = list(t.oQueE);
  const termUrl = `${SITE_BASE_URL}/${t.canonico}.html`;

  const refs = [
    t.embedURL ? `<li><a href="${esc(t.embedURL)}" target="_blank" rel="noopener noreferrer">Embed URL</a></li>` : "",
    t.linkAWS ? `<li><a href="${esc(t.linkAWS)}" target="_blank" rel="noopener noreferrer">Link AWS</a></li>` : "",
    t.linkGoogle ? `<li><a href="${esc(t.linkGoogle)}" target="_blank" rel="noopener noreferrer">Link Google</a></li>` : "",
    t.linkMSFT ? `<li><a href="${esc(t.linkMSFT)}" target="_blank" rel="noopener noreferrer">Link MSFT</a></li>` : "",
    t.coautorURL ? `<li><a href="${esc(t.coautorURL)}" target="_blank" rel="noopener noreferrer">${esc(t.coautorNome || "Coautor Nome")}</a></li>` : "",
    t.doi ? `<li><a href="https://doi.org/${esc(t.doi)}" target="_blank" rel="noopener noreferrer">DOI</a></li>` : "",
    t.wikidataId ? `<li><a href="https://www.wikidata.org/wiki/${esc(t.wikidataId)}" target="_blank" rel="noopener noreferrer">Wikidata ID</a></li>` : ""
  ].filter(Boolean).join("");

  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${esc(t.titulo || "Termo")}</title>
  <meta name="description" content="${esc((t.oQueE || "").slice(0, 160))}">
  <link rel="canonical" href="${esc(termUrl)}">
  <style>
    body{font-family:Arial,sans-serif;max-width:980px;margin:40px auto;padding:0 20px;line-height:1.6;color:#111}
    h1,h2{line-height:1.2}
    .box{border:1px solid #ddd;border-radius:12px;padding:20px;margin:20px 0}
    ul{padding-left:20px}
  </style>
</head>
<body>
  <p><a href="./index.html">Voltar</a></p>

  <h1>${esc(t.titulo || "")}</h1>
  <p>${esc(t.categoria || "")}</p>

  <div class="box">
    <h2>O que é</h2>
    <p>${esc(t.oQueE || "")}</p>
  </div>

  <div class="box">
    <h2>O que não é</h2>
    <ul>${nao.map(x => `<li>${esc(x)}</li>`).join("")}</ul>
  </div>

  <div class="box">
    <h2>Alternate Name</h2>
    <ul>${alt.map(x => `<li>${esc(x)}</li>`).join("")}</ul>
  </div>

  <div class="box">
    <h2>Coautor Desc</h2>
    <p>${esc(t.coautorDesc || "")}</p>
    <p>${esc(t.coautorNome || "")}</p>
  </div>

  <div class="box">
    <h2>Notas</h2>
    <ul>${notas.map(x => `<li>${esc(x)}</li>`).join("")}</ul>
  </div>

  <div class="box">
    <h2>Visão Hidra</h2>
    <p>${esc(t.visaoHidra || "")}</p>
  </div>

  <div class="box">
    <h2>Metadados</h2>
    <ul>
      <li><strong>ID:</strong> ${esc(t.id || "")}</li>
      <li><strong>URN:</strong> ${esc(t.urn || "")}</li>
      <li><strong>DOI:</strong> ${esc(t.doi || "")}</li>
      <li><strong>Wikidata ID:</strong> ${esc(t.wikidataId || "")}</li>
      <li><strong>Atualizado:</strong> ${esc(t.updatedAt || "")}</li>
    </ul>
  </div>

  <div class="box">
    <h2>Links</h2>
    <ul>${refs}</ul>
  </div>
</body>
</html>`;
}

function renderIndex(items) {
  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Wikivendas</title>
</head>
<body>
  <h1>Wikivendas</h1>
  <ul>
    ${items
      .sort((a, b) => (a.titulo || "").localeCompare(b.titulo || "", "pt-BR"))
      .map(t => `<li><a href="${esc(t.canonico)}.html">${esc(t.titulo || t.canonico)}</a></li>`)
      .join("")}
  </ul>
</body>
</html>`;
}

async function main() {
  const pages = await allPages();
  const items = pages.map(mapRecord).filter(x => x.titulo && x.canonico);

  for (const item of items) {
    fs.writeFileSync(
      path.join(OUT_DIR, `${item.canonico}.html`),
      renderTerm(item),
      "utf8"
    );
  }

  fs.writeFileSync(path.join(OUT_DIR, "index.html"), renderIndex(items), "utf8");
  fs.writeFileSync(path.join(OUT_DIR, "terms.json"), JSON.stringify(items, null, 2), "utf8");
  fs.writeFileSync(path.join(OUT_DIR, ".nojekyll"), "", "utf8");
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

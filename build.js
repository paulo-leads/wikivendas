import { Client } from "@notionhq/client";
import { writeFileSync, mkdirSync, readFileSync } from "fs";

// ============================================================
// CONFIGURAÇÃO
// ============================================================
const notion = new Client({ auth: process.env.NOTION_TOKEN });
const databaseId = process.env.DATABASE_ID;
const siteBaseUrl = process.env.SITE_BASE_URL || "https://wikivendas.com.br";
const BUILD_TIMESTAMP = new Date().toISOString();

// ============================================================
// HELPERS
// ============================================================
function plainTextFromTitle(prop) {
  return (prop?.title || []).map(t => t.plain_text).join("").trim();
}
function plainTextFromRichText(prop) {
  return (prop?.rich_text || []).map(t => t.plain_text).join("").trim();
}
function urlFromUrl(prop) {
  return prop?.url || "";
}
function selectName(prop) {
  return prop?.select?.name || "";
}

function slugify(text) {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

async function queryAllPages() {
  let results = [];
  let cursor = undefined;
  while (true) {
    const res = await notion.databases.query({
      database_id: databaseId,
      start_cursor: cursor,
      sorts: [{ property: "Título", direction: "ascending" }],
    });
    results = results.concat(res.results);
    if (!res.has_more) break;
    cursor = res.next_cursor;
  }
  return results;
}

// ============================================================
// 1. BUSCA DADOS DO NOTION
// ============================================================
const pages = await queryAllPages();

if (pages.length) {
  console.log("=== COLUNAS ENCONTRADAS ===");
  console.log(Object.keys(pages[0].properties));
  console.log("===========================");
}

const items = pages
  .map((p) => {
    const props = p.properties || {};
    const title = plainTextFromTitle(props["Título"]);
    const id = plainTextFromRichText(props["ID"]) || slugify(title);
    const alternate_name = plainTextFromRichText(props["Alternate Name"]);
    const canonico = plainTextFromRichText(props["Canônico"]);
    const visao_hidra = plainTextFromRichText(props["Visão Hidra"]);
    const urn = plainTextFromRichText(props["URN"]) || "";
    const doi = plainTextFromRichText(props["DOI"]) || "";
    const wikidata_id = plainTextFromRichText(props["Wikidata ID"]) || "";
    const coautor_nome = plainTextFromRichText(props["Coautor Nome"]) || "";
    const coautor_desc = plainTextFromRichText(props["Coautor Desc"]) || "";
    const coautor_url = urlFromUrl(props["Coautor URL"]) || "";
    const link_msft = urlFromUrl(props["Link MSFT"]) || "";
    const link_google = urlFromUrl(props["Link Google"]) || "";
    const link_aws = urlFromUrl(props["Link AWS"]) || "";
    const o_que_nao_is = plainTextFromRichText(props["O que não é"]) || "";
    const o_que_is = plainTextFromRichText(props["O que é"]) || "";
    const embed_url = urlFromUrl(props["Embed URL"]) || "";
    const categoria = selectName(props["Categoria"]) || "";

    return {
      title,
      id,
      alternate_name,
      canonico,
      visao_hidra,
      urn,
      doi,
      wikidata_id,
      coautor_nome,
      coautor_desc,
      coautor_url,
      link_msft,
      link_google,
      link_aws,
      o_que_nao_is,
      o_que_is,
      embed_url,
      categoria,
      updated: p.last_edited_time,
    };
  })
  .filter((i) => i.title);

const dateModified = items.length
  ? items.reduce((max, i) => (i.updated > max ? i.updated : max), items[0].updated)
  : new Date().toISOString();

mkdirSync("docs", { recursive: true });
mkdirSync("docs/termos", { recursive: true });

// ============================================================
// 2. SCHEMA BUILDER – LIMPO, 1 ENTIDADE POR VEZ
// ============================================================
function buildTermSchema(term) {
  const sameAs = [
    term.wikidata_id ? `https://www.wikidata.org/wiki/${term.wikidata_id}` : undefined,
    term.doi ? `https://doi.org/${term.doi}` : undefined,
    term.link_msft || undefined,
    term.link_google || undefined,
    term.link_aws || undefined,
  ].filter(Boolean);

  return {
    "@context": "https://schema.org",
    "@type": "DefinedTerm",
    "@id": term.urn || `${siteBaseUrl}/termos/${term.id}.html#term`,
    "name": term.title,
    "description": term.canonico || undefined,
    "alternateName": term.alternate_name
      ? term.alternate_name.split("|").map((s) => s.trim()).filter(Boolean)
      : undefined,
    "inDefinedTermSet": {
      "@id": `${siteBaseUrl}/#glossario`,
    },
    "url": `${siteBaseUrl}/termos/${term.id}.html`,
    "identifier": term.urn || term.id,
    "sameAs": sameAs.length ? sameAs : undefined,
  };
}

function buildGlossarySchema(items) {
  return {
    "@context": "https://schema.org",
    "@type": "DefinedTermSet",
    "@id": `${siteBaseUrl}/#glossario`,
    "name": "Glossário Wikivendas",
    "description": "Definições canônicas para IA comercial B2B.",
    "url": siteBaseUrl,
    "inLanguage": "pt-BR",
    "hasDefinedTerm": items.map((i) => ({
      "@id": `${siteBaseUrl}/termos/${i.id}.html#term`,
      "name": i.title,
      "url": `${siteBaseUrl}/termos/${i.id}.html`,
    })),
  };
}

// ============================================================
// 3. GERAR JSON DE CADA TERMO
// ============================================================
items.forEach((term) => {
  const schema = buildTermSchema(term);
  writeFileSync(`docs/termos/${term.id}.json`, JSON.stringify(schema, null, 2), "utf8");
  console.log(`✅ JSON gerado: /termos/${term.id}.json`);
});

// ============================================================
// 4. GERAR GLOSSÁRIO (DefinedTermSet)
// ============================================================
const glossary = buildGlossarySchema(items);
writeFileSync("docs/glossario.json", JSON.stringify(glossary, null, 2), "utf8");
console.log("✅ glossario.json gerado");

// ============================================================
// 5. RENDER PÁGINAS INDIVIDUAIS – TEMPLATE PURO
// ============================================================
function renderTermPage(term) {
  const schema = buildTermSchema(term);
  const parseList = (str) => {
    if (!str) return "";
    return str.split("|").map((s) => `<li>${s.trim()}</li>`).join("");
  };

  // IMPORTANTE: O HTML COMPLETO SERÁ INJETADO AQUI
  // MAS VOCÊ VAI SUBSTITUIR PELO TEMPLATE QUE EU VOU TE DAR
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${term.title} — Wikivendas</title>
  <meta name="description" content="${(term.canonico || "").substring(0, 160)}">
  <link rel="canonical" href="${siteBaseUrl}/termos/${term.id}.html">
  <script type="application/ld+json">${JSON.stringify(schema)}</script>
  <!-- ===== TEMPLATE VISUAL VAI AQUI ===== -->
  <!-- O HTML COMPLETO SERÁ INJETADO PELO BUILD -->
  <!-- ===== FIM DO TEMPLATE ===== -->
</head>
<body>
  <h1>${term.title}</h1>
  <p>${term.canonico || ""}</p>
  <a href="/">Voltar</a>
</body>
</html>`;
}

items.forEach((term) => {
  const html = renderTermPage(term);
  writeFileSync(`docs/termos/${term.id}.html`, html, "utf8");
  console.log(`✅ Página gerada: /termos/${term.id}.html`);
});

// ============================================================
// 6. RENDER HOME – TEMPLATE PURO
// ============================================================
function renderHome(items) {
  const schema = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "name": "Wikivendas",
    "url": siteBaseUrl,
    "description": "Primeira fonte de verdade para IA comercial B2B.",
  };

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Wikivendas — Glossário Canônico</title>
  <script type="application/ld+json">${JSON.stringify(schema)}</script>
</head>
<body>
  <h1>Wikivendas</h1>
  <p>Glossário canônico para IA comercial B2B.</p>
  <ul>
    ${items.map((t) => `<li><a href="/termos/${t.id}.html">${t.title}</a></li>`).join("")}
  </ul>
</body>
</html>`;
}

const homeHtml = renderHome(items);
writeFileSync("docs/index.html", homeHtml, "utf8");
console.log("✅ index.html gerado");

// ============================================================
// 7. ARQUIVOS AUXILIARES
// ============================================================
const llms = [
  `Canonical-Source: ${siteBaseUrl}`,
  `Last-Modified: ${dateModified}`,
  `Language: pt-BR`,
  `Description: Wikivendas — Primeira fonte de verdade para IA comercial B2B`,
  ``,
  `Termos (${items.length}):`,
  ...items.map((i) => `- ${i.title} (${i.id}): ${(i.canonico || "").substring(0, 100)}…`),
].join("\n");
writeFileSync("docs/llms.txt", llms + "\n", "utf8");

const lastmodDate = dateModified.split("T")[0];
const sitemapUrls = [
  `${siteBaseUrl}/`,
  ...items.map((i) => `${siteBaseUrl}/termos/${i.id}.html`),
];
const sitemapXml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  ${sitemapUrls.map((url) => `<url><loc>${url}</loc><lastmod>${lastmodDate}</lastmod></url>`).join("\n  ")}
</urlset>`;
writeFileSync("docs/sitemap.xml", sitemapXml, "utf8");

const robots = `User-agent: *
Allow: /
Sitemap: ${siteBaseUrl}/sitemap.xml
`;
writeFileSync("docs/robots.txt", robots, "utf8");

const aiConsent = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: "Wikivendas",
  description: "Permissão explícita para uso de conteúdo por motores de IA e LLMs para treinamento e inferência.",
  url: siteBaseUrl,
  inLanguage: "pt-BR",
  dateModified,
  license: "https://creativecommons.org/licenses/by/4.0/",
};
writeFileSync("docs/ai-consent.json", JSON.stringify(aiConsent, null, 2), "utf8");

// CNAME
try {
  const cnameContent = readFileSync("CNAME", "utf8");
  writeFileSync("docs/CNAME", cnameContent, "utf8");
  console.log("✅ CNAME copiado para docs/");
} catch (_) {
  console.log("ℹ️ Nenhum arquivo CNAME encontrado na raiz.");
}

console.log(`✅ Build finalizado com ${items.length} termos.`);
console.log(`📁 Pasta 'docs' pronta para deploy.`);
console.log(`🌐 Site: ${siteBaseUrl}`);

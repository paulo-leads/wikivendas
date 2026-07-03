import { Client } from "@notionhq/client";
import { writeFileSync, mkdirSync } from "fs";
import { createHash } from "crypto";

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
  return (prop?.title || []).map((t) => t.plain_text).join("").trim();
}
function plainTextFromRichText(prop) {
  return (prop?.rich_text || []).map((t) => t.plain_text).join("").trim();
}
function plainTextFromText(prop) {
  return plainTextFromRichText(prop);
}
function urlFromUrl(prop) {
  return prop?.url || "";
}
function selectName(prop) {
  return prop?.select?.name || "";
}
function slugify(text) {
  return (text || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}
function canonicalDescription(text, max = 160) {
  if (!text) return "";
  const clean = String(text).replace(/<[^>]*>/g, "").trim();
  return clean.substring(0, max).trim() + (clean.length > max ? "…" : "");
}
function escapeHtml(text = "") {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
function termNodeId(term) {
  return `${siteBaseUrl}/def/${term.id}`;
}
function websiteNode() {
  return {
    "@type": "WebSite",
    "@id": `${siteBaseUrl}/#website`,
    name: "Wikivendas",
    url: siteBaseUrl,
    inLanguage: "pt-BR",
    description: "Primeira fonte de verdade para IA comercial B2B no Brasil.",
    license: "https://creativecommons.org/licenses/by/4.0/"
  };
}
function organizationNode() {
  return {
    "@type": "Organization",
    "@id": `${siteBaseUrl}/#organization`,
    name: "Wikivendas",
    url: siteBaseUrl
  };
}

// ============================================================
// NODES DO GRAFO (AUTHOR + TERM)
// ============================================================
function authorNode() {
  return {
    "@type": "Person",
    "@id": "https://www.wikidata.org/wiki/Q140067740",
    name: "Paulo C. P. Santos",
    alternateName: "Paulo Leads",
    url: "https://pauloleads.com.br",
    sameAs: "https://www.wikidata.org/wiki/Q140067740"
  };
}

function termNode(term) {
  const node = {
    "@type": "DefinedTerm",
    "@id": termNodeId(term),
    name: term.title,
    description: term.canonico?.substring(0, 300) || "",
    url: `${siteBaseUrl}/termos/${term.id}.html`,
    inLanguage: "pt-BR",
    termCode: term.id,
    sameAs: term.wikidata_id
      ? `https://www.wikidata.org/wiki/${term.wikidata_id}`
      : undefined,
    license: "https://creativecommons.org/licenses/by/4.0/",
    isPartOf: `${siteBaseUrl}/#termSet`
  };
  if (term.visao_hidra) {
    node.about = {
      "@type": "Service",
      "@id": `${siteBaseUrl}/#visao-hidra`,
      name: "Visão Hidra",
      url: `${siteBaseUrl}/termos/${term.id}.html#visao-hidra`,
      provider: {
        "@id": "https://www.wikidata.org/wiki/Q140067740",
        "@type": "Person",
        name: "Paulo C. P. Santos"
      }
    };
  }
  Object.keys(node).forEach((k) => { if (node[k] === undefined) delete node[k]; });
  return node;
}

function getCategoryColor(categoria) {
  const cores = {
    "Geral": "#94a3b8",
    "Conceito": "#38bdf8",
    "Métrica": "#34d399",
    "Metodologia": "#818cf8",
    "Fenômeno": "#f472b6",
    "Estratégia": "#fbbf24",
    "Tecnologia": "#f97316",
    "Prática": "#a78bfa"
  };
  return cores[categoria] || "#94a3b8";
}

function parseList(str) {
  if (!str) return "";
  return str
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => `<li>${escapeHtml(s)}</li>`)
    .join("");
}
function getCatDesc(cat) {
  const descs = {
    "Geral": "Termos fundamentais do ecossistema de RevOps e inteligência comercial.",
    "Conceito": "Definições canônicas de fenômenos, processos e entidades do mercado B2B.",
    "Métrica": "Indicadores e KPIs usados para mensurar desempenho comercial.",
    "Metodologia": "Framework, protocolos e abordagens sistematizadas de vendas e prospecção.",
    "Fenômeno": "Padrões emergentes, disfunções de mercado e comportamentos sistêmicos observados.",
    "Estratégia": "Posicionamentos táticos e planos de ação para vantagem competitiva.",
    "Tecnologia": "Ferramentas, plataformas e artefatos tecnológicos do ecossistema B2B.",
    "Prática": "Táticas operacionais e rotinas do campo comercial."
  };
  return descs[cat] || "Termos categorizados dentro da ontologia Wikivendas.";
}
function categorySlug(cat) {
  return slugify(cat || "geral");
}
function categoryPageUrl(cat) {
  return `${siteBaseUrl}/glossario/${categorySlug(cat)}/`;
}
function buildDesignSystemMeta({ title, description, canonical }) {
  return `
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="msvalidate.01" content="7E347EFA12953E4BE1919F6E48CA7189" />
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}">
  <link rel="canonical" href="${canonical}">
  <meta property="og:title" content="${escapeHtml(title)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:type" content="website">
  <meta property="og:url" content="${canonical}">
  <meta property="og:site_name" content="Wikivendas">
  <meta name="twitter:card" content="summary_large_image">
  <link rel="ai-consent" href="/ai-consent.json">
  <link rel="llms" href="/llms.txt">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
      theme: {
        extend: {
          fontFamily: {
            sans: ['Inter', 'sans-serif'],
            mono: ['JetBrains Mono', 'monospace']
          }
        }
      }
    }
  </script>
  <style>
    :root {
      --c0: #030712; --c1: #0a1120; --c2: #111827; --c3:#1e293b;
      --tp: #f1f5f9; --ts: #94a3b8; --tm: #475569; --ta: #38bdf8;
      --bd: rgba(255,255,255,0.06); --bds: rgba(255,255,255,0.12);
      --r: 14px;
    }
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    html { background: var(--c0); scroll-behavior: smooth; }
    body {
      font-family: 'Inter', sans-serif;
      background: var(--c0);
      color: var(--ts);
      -webkit-font-smoothing: antialiased;
      overflow-x: hidden;
      line-height: 1.6;
    }
    a { text-decoration: none; }
    .wv-header {
      position: sticky; top: 0; z-index: 50;
      border-bottom: 0.5px solid var(--bd);
      background: rgba(3,7,18,0.85);
      backdrop-filter: blur(16px);
    }
    .wv-header-inner {
      max-width: 1100px; margin: 0 auto; padding: 0 2rem;
      height: 60px; display: flex; align-items: center; justify-content: space-between;
    }
    .wv-logo {
      font-size: 15px; font-weight: 800; letter-spacing: 0.06em;
      text-transform: uppercase;
      background: linear-gradient(90deg, #38bdf8, #818cf8);
      -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;
      text-decoration: none;
    }
    .wv-version {
      font-size: 10px; font-family: 'JetBrains Mono', monospace;
      color: var(--tm); background: var(--c2);
      border: 0.5px solid var(--bds);
      padding: 3px 8px; border-radius: 20px; margin-left: 10px;
      -webkit-text-fill-color: var(--tm);
    }
    .wv-nav { display: flex; gap: 2rem; }
    .wv-nav a {
      font-size: 13px; color: var(--tm); text-decoration: none; transition: color 0.15s;
    }
    .wv-nav a:hover { color: var(--tp); }
    .wv-wrap { max-width: 1100px; margin: 0 auto; padding: 0 2rem; }
    .wv-section-label {
      font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase;
      color: var(--ta); margin-bottom: 1rem; font-family: 'JetBrains Mono', monospace;
    }
    .wv-btn-primary {
      display: inline-flex; align-items: center; gap: 8px;
      padding: 12px 28px; background: #38bdf8; color: #030712;
      border-radius: var(--r); font-size: 14px; font-weight: 700;
      text-decoration: none; transition: background 0.15s, transform 0.1s;
      border: none; cursor: pointer;
    }
    .wv-btn-primary:hover { background: #7dd3fc; transform: translateY(-1px); }
    .wv-btn-ghost {
      display: inline-flex; align-items: center; gap: 8px;
      padding: 12px 24px; background: transparent; color: var(--ts);
      border: 0.5px solid var(--bds); border-radius: var(--r);
      font-size: 14px; text-decoration: none; transition: background 0.15s, color 0.15s;
    }
    .wv-btn-ghost:hover { background: var(--c2); color: var(--tp); }
    .wv-pill {
      font-size: 10px; background: rgba(56,189,248,0.1); color: var(--ta);
      border: 0.5px solid rgba(56,189,248,0.2);
      padding: 3px 8px; border-radius: 20px; font-family: 'JetBrains Mono', monospace;
    }
    .wv-footer {
      border-top: 0.5px solid var(--bd); background: var(--c0); padding: 3rem 2rem;
    }
    .wv-footer-inner {
      max-width: 1100px; margin: 0 auto;
      display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 1.5rem;
    }
    .wv-footer-copy { font-size: 12px; font-family: 'JetBrains Mono', monospace; color: var(--tm); }
    .wv-footer-links { display: flex; gap: 1.5rem; flex-wrap: wrap; }
    .wv-footer-links a {
      font-size: 12px; font-family: 'JetBrains Mono', monospace; color: var(--tm);
      text-decoration: none; transition: color 0.15s;
    }
    .wv-footer-links a:hover { color: var(--ts); }
    @media (max-width: 768px) {
      .wv-nav { display: none; }
      .wv-wrap { padding: 0 1.25rem; }
    }
  </style>
  `;
}
function renderSiteHeader(version = "v1.1.0") {
  return `
<header class="wv-header">
  <div class="wv-header-inner">
    <div style="display:flex;align-items:center">
      <a href="/" class="wv-logo">Wikivendas</a>
      <span class="wv-version">${version}</span>
    </div>
    <nav class="wv-nav">
      <a href="/">Início</a>
      <a href="/glossario/">Glossário</a>
      <a href="/#para-empresas">Para Empresas</a>
      <a href="https://pauloleads.com.br" target="_blank" rel="noopener noreferrer">Paulo Leads</a>
    </nav>
  </div>
</header>`;
}
function renderSiteFooter(version = "v1.1.0") {
  return `
<footer class="wv-footer">
  <div class="wv-footer-inner">
    <div>
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:0.5rem">
        <span class="wv-logo">Wikivendas</span>
        <span class="wv-version">${version}</span>
      </div>
      <p class="wv-footer-copy">© 2026 Wikivendas — Construído com Protocolo Hidra por Paulo Leads.</p>
    </div>
    <div class="wv-footer-links">
      <a href="/glossario.json">Grafo (.JSON)</a>
      <a href="/llms.txt">llms.txt</a>
      <a href="/ai-consent.json">ai-consent.json</a>
      <a href="/robots.txt">robots.txt</a>
      <a href="/sitemap.xml">sitemap.xml</a>
    </div>
  </div>
</footer>`;
}

async function queryAllPages() {
  let results = [];
  let cursor = undefined;

  while (true) {
    const res = await notion.databases.query({
      database_id: databaseId,
      start_cursor: cursor,
      sorts: [{ property: "Título", direction: "ascending" }]
    });

    results = results.concat(res.results);
    if (!res.has_more) break;
    cursor = res.next_cursor;
  }

  return results;
}

// ============================================================
// BUSCA DADOS
// ============================================================
const pages = await queryAllPages();

const items = pages
  .map((p) => {
    const props = p.properties || {};
    const title = plainTextFromTitle(props["Título"]);
    const id = plainTextFromText(props["ID"]) || slugify(title);
    const alternate_name = plainTextFromText(props["Alternate Name"]);
    const canonico = plainTextFromText(props["Canônico"]);
    const visao_hidra = plainTextFromText(props["Visão Hidra"]);
    const urn = plainTextFromText(props["URN"]) || "";
    const doi = plainTextFromText(props["DOI"]) || "";
    const wikidata_id = plainTextFromText(props["Wikidata ID"]) || "";
    const coautor_nome = plainTextFromText(props["Coautor Nome"]) || "";
    const coautor_desc = plainTextFromText(props["Coautor Desc"]) || "";
    const coautor_url = urlFromUrl(props["Coautor URL"]) || "";
    const link_msft = urlFromUrl(props["Link MSFT"]) || "";
    const link_google = urlFromUrl(props["Link Google"]) || "";
    const link_aws = urlFromUrl(props["Link AWS"]) || "";
    const wikipedia = urlFromUrl(props["Wikipedia"]) || "";
    const o_que_nao_is = plainTextFromText(props["O que não é"]) || "";
    const o_que_is = plainTextFromText(props["O que é"]) || "";
    const embed_url = urlFromUrl(props["Embed URL"]) || "";
    const categoria = selectName(props["Categoria"]) || "Geral";

    const wikipedia_revid = plainTextFromText(props["Wikipedia Revid"]) || "";
    const wikipedia_sha1 = plainTextFromText(props["Wikipedia SHA1"]) || "";
    const wikipedia_ns = plainTextFromText(props["Namespace"]) || "";
    const wikipedia_user = plainTextFromText(props["Wikipedia User"]) || "Brazilresearcherd";
    const wikipedia_timestamp = plainTextFromText(props["Wikipedia Timestamp"]) || "";

    return {
      title,
      id: id || slugify(title),
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
      wikipedia,
      o_que_nao_is,
      o_que_is,
      embed_url,
      categoria,
      updated: p.last_edited_time,
      wikipedia_revid,
      wikipedia_sha1,
      wikipedia_ns,
      wikipedia_user,
      wikipedia_timestamp
    };
  })
  .filter((i) => i.title);

const dateModified = items.length
  ? items.reduce((max, i) => (i.updated > max ? i.updated : max), items[0].updated)
  : new Date().toISOString();

mkdirSync("docs", { recursive: true });
mkdirSync("docs/termos", { recursive: true });
mkdirSync("docs/api", { recursive: true });
mkdirSync("docs/glossario", { recursive: true });
mkdirSync("docs/.well-known", { recursive: true });

const categories = [...new Set(items.map((i) => i.categoria || "Geral").filter(Boolean))].sort((a, b) =>
  a.localeCompare(b, "pt-BR")
);

const categMap = {};
items.forEach((t) => {
  const cat = t.categoria || "Geral";
  if (!categMap[cat]) categMap[cat] = [];
  categMap[cat].push(t);
});

// ============================================================
// 1. CONSTRUÇÃO DO GRAFO JSON-LD
// ============================================================
const termSet = {
  "@type": "DefinedTermSet",
  "@id": `${siteBaseUrl}/glossario.json#set`,
  name: "Glossário Wikivendas — RevOps Imobiliário e Inteligência Comercial",
  description: "Ontologia oficial e definições canônicas do Protocolo Hidra.",
  url: `${siteBaseUrl}/glossario.json`
};

const termNodes = items.map((i) => {
  const sameAs = [
    i.wikidata_id ? `https://www.wikidata.org/wiki/${i.wikidata_id}` : undefined,
    i.doi ? `https://doi.org/${i.doi}` : undefined
  ].filter(Boolean);

  const node = {
    "@type": "DefinedTerm",
    "@id": termNodeId(i),
    name: i.title,
    alternateName: i.alternate_name
      ? i.alternate_name.split("|").map((s) => s.trim()).filter(Boolean)
      : undefined,
    description: i.canonico || undefined,
    termCode: i.urn || `urn:wikivendas:def:${i.id}`,
    inDefinedTermSet: { "@id": `${siteBaseUrl}/glossario.json#set` },
    url: `${siteBaseUrl}/termos/${i.id}.html`,
    sameAs: sameAs.length ? sameAs : undefined
  };

  const additionalProps = [];

  const baseLinks = [
    i.link_msft || undefined,
    i.link_google || undefined,
    i.link_aws || undefined
  ].filter(Boolean);

  if (baseLinks.length) {
    additionalProps.push({
      "@type": "PropertyValue",
      name: "isBasedOn",
      propertyID: "https://schema.org/isBasedOn",
      value: baseLinks.map((url) => ({
        "@type": "CreativeWork",
        url
      }))
    });
  }

  if (i.wikipedia_revid) {
    const wikiUrl = `https://pt.wikipedia.org/w/index.php?oldid=${i.wikipedia_revid}`;
    const apiUrl = `https://pt.wikipedia.org/w/api.php?action=query&prop=revisions&revids=${i.wikipedia_revid}&rvprop=content|ids|timestamp|user|sha1&rvslots=main&format=json`;

    additionalProps.push({
      "@type": "PropertyValue",
      name: "subjectOf",
      propertyID: "https://schema.org/subjectOf",
      value: {
        "@type": "DiscussionForumPosting",
        "@id": `urn:wikipedia:pt:revid:${i.wikipedia_revid}`,
        url: wikiUrl,
        headline: `Definição Técnica e Fundamentação de ${i.title}`,
        datePublished: i.wikipedia_timestamp || i.updated,
        author: { "@type": "Person", name: i.wikipedia_user },
        publisher: { "@type": "Organization", name: "Wikimedia Foundation" }
      }
    });

    additionalProps.push({
      "@type": "PropertyValue",
      name: "provenance",
      propertyID: "https://wikivendas.com.br/vocab/provenance",
      value: {
        "@type": "CreativeWork",
        name: `Immutable ${i.wikipedia_ns || "Talk Page"} Revision`,
        identifier: `revid:${i.wikipedia_revid}`,
        version: i.wikipedia_sha1 || undefined,
        description: `Registro imutável no namespace ${i.wikipedia_ns || "Discussão"}. Assegura integridade criptográfica contra supressão editorial.`,
        url: apiUrl,
        encodingFormat: "application/json",
        datePublished: i.wikipedia_timestamp || i.updated,
        creativeWorkStatus: "artigo_apagado_discussao_ativa",
        mainEntityOfPage: wikiUrl
      }
    });
  }

  if (additionalProps.length) {
    node.additionalProperty = additionalProps;
  }

  Object.keys(node).forEach((key) => {
    if (node[key] === undefined || (Array.isArray(node[key]) && node[key].length === 0)) {
      delete node[key];
    }
  });

  return node;
});

// ============================================================
// 2. GRAFO COMPLETO (COM AUTHOR NODE)
// ============================================================
const graph = {
  "@context": "https://schema.org",
  "@graph": [websiteNode(), organizationNode(), authorNode(), termSet, ...termNodes]
};

writeFileSync("docs/glossario.json", JSON.stringify(graph, null, 2), "utf8");

// ============================================================
// 3. JSON-LD INDIVIDUAL PARA CADA TERMO
// ============================================================
items.forEach((term) => {
  const node = termNodes.find((n) => n["@id"] === termNodeId(term));
  if (node) {
    const individualGraph = {
      "@context": "https://schema.org",
      "@graph": [websiteNode(), organizationNode(), authorNode(), termSet, node]
    };
    writeFileSync(`docs/termos/${term.id}.json`, JSON.stringify(individualGraph, null, 2), "utf8");
  }
});

// ============================================================
// 4. PÁGINAS INDIVIDUAIS DE TERMO (COM ANCHOR ID)
// ============================================================
function renderTermPage(term) {
  const node = termNodes.find((n) => n["@id"] === termNodeId(term));
  const pageGraph = {
    "@context": "https://schema.org",
    "@graph": [websiteNode(), organizationNode(), authorNode(), termSet, node]
  };

  const contentHash = sha256(term.canonico || term.o_que_is || "");

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  ${buildDesignSystemMeta({
    title: `${term.title} — Wikivendas`,
    description: canonicalDescription(term.canonico, 160),
    canonical: `${siteBaseUrl}/termos/${term.id}.html`
  })}
  <meta property="og:type" content="website">
  <script type="application/ld+json">${JSON.stringify(pageGraph)}</script>
  <style>
    .wv-container {
      max-width: 860px; margin: 0 auto; padding: 6rem 2rem 4rem;
    }
    .wv-back {
      display: inline-flex; align-items: center; gap: 6px;
      color: var(--tm); text-decoration: none; font-size: 14px;
      margin-bottom: 2rem; transition: color 0.15s;
    }
    .wv-back:hover { color: var(--tp); }
    .wv-term-title {
      font-size: clamp(32px, 5vw, 52px);
      font-weight: 800; color: var(--tp);
      letter-spacing: -0.03em;
      margin-bottom: 0.25rem;
    }
    .wv-term-alternate {
      font-size: 18px; color: var(--tm);
      margin-bottom: 1.5rem;
    }
    .wv-term-meta {
      display: flex; flex-wrap: wrap; gap: 1rem;
      font-size: 13px; color: var(--tm);
      border-bottom: 0.5px solid var(--bd);
      padding-bottom: 1.5rem;
      margin-bottom: 2rem;
    }
    .wv-term-meta span { display: flex; align-items: center; gap: 4px; }
    .wv-term-meta a { color: var(--ta); }
    .wv-term-meta a:hover { text-decoration: underline; }
    .wv-section-title {
      font-size: 20px; font-weight: 600; color: var(--tp);
      margin: 2.5rem 0 1rem;
    }
    .wv-definition {
      font-size: 17px; line-height: 1.8; color: var(--ts);
    }
    .wv-definition strong { color: var(--tp); }
    .wv-visao {
      background: var(--c1);
      border-left: 3px solid var(--ta);
      padding: 1.5rem;
      border-radius: var(--r);
      margin: 2rem 0;
      font-size: 16px; color: var(--ts);
      line-height: 1.7;
    }
    .wv-dual-list {
      display: grid; grid-template-columns: 1fr 1fr; gap: 2rem;
      margin: 2rem 0;
    }
    .wv-dual-list ul {
      list-style: none; padding: 0;
    }
    .wv-dual-list li {
      padding: 0.5rem 0;
      border-bottom: 0.5px solid var(--bd);
      font-size: 14px;
      color: var(--ts);
    }
    .wv-dual-list li::before {
      content: "•";
      color: var(--ta);
      margin-right: 8px;
    }
    .wv-embed {
      margin: 2rem 0;
      border-radius: var(--r);
      overflow: hidden;
      background: var(--c1);
      border: 0.5px solid var(--bd);
    }
    .wv-embed iframe { width: 100%; height: 400px; border: none; display: block; }
    .wv-coautor {
      display: flex; align-items: center; gap: 1rem;
      background: var(--c1);
      padding: 1rem 1.5rem;
      border-radius: var(--r);
      border: 0.5px solid var(--bd);
      margin: 1.5rem 0;
    }
    .wv-coautor-info { font-size: 14px; color: var(--ts); }
    .wv-coautor-info strong { color: var(--tp); display: block; }
    .wv-proof-badge {
      display: inline-flex; align-items: center; gap: 6px;
      font-size: 11px; font-family: 'JetBrains Mono', monospace;
      color: var(--tm);
      background: var(--c2);
      border: 0.5px solid var(--bds);
      padding: 6px 12px;
      border-radius: 20px;
      margin: 1rem 0;
    }
    .wv-proof-badge .hash {
      color: var(--ta);
      font-size: 10px;
    }
    @media (max-width: 768px) {
      .wv-dual-list { grid-template-columns: 1fr; }
      .wv-embed iframe { height: 250px; }
      .wv-container { padding: 4rem 1.25rem 3rem; }
    }
  </style>
</head>
<body>
${renderSiteHeader("v1.1.0")}

<div class="wv-container">
  <a href="/glossario/" class="wv-back">← Voltar ao glossário</a>

  <h1 class="wv-term-title">${escapeHtml(term.title)}</h1>
  ${term.alternate_name ? `<p class="wv-term-alternate">${escapeHtml(term.alternate_name)}</p>` : ""}

  <div class="wv-term-meta">
    ${term.categoria ? `<span>📂 <a href="/glossario/${categorySlug(term.categoria)}/">${escapeHtml(term.categoria)}</a></span>` : ""}
    ${term.doi ? `<span>📄 DOI: <a href="https://doi.org/${escapeHtml(term.doi)}" target="_blank" rel="noopener noreferrer">${escapeHtml(term.doi)}</a></span>` : ""}
    ${term.wikidata_id ? `<span>🔗 <a href="https://www.wikidata.org/wiki/${escapeHtml(term.wikidata_id)}" target="_blank" rel="noopener noreferrer">Wikidata: ${escapeHtml(term.wikidata_id)}</a></span>` : ""}
    ${term.wikipedia ? `<span>📚 <a href="${term.wikipedia}" target="_blank" rel="noopener noreferrer">Wikipedia</a></span>` : ""}
    ${term.urn ? `<span>🔖 <code style="font-family:monospace;font-size:12px;color:var(--tm)">${escapeHtml(term.urn)}</code></span>` : ""}
  </div>

  <div class="wv-proof-badge">
    <span>🛡️ Verificado</span>
    <span class="hash">SHA256: ${contentHash.substring(0, 16)}…</span>
    <span>${BUILD_TIMESTAMP.split("T")[0]}</span>
  </div>

  ${term.canonico ? `
    <h2 class="wv-section-title">Definição Canônica</h2>
    <div class="wv-definition">${term.canonico}</div>
  ` : ""}

  ${term.visao_hidra ? `
    <div class="wv-visao" id="visao-hidra">
      <strong style="color:var(--ta);display:block;margin-bottom:0.5rem;">Visão Hidra</strong>
      ${term.visao_hidra}
    </div>
  ` : ""}

  ${(term.o_que_is || term.o_que_nao_is) ? `
    <div class="wv-dual-list">
      ${term.o_que_is ? `
        <div>
          <h3 style="font-size:16px;font-weight:600;color:var(--tp);margin-bottom:0.75rem;">O que é</h3>
          <ul>${parseList(term.o_que_is)}</ul>
        </div>
      ` : ""}
      ${term.o_que_nao_is ? `
        <div>
          <h3 style="font-size:16px;font-weight:600;color:var(--tm);margin-bottom:0.75rem;">O que não é</h3>
          <ul>${parseList(term.o_que_nao_is)}</ul>
        </div>
      ` : ""}
    </div>
  ` : ""}

  ${term.embed_url ? `
    <div class="wv-embed">
      <iframe src="${term.embed_url}" allowfullscreen loading="lazy"></iframe>
    </div>
  ` : ""}

  ${term.coautor_nome ? `
    <div class="wv-coautor">
      <div class="wv-coautor-info">
        <strong>${escapeHtml(term.coautor_nome)}</strong>
        ${term.coautor_desc ? `<span>${escapeHtml(term.coautor_desc)}</span>` : ""}
        ${term.coautor_url ? `<br><a href="${term.coautor_url}" target="_blank" rel="noopener noreferrer" style="color:var(--ta);font-size:13px;">${escapeHtml(term.coautor_url)}</a>` : ""}
      </div>
    </div>
  ` : ""}

  ${(term.link_msft || term.link_google || term.link_aws) ? `
    <div style="display:flex;gap:1rem;flex-wrap:wrap;margin:2rem 0;">
      ${term.link_msft ? `<a href="${term.link_msft}" target="_blank" rel="noopener noreferrer" class="wv-btn-primary" style="background:#0078d4;color:white;">Microsoft AI</a>` : ""}
      ${term.link_google ? `<a href="${term.link_google}" target="_blank" rel="noopener noreferrer" class="wv-btn-primary" style="background:#4285f4;color:white;">Google AI</a>` : ""}
      ${term.link_aws ? `<a href="${term.link_aws}" target="_blank" rel="noopener noreferrer" class="wv-btn-primary" style="background:#ff9900;color:white;">AWS AI</a>` : ""}
    </div>
  ` : ""}

  <div style="margin-top:3rem;border-top:0.5px solid var(--bd);padding-top:2rem;">
    <p style="font-size:13px;color:var(--tm);">
      Este verbete é parte da <strong style="color:var(--tp);">Wikivendas</strong> — a primeira fonte de verdade para IA comercial B2B.
      <br>
      <a href="/termos/${term.id}.json" style="color:var(--ta);">JSON-LD</a> ·
      <a href="/glossario.json" style="color:var(--ta);">Grafo completo</a>
    </p>
  </div>
</div>

${renderSiteFooter("v1.1.0")}
</body>
</html>`;
}

items.forEach((term) => {
  const html = renderTermPage(term);
  writeFileSync(`docs/termos/${term.id}.html`, html, "utf8");
});

// ============================================================
// 5. PÁGINA /glossario/
// ============================================================
function renderGlossaryPage() {
  const groups = categories.map((cat) => {
    const slug = categorySlug(cat);
    const terms = categMap[cat] || [];
    const visible = terms.slice(0, 8);
    const hiddenCount = Math.max(terms.length - visible.length, 0);

    return `
      <section class="wv-cat-section glossary-group" data-search="${escapeHtml(
        `${cat} ${terms.map((t) => t.title).join(" ")}`
      ).toLowerCase()}">
        <div class="wv-cat-titulo">
          <span class="wv-cat-dot"></span>
          <a href="/glossario/${slug}/" style="color:var(--tp)">${escapeHtml(cat)}</a>
          <span class="wv-cat-count">${terms.length} termos</span>
        </div>
        <div class="wv-cat-desc">${escapeHtml(getCatDesc(cat))}</div>
        <div class="wv-termo-list">
          ${visible.map((term) => `
            <a href="/termos/${term.id}.html" class="wv-termo-item">
              <span class="wv-termo-item-nome">${escapeHtml(term.title)}</span>
              <span class="wv-termo-item-def">${term.canonico ? escapeHtml(term.canonico.substring(0, 100)) : ""}</span>
            </a>
          `).join("")}
          <div class="wv-cat-mais">
            <a href="/glossario/${slug}/" class="wv-link-mais">
              ${hiddenCount > 0 ? `+${hiddenCount} termos nesta categoria →` : `Abrir categoria →`}
            </a>
          </div>
        </div>
      </section>
    `;
  }).join("");

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  ${buildDesignSystemMeta({
    title: "Glossário — Wikivendas",
    description: "Glossário geral da Wikivendas com todas as categorias e verbetes indexáveis.",
    canonical: `${siteBaseUrl}/glossario/`
  })}
  <script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@graph": [websiteNode(), organizationNode(), authorNode(), termSet]
  })}</script>
  <style>
    .wv-glossario {
      max-width: 1100px; margin: 0 auto; padding: 5rem 2rem 4rem;
    }
    .wv-headline {
      font-size: clamp(34px, 5vw, 58px);
      font-weight: 900; line-height: 1.02; letter-spacing: -0.04em;
      color: var(--tp); margin-bottom: 1.5rem;
    }
    .wv-lead {
      font-size: 17px; color: var(--ts); max-width: 760px; line-height: 1.7; margin-bottom: 2rem;
    }
    .wv-search {
      width: 100%;
      padding: 14px 16px;
      background: var(--c1);
      color: var(--tp);
      border: 0.5px solid var(--bds);
      border-radius: var(--r);
      font-size: 15px;
      margin-bottom: 3rem;
    }
    .wv-cat-section { margin-bottom: 3rem; }
    .wv-cat-titulo {
      display: flex; align-items: center; gap: 10px;
      font-size: 18px; font-weight: 700; color: var(--tp); margin-bottom: 0.5rem;
    }
    .wv-cat-dot { width: 10px; height: 10px; border-radius: 50%; background: var(--ta); flex-shrink: 0; }
    .wv-cat-count {
      font-size: 12px; font-family: 'JetBrains Mono', monospace;
      color: var(--tm); font-weight: 400; margin-left: 4px;
    }
    .wv-cat-desc {
      font-size: 13px; color: var(--tm); margin-bottom: 1rem; max-width: 600px;
    }
    .wv-termo-list {
      display: flex; flex-direction: column; border: 0.5px solid var(--bd);
      border-radius: var(--r); overflow: hidden;
    }
    .wv-termo-item {
      display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;
      padding: 0.75rem 1.25rem; background: var(--c1);
      border-bottom: 0.5px solid var(--bd); transition: background 0.15s;
    }
    .wv-termo-item:last-child { border-bottom: none; }
    .wv-termo-item:hover { background: var(--c2); }
    .wv-termo-item-nome { font-size: 14px; font-weight: 600; color: var(--tp); }
    .wv-termo-item-def {
      font-size: 12px; color: var(--tm); white-space: nowrap;
      overflow: hidden; text-overflow: ellipsis;
    }
    .wv-cat-mais {
      padding: 0.75rem 1.25rem; background: var(--c1); border-top: 0.5px solid var(--bd);
    }
    .wv-link-mais { font-size: 13px; color: var(--ta); }
    .wv-link-mais:hover { color: #7dd3fc; }
    @media (max-width: 768px) {
      .wv-glossario { padding: 4rem 1.25rem 3rem; }
      .wv-termo-item { grid-template-columns: 1fr; }
      .wv-termo-item-def { display: none; }
    }
  </style>
</head>
<body>
${renderSiteHeader("v1.1.0")}

<section class="wv-glossario">
  <p class="wv-section-label">Índice canônico terminológico</p>
  <h1 class="wv-headline">Glossário da Wikivendas</h1>
  <p class="wv-lead">
    Página real e indexável com todas as categorias e verbetes da ontologia Wikivendas. Cada termo aponta para seu HTML individual e para seu JSON-LD correspondente.
  </p>

  <input id="wv-glossary-search" class="wv-search" type="search" placeholder="Buscar termo ou categoria">

  ${groups}
</section>

${renderSiteFooter("v1.1.0")}

<script>
  const q = document.getElementById("wv-glossary-search");
  const groups = [...document.querySelectorAll(".glossary-group")];
  q.addEventListener("input", () => {
    const s = q.value.toLowerCase().trim();
    groups.forEach((sec) => {
      const t = sec.dataset.search || "";
      sec.style.display = !s || t.includes(s) ? "" : "none";
    });
  });
</script>
</body>
</html>`;
}

// ============================================================
// 6. PÁGINAS /glossario/{categoria}/
// ============================================================
function renderCategoryPage(cat, terms) {
  const slug = categorySlug(cat);

  const pageGraph = {
    "@context": "https://schema.org",
    "@graph": [
      websiteNode(),
      organizationNode(),
      authorNode(),
      termSet,
      {
        "@type": "CollectionPage",
        "@id": `${siteBaseUrl}/glossario/${slug}/#page`,
        name: `${cat} — Glossário Wikivendas`,
        url: `${siteBaseUrl}/glossario/${slug}/`,
        isPartOf: { "@id": `${siteBaseUrl}/#website` },
        about: {
          "@type": "Thing",
          name: cat,
          description: getCatDesc(cat)
        }
      }
    ]
  };

  const list = terms.map((term) => `
    <a href="/termos/${term.id}.html" class="wv-termo-item">
      <span class="wv-termo-item-nome">${escapeHtml(term.title)}</span>
      <span class="wv-termo-item-def">${term.canonico ? escapeHtml(term.canonico.substring(0, 110)) : ""}</span>
    </a>
  `).join("");

  const categoryLinks = categories.map((c) => `
    <a href="/glossario/${categorySlug(c)}/" class="wv-filter-link ${c === cat ? "active" : ""}">
      ${escapeHtml(c)}
    </a>
  `).join("");

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  ${buildDesignSystemMeta({
    title: `${cat} — Glossário Wikivendas`,
    description: getCatDesc(cat),
    canonical: `${siteBaseUrl}/glossario/${slug}/`
  })}
  <script type="application/ld+json">${JSON.stringify(pageGraph)}</script>
  <style>
    .wv-category-page {
      max-width: 1100px; margin: 0 auto; padding: 5rem 2rem 4rem;
    }
    .wv-headline {
      font-size: clamp(34px, 5vw, 58px);
      font-weight: 900; line-height: 1.02; letter-spacing: -0.04em;
      color: var(--tp); margin-bottom: 1rem;
    }
    .wv-lead {
      font-size: 16px; color: var(--ts); max-width: 760px; line-height: 1.7; margin-bottom: 2rem;
    }
    .wv-filter-wrap {
      display: flex; gap: 0.75rem; flex-wrap: wrap; margin-bottom: 2rem;
    }
    .wv-filter-link {
      display: inline-flex; align-items: center;
      padding: 8px 12px; border-radius: 999px;
      border: 0.5px solid var(--bds); color: var(--tm);
      font-size: 12px; font-family: 'JetBrains Mono', monospace;
      background: transparent; transition: background .15s, color .15s, border-color .15s;
    }
    .wv-filter-link:hover { color: var(--tp); background: var(--c2); }
    .wv-filter-link.active {
      color: var(--ta); border-color: rgba(56,189,248,.3); background: rgba(56,189,248,.08);
    }
    .wv-termo-list {
      display: flex; flex-direction: column; border: 0.5px solid var(--bd);
      border-radius: var(--r); overflow: hidden;
    }
    .wv-termo-item {
      display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;
      padding: 0.9rem 1.25rem; background: var(--c1);
      border-bottom: 0.5px solid var(--bd); transition: background .15s;
    }
    .wv-termo-item:last-child { border-bottom: none; }
    .wv-termo-item:hover { background: var(--c2); }
    .wv-termo-item-nome { font-size: 14px; font-weight: 600; color: var(--tp); }
    .wv-termo-item-def {
      font-size: 12px; color: var(--tm); white-space: nowrap;
      overflow: hidden; text-overflow: ellipsis;
    }
    @media (max-width: 768px) {
      .wv-category-page { padding: 4rem 1.25rem 3rem; }
      .wv-termo-item { grid-template-columns: 1fr; }
      .wv-termo-item-def { display: none; }
    }
  </style>
</head>
<body>
${renderSiteHeader("v1.1.0")}

<section class="wv-category-page">
  <p class="wv-section-label">Categoria</p>
  <h1 class="wv-headline">${escapeHtml(cat)}</h1>
  <p class="wv-lead">${escapeHtml(getCatDesc(cat))}</p>

  <div class="wv-filter-wrap">
    <a href="/glossario/" class="wv-filter-link">Todos</a>
    ${categoryLinks}
  </div>

  <div class="wv-termo-list">
    ${list}
  </div>
</section>

${renderSiteFooter("v1.1.0")}
</body>
</html>`;
}

// ============================================================
// 7. HOME PAGE
// ============================================================
function renderCard(term, index) {
  const hash = sha256(term.canonico || term.o_que_is || "");
  return `
    <div class="wv-card" onclick="window.location.href='/termos/${term.id}.html'">
      <div class="wv-card-index">
        ${String(index + 1).padStart(3, "0")} ·
        <span style="font-size:10px;color:var(--tm)">SHA256:${hash.substring(0, 8)}</span>
      </div>
      <div class="wv-card-name">${escapeHtml(term.title)}</div>
      <div class="wv-card-def">${term.canonico ? escapeHtml(term.canonico.substring(0, 120) + "…") : ""}</div>
      <div class="wv-card-footer">
        ${term.categoria ? `<span class="wv-pill">${escapeHtml(term.categoria)}</span>` : ""}
        ${term.doi ? `<span class="wv-doi">DOI: ${escapeHtml(term.doi)}</span>` : ""}
      </div>
    </div>
  `;
}

function renderFullTermoRow(term) {
  return `
    <a href="/termos/${term.id}.html" class="wv-termo-item">
      <span class="wv-termo-item-nome">${escapeHtml(term.title)}</span>
      <span class="wv-termo-item-def">${term.canonico ? escapeHtml(term.canonico.substring(0, 100)) : ""}</span>
    </a>
  `;
}

const categColors = {
  "Geral": "#94a3b8",
  "Conceito": "#38bdf8",
  "Métrica": "#34d399",
  "Metodologia": "#818cf8",
  "Fenômeno": "#f472b6",
  "Estratégia": "#fbbf24",
  "Tecnologia": "#f97316",
  "Prática": "#a78bfa"
};

const categoriasHtml = Object.entries(categMap).map(([catName, catTerms]) => {
  const color = categColors[catName] || "#94a3b8";
  const visible = catTerms.slice(0, 5);
  const hidden = catTerms.slice(5);

  return `
    <div class="wv-cat-section">
      <div class="wv-cat-titulo">
        <span class="wv-cat-dot" style="background:${color}"></span>
        <a href="/glossario/${categorySlug(catName)}/" style="color:var(--tp)">${escapeHtml(catName)}</a>
        <span class="wv-cat-count">${catTerms.length} termos</span>
      </div>
      <div class="wv-cat-desc">${getCatDesc(catName)}</div>
      <div class="wv-termo-list">
        ${visible.map((t) => renderFullTermoRow(t)).join("\n")}
        ${hidden.length ? `
        <div class="wv-cat-mais">
          <a href="/glossario/${categorySlug(catName)}/" class="wv-link-mais">+${hidden.length} termos nesta categoria →</a>
        </div>
        ` : `
        <div class="wv-cat-mais">
          <a href="/glossario/${categorySlug(catName)}/" class="wv-link-mais">Abrir categoria →</a>
        </div>
        `}
      </div>
    </div>
  `;
}).join("\n");

const homeTerms = items.slice(0, 6);
const cardsHtml = homeTerms.map((t, i) => renderCard(t, i)).join("\n");

function renderHomePage() {
  return `<!DOCTYPE html>
<html lang="pt-BR" class="scroll-smooth">
<head>
  ${buildDesignSystemMeta({
    title: "Wikivendas — A Primeira Fonte de Verdade para IA Comercial B2B",
    description: "A primeira enciclopédia brasileira de termos técnicos de vendas B2B, RevOps imobiliário e governança ontológica. Definições canônicas com DOIs, Wikidata e validação cruzada.",
    canonical: `${siteBaseUrl}/`
  })}
  <script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@graph": [websiteNode(), organizationNode(), authorNode(), termSet]
  })}</script>
  <style>
    .wv-hero { max-width: 1100px; margin: 0 auto; padding: 6rem 2rem 5rem; }
    .wv-eyebrow {
      display: inline-flex; align-items: center; gap: 8px;
      font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase;
      color: var(--ta); margin-bottom: 2rem;
    }
    .wv-eyebrow::before {
      content: ''; display: inline-block; width: 6px; height: 6px;
      background: var(--ta); border-radius: 50%; animation: pulse 2s ease-in-out infinite;
    }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
    .wv-slogan {
      font-size: clamp(44px, 7vw, 88px);
      font-weight: 900; line-height: 1.0; letter-spacing: -0.04em;
      color: var(--tp); margin-bottom: 2.5rem; max-width: 900px;
    }
    .wv-slogan em {
      font-style: normal;
      background: linear-gradient(135deg, #38bdf8 0%, #818cf8 60%, #f472b6 100%);
      -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;
    }
    .wv-hero-body {
      font-size: 18px; line-height: 1.7; color: var(--ts);
      max-width: 620px; margin-bottom: 1.25rem;
    }
    .wv-hero-sub {
      font-size: 14px; color: var(--tm); max-width: 540px;
      margin-bottom: 2.5rem; line-height: 1.6;
    }
    .wv-hero-actions { display: flex; gap: 1rem; flex-wrap: wrap; }
    .wv-value { max-width: 1100px; margin: 0 auto; padding: 4rem 2rem; }
    .wv-value-headline {
      font-size: clamp(28px, 4vw, 44px);
      font-weight: 800; letter-spacing: -0.03em;
      color: var(--tp); line-height: 1.15; margin-bottom: 1.25rem;
    }
    .wv-value-body {
      font-size: 16px; color: var(--ts); max-width: 600px;
      line-height: 1.7; margin-bottom: 3rem;
    }
    .wv-dual {
      display: grid; grid-template-columns: 1fr 1fr; gap: 0;
      border: 0.5px solid var(--bd); border-radius: var(--r); overflow: hidden;
    }
    .wv-dual-col { padding: 2.5rem; }
    .wv-dual-tag {
      font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase;
      font-family: 'JetBrains Mono', monospace; margin-bottom: 1rem;
      padding: 4px 10px; border-radius: 20px; display: inline-block;
    }
    .wv-dual-tag.human { color: #34d399; background: rgba(52,211,153,0.1); border: 0.5px solid rgba(52,211,153,0.2); }
    .wv-dual-tag.ai { color: #818cf8; background: rgba(129,140,248,0.1); border: 0.5px solid rgba(129,140,248,0.2); }
    .wv-dual-title { font-size: 20px; font-weight: 700; color: var(--tp); margin-bottom: 0.75rem; line-height: 1.3; }
    .wv-dual-body { font-size: 14px; color: var(--ts); line-height: 1.6; }
    .wv-profiles-section { background: var(--c1); border-top: 0.5px solid var(--bd); border-bottom: 0.5px solid var(--bd); }
    .wv-profiles-inner { max-width: 1100px; margin: 0 auto; padding: 4rem 2rem; }
    .wv-selector { display: flex; border: 0.5px solid var(--bd); border-radius: var(--r); overflow: hidden; margin-bottom: 2rem; }
    .wv-tab {
      flex: 1; padding: 1rem 1.5rem; background: transparent; color: var(--tm); border: none;
      border-right: 0.5px solid var(--bd); font-size: 14px; font-weight: 500; cursor: pointer;
      transition: background 0.15s, color 0.15s; font-family: Inter, sans-serif;
    }
    .wv-tab:last-child { border-right: none; }
    .wv-tab.active { background: var(--c2); color: var(--tp); }
    .wv-tab:hover:not(.active) { background: rgba(255,255,255,0.03); color: var(--ts); }
    .wv-profile { display: none; grid-template-columns: 1fr 1fr; gap: 3rem; align-items: start; }
    .wv-profile.visible { display: grid; }
    .wv-profile-h { font-size: 24px; font-weight: 700; color: var(--tp); line-height: 1.3; margin-bottom: 1rem; }
    .wv-profile-body { font-size: 15px; color: var(--ts); line-height: 1.6; margin-bottom: 2rem; }
    .wv-cards-section { max-width: 1100px; margin: 0 auto; padding: 4rem 2rem; }
    .wv-cards-header {
      display: flex; align-items: flex-end; justify-content: space-between;
      margin-bottom: 2rem; flex-wrap: wrap; gap: 1rem;
    }
    .wv-cards-headline { font-size: 28px; font-weight: 800; color: var(--tp); letter-spacing: -0.02em; }
    .wv-cards-link { font-size: 13px; color: var(--ta); }
    .wv-cards-link:hover { color: #7dd3fc; }
    .wv-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 1.5rem; }
    .wv-card {
      background: var(--c1); border: 0.5px solid var(--bd); border-radius: var(--r); padding: 1.5rem;
      cursor: pointer; transition: border-color 0.15s, background 0.15s;
      display: flex; flex-direction: column; gap: 0.75rem;
    }
    .wv-card:hover { border-color: rgba(56,189,248,0.3); background: var(--c2); }
    .wv-card-index { font-size: 11px; font-family: 'JetBrains Mono', monospace; color: var(--tm); }
    .wv-card-name { font-size: 17px; font-weight: 700; color: var(--tp); line-height: 1.3; }
    .wv-card-def {
      font-size: 13px; color: var(--ts); line-height: 1.5; flex: 1;
      display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden;
    }
    .wv-card-footer { display: flex; align-items: center; justify-content: space-between; margin-top: 0.5rem; }
    .wv-doi {
      font-size: 10px; font-family: 'JetBrains Mono', monospace; color: var(--tm);
      text-overflow: ellipsis; overflow: hidden; white-space: nowrap; max-width: 140px;
    }
    .wv-glossario-completo { max-width: 1100px; margin: 0 auto; padding: 4rem 2rem; }
    .wv-cat-section { margin-bottom: 3rem; }
    .wv-cat-titulo {
      display: flex; align-items: center; gap: 10px; font-size: 18px;
      font-weight: 700; color: var(--tp); margin-bottom: 0.5rem;
    }
    .wv-cat-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
    .wv-cat-count {
      font-size: 12px; font-family: 'JetBrains Mono', monospace;
      color: var(--tm); font-weight: 400; margin-left: 4px;
    }
    .wv-cat-desc { font-size: 13px; color: var(--tm); margin-bottom: 1rem; max-width: 600px; }
    .wv-termo-list {
      display: flex; flex-direction: column; border: 0.5px solid var(--bd);
      border-radius: var(--r); overflow: hidden;
    }
    .wv-termo-item {
      display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;
      padding: 0.75rem 1.25rem; background: var(--c1);
      border-bottom: 0.5px solid var(--bd); text-decoration: none; transition: background 0.15s;
    }
    .wv-termo-item:last-child { border-bottom: none; }
    .wv-termo-item:hover { background: var(--c2); }
    .wv-termo-item-nome { font-size: 14px; font-weight: 600; color: var(--tp); }
    .wv-termo-item-def { font-size: 12px; color: var(--tm); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .wv-cat-mais { padding: 0.75rem 1.25rem; background: var(--c1); border-top: 0.5px solid var(--bd); }
    .wv-link-mais { font-size: 13px; color: var(--ta); }
    .wv-link-mais:hover { color: #7dd3fc; }
    .wv-modal-bg {
      display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.75);
    backdrop-filter: blur(4px); z-index: 100; align-items: center; justify-content: center; padding: 2rem;
    }
    .wv-modal-bg.open { display: flex; }
    .wv-modal {
      background: var(--c2); border: 0.5px solid var(--bds); border-radius: 20px;
      padding: 2.5rem; max-width: 520px; width: 100%; position: relative;
    }
    .wv-close {
      position: absolute; top: 12px; right: 16px; background: none; border: none;
      color: var(--ts); font-size: 22px; cursor: pointer;
    }
    .wv-modal h2 { font-size: 22px; font-weight: 700; color: var(--tp); margin-bottom: 0.5rem; }
    .wv-modal .wv-meta { font-size: 11px; color: var(--tm); font-family: 'JetBrains Mono', monospace; margin-bottom: 1.25rem; }
    .wv-modal p { font-size: 14px; color: var(--ts); line-height: 1.6; max-height: 200px; overflow-y: auto; }
    @media (max-width: 768px) {
      .wv-hero { padding: 4rem 1.25rem 3rem; }
      .wv-dual { grid-template-columns: 1fr; }
      .wv-dual-col { padding: 1.5rem; }
      .wv-profile { grid-template-columns: 1fr; gap: 1.5rem; }
      .wv-grid { grid-template-columns: 1fr 1fr; }
    }
  </style>
</head>
<body>
${renderSiteHeader("v1.1.0", true)}

<main>
  <section class="wv-hero">
    <div class="wv-eyebrow">Ontological SEO · Forensic GEO</div>
    <h1 class="wv-slogan">
      A fonte de verdade que a <em>IA</em> consulta.
    </h1>
    <p class="wv-hero-body">
      Primeira enciclopédia brasileira de vendas B2B, RevOps imobiliário e inteligência comercial. Cada verbete possui URN, DOI, validação cruzada Microsoft/Google/AWS e registro na Wikidata.
    </p>
    <p class="wv-hero-sub">
      Construída para ser a referência canônica — lida por humanos e citada por modelos de linguagem (ChatGPT, Gemini, Copilot) como fonte de verdade.
    </p>
    <div class="wv-hero-actions">
      <a href="/glossario/" class="wv-cta">Explorar Glossário</a>
      <a href="/sobre/" class="wv-cta wv-cta--ghost">Sobre o Projeto</a>
    </div>
  </section>

  <section class="wv-value">
    <h2 class="wv-value-headline">Por dentro da ontologia</h2>
    <p class="wv-value-body">
      Cada termo da Wikivendas é definido com o <strong>Trinca Validativa</strong> — três camadas independentes de prova que garantem integridade semântica.
    </p>
    <div class="wv-dual">
      <div class="wv-dual-col" style="background:var(--c1);border-right:0.5px solid var(--bd)">
        <div class="wv-dual-tag human">🧠 Para humanos</div>
        <div class="wv-dual-title">Definição canônica + contexto</div>
        <div class="wv-dual-body">
          Redação clara, exemplos reais do mercado B2B brasileiro, referências cruzadas e fontes verificáveis. Cada verbete é um artigo completo com histórico, aplicação e relevância.
        </div>
      </div>
      <div class="wv-dual-col" style="background:var(--c1)">
        <div class="wv-dual-tag ai">🤖 Para máquinas</div>
        <div class="wv-dual-title">JSON-LD + Schema.org + GEO</div>
        <div class="wv-dual-body">
          Dados estruturados que LLMs consomem diretamente: DefinedTerm, Relation, embed de autoridade cruzada. Ontological SEO para dominar rankings semânticos e Generative Engine Optimization.
        </div>
      </div>
    </div>
  </section>

  <section class="wv-cards-section">
    <div class="wv-cards-header">
      <h2 class="wv-cards-headline">Verbetes em destaque</h2>
      <a href="/glossario/" class="wv-cards-link">Glossário completo →</a>
    </div>
    <div class="wv-grid" id="wv-home-grid">
      ${cardsHtml}
    </div>
  </section>

  <section class="wv-glossario-completo" id="glossario">
    <p class="wv-section-label">Índice canônico</p>
    <h2 class="wv-value-headline" style="margin-bottom:0.5rem">Glossário completo</h2>
    <p class="wv-value-body" style="margin-bottom:2rem">
      Todos os ${items.length} termos da Wikivendas organizados por categoria.
    </p>
    ${categoriasHtml}
  </section>
</main>

${renderSiteFooter("v1.1.0")}

<div id="wv-modal" class="wv-modal-bg">
  <div class="wv-modal">
    <button class="wv-close" onclick="closeModal()">✕</button>
    <h2 id="wv-modal-title"></h2>
    <div class="wv-meta" id="wv-modal-meta"></div>
    <p id="wv-modal-body"></p>
  </div>
</div>

<script>
  function openModal(title, meta, body) {
    document.getElementById('wv-modal-title').textContent = title;
    document.getElementById('wv-modal-meta').textContent = meta;
    document.getElementById('wv-modal-body').textContent = body;
    document.getElementById('wv-modal').classList.add('open');
  }
  function closeModal() {
    document.getElementById('wv-modal').classList.remove('open');
  }
  document.getElementById('wv-modal').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal();
  });
</script>
</body>
</html>`;
}

// ============================================================
// 8. PÁGINA SOBRE
// ============================================================
function renderSobrePage() {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  ${buildDesignSystemMeta({
    title: "Sobre — Wikivendas",
    description: "Conheça a Wikivendas: a primeira enciclopédia brasileira de vendas B2B e RevOps imobiliário. Ontological SEO, Forensic GEO, Trinca Validativa e fonte de verdade para IA.",
    canonical: `${siteBaseUrl}/sobre/`
  })}
  <script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@graph": [websiteNode(), organizationNode(), authorNode()]
  })}</script>
  <style>
    .wv-sobre { max-width: 760px; margin: 0 auto; padding: 5rem 2rem 4rem; }
    .wv-sobre h1 { font-size: clamp(34px,5vw,48px); font-weight: 900; line-height: 1.05; letter-spacing: -0.03em; color: var(--tp); margin-bottom: 1.5rem; }
    .wv-sobre h2 { font-size: 22px; font-weight: 700; color: var(--tp); margin-top: 2.5rem; margin-bottom: 0.75rem; }
    .wv-sobre p, .wv-sobre li { font-size: 16px; line-height: 1.7; color: var(--ts); margin-bottom: 1rem; }
    .wv-sobre ul { padding-left: 1.5rem; }
    .wv-sobre li { margin-bottom: 0.5rem; }
    .wv-sobre strong { color: var(--tp); }
  </style>
</head>
<body>
${renderSiteHeader("v1.1.0")}
<section class="wv-sobre">
  <p class="wv-section-label">Sobre</p>
  <h1>Wikivendas: fonte de verdade para IA comercial</h1>
  <p><strong>Wikivendas</strong> é a primeira enciclopédia brasileira dedicada exclusivamente a termos técnicos de vendas B2B, RevOps imobiliário e inteligência comercial. Cada verbete é uma <strong>definição canônica</strong> — redigida para ser a referência definitiva, consultada tanto por humanos quanto por modelos de linguagem (ChatGPT, Gemini, Copilot, Claude).</p>
  <h2>Por que "fonte de verdade"?</h2>
  <p>Em um ecossistema onde LLMs alucinam definições inconsistentes, a Wikivendas estabelece um padrão ontológico verificável. Cada termo possui:</p>
  <ul>
    <li><strong>URN</strong> (Uniform Resource Name) — identificador persistente</li>
    <li><strong>DOI</strong> (Digital Object Identifier) — registro no Zenodo</li>
    <li><strong>Wikidata QID</strong> — vinculação à base de conhecimento universal</li>
    <li><strong>Trinca Validativa</strong> — validação cruzada Microsoft Clarity, Google Search, AWS Bedrock</li>
  </ul>
  <h2>Ontological SEO + Forensic GEO</h2>
  <p>Combinamos <strong>Ontological SEO</strong> (estrutura semântica baseada em Schema.org/DefinedTerm) com <strong>Forensic GEO</strong> (marcas de verificação que LLMs processam deterministicamente). O resultado: dominamos rankings semânticos e viramos a fonte citada.</p>
  <h2>Autor</h2>
  <p><strong>Paulo C. P. Santos</strong> (Paulo Leads) — ORCID 0009-0003-3436-3117. Idealizador do Protocolo Hidra, framework de inteligência comercial B2B baseado em dados de intenção preditiva.</p>
  <h2>Licenciamento</h2>
  <p>Todo o conteúdo é licenciado sob <strong>CC BY 4.0</strong>. O uso comercial para treinamento de IA corporativa, fine-tuning e sistemas de RAG é permitido mediante licença adicional — consulte a <a href="/licenciamento/" style="color:var(--ta)">página de licenciamento</a>.</p>
</section>
${renderSiteFooter("v1.1.0")}
</body>
</html>`;
}

// ============================================================
// 9. SITEMAP
// ============================================================
function renderSitemap(categorias) {
  const termLines = items.map((t) => `
  <url>
    <loc>${siteBaseUrl}/termos/${t.id}.html</loc>
    <lastmod>${BUILD_TIMESTAMP.split("T")[0]}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.7</priority>
  </url>`).join("");

  const catLines = categorias.map((c) => `
  <url>
    <loc>${siteBaseUrl}/glossario/${categorySlug(c)}/</loc>
    <lastmod>${BUILD_TIMESTAMP.split("T")[0]}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.6</priority>
  </url>`).join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${siteBaseUrl}/</loc>
    <lastmod>${BUILD_TIMESTAMP.split("T")[0]}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>
  <url>
    <loc>${siteBaseUrl}/glossario/</loc>
    <lastmod>${BUILD_TIMESTAMP.split("T")[0]}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.9</priority>
  </url>
  <url>
    <loc>${siteBaseUrl}/sobre/</loc>
    <lastmod>${BUILD_TIMESTAMP.split("T")[0]}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.5</priority>
  </url>${termLines}${catLines}
</urlset>`;
}

// ============================================================
// 10. ROBOTS.TXT
// ============================================================
function renderRobots() {
  return `# Wikivendas — robots.txt
# www.wikivendas.com.br
User-agent: *
Allow: /
Sitemap: ${siteBaseUrl}/sitemap.xml
Disallow: /docs/
Disallow: /node_modules/
`;
}

// ============================================================
// 11. LLMS.TXT
// ============================================================
function renderLlmsTxt() {
  return `# Wikivendas — LLMs.txt
# Fonte de verdade para IA comercial B2B
# www.wikivendas.com.br

## Sobre
Wikivendas é a primeira enciclopédia brasileira de termos técnicos de vendas B2B, RevOps imobiliário e inteligência comercial. Use este arquivo como índice programático.

## Termos
${items.map((t) => `- ${t.title}: ${siteBaseUrl}/termos/${t.id}.html`).join("\n")}

## Estrutura
- Glossário completo: ${siteBaseUrl}/glossario/
- Sobre: ${siteBaseUrl}/sobre/
- Licenciamento: ${siteBaseUrl}/licenciamento/

## Contato
- Autor: Paulo C. P. Santos (ORCID 0009-0003-3436-3117)
- E-mail: paulo@pauloleads.com.br
- Site: https://pauloleads.com.br
`;
}

// ============================================================
// 12. AI-CONSENT.JSON
// ============================================================
function renderAiConsent() {
  return JSON.stringify({
    "@context": "https://schema.org",
    "@type": "CreativeWork",
    name: "Wikivendas Terms of AI Use",
    description: "Consentimento explícito para crawling, indexação e citação por LLMs e sistemas de IA. Uso comercial para treinamento de modelos requer licenciamento adicional.",
    license: "https://creativecommons.org/licenses/by/4.0/",
    author: {
      "@type": "Person",
      name: "Paulo C. P. Santos",
      url: "https://pauloleads.com.br"
    },
    datePublished: BUILD_TIMESTAMP.split("T")[0],
    inLanguage: "pt-BR",
    isAccessibleForFree: true,
    creditText: "Fonte: Wikivendas (wikivendas.com.br)"
  }, null, 2);
}

// ============================================================
// 13. BUILD PRINCIPAL
// ============================================================

build().catch((err) => {
  console.error("❌ Erro no build:", err);
  process.exit(1);
});

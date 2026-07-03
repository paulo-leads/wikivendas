import { Client } from "@notionhq/client";
import { writeFileSync, mkdirSync } from "fs";
import { createHash } from "crypto";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

// ============================================================
// CONFIGURAÇÃO
// ============================================================
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const databaseId = process.env.DATABASE_ID;
const siteBaseUrl = process.env.SITE_BASE_URL || "https://wikivendas.com.br";
const BUILD_TIMESTAMP = new Date().toISOString();
const TEMPLATE_DIR = join(__dirname, "..", "template");
const OUTPUT_DIR = join(__dirname, "..", "docs");

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

// ============================================================
// NODES DO GRAFO
// ============================================================
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
/** AJUSTE 1: authorNode com Wikidata Q140067740 */
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

/** AJUSTE 2: termNode agora recebe about=Service se visao_hidra */
function termNode(term) {
  const node = {
    "@type": "DefinedTerm",
    "@id": `${siteBaseUrl}/def/${term.id}`,
    name: term.title,
    description: term.canonico?.substring(0, 300) || "",
    url: `${siteBaseUrl}/termos/${term.id}.html`,
    inLanguage: "pt-BR",
    termCode: term.id,
    sameAs: term.wikidata_id
      ? `https://www.wikidata.org/wiki/${term.wikidata_id}`
      : undefined,
    image: term.og_image || undefined,
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

  // Limpa undefined
  Object.keys(node).forEach((k) => {
    if (node[k] === undefined) delete node[k];
  });

  return node;
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
function categorySlug(cat) {
  return slugify(cat || "geral");
}
function categoryPageUrl(cat) {
  return `${siteBaseUrl}/glossario/${categorySlug(cat)}/`;
}

// ============================================================
// RENDERIZAÇÃO DE TEMPLATES
// ============================================================
function renderSiteHeader(version) {
  return `<header class="wv-header">
    <div class="wv-header-inner">
      <a href="/" class="wv-logo">Wikivendas<span class="wv-version">${version}</span></a>
      <nav class="wv-nav">
        <a href="/glossario/">Glossário</a>
        <a href="/#para-empresas">Para Empresas</a>
        <a href="https://pauloleads.com.br" target="_blank" rel="noopener">Paulo Leads</a>
      </nav>
    </div>
  </header>`;
}

function renderSiteFooter(version) {
  return `<footer style="border-top:0.5px solid var(--bd);padding:2rem 0;margin-top:4rem">
    <div class="wv-wrap" style="display:flex;flex-direction:column;align-items:center;gap:1rem;text-align:center">
      <p style="font-size:12px;color:var(--tm)">© 2026 Wikivendas — Construído por <a href="https://pauloleads.com.br" style="color:var(--ta)" target="_blank" rel="noopener">Paulo Leads</a></p>
      <p style="font-size:11px;color:var(--tm);font-family:'JetBrains Mono',monospace">Versão ${version} · ${new Date().toLocaleDateString("pt-BR")}</p>
      <p style="font-size:11px;color:var(--tm)"><a href="/glossario.json" style="color:var(--ta)">JSON-LD</a> · <a href="/llms.txt" style="color:var(--ta)">llms.txt</a> · <a href="/ai-consent.json" style="color:var(--ta)">AI Consent</a> · <a href="/sitemap.xml" style="color:var(--ta)">Sitemap</a> · <a href="/robots.txt" style="color:var(--ta)">Robots</a></p>
    </div>
  </footer>`;
}

function renderEmptyState(msg) {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Wikivendas</title>
  <meta name="robots" content="noindex">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: system-ui, sans-serif; background: #030712; color: #94a3b8; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
    .container { text-align: center; padding: 2rem; max-width: 500px; }
    h1 { color: #f1f5f9; font-size: 1.5rem; margin-bottom: 1rem; }
    p { line-height: 1.6; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Wikivendas</h1>
    <p>${escapeHtml(msg)}</p>
  </div>
</body>
</html>`;
}

// ============================================================
// FUNÇÕES DE PÁGINA - HOME
// ============================================================
function renderCard(item) {
  const catColor = getCategoryColor(item.categoria);
  const catSlug = categorySlug(item.categoria);
  return `<a href="/termos/${item.id}.html" class="wv-card" data-categoria="${escapeHtml(item.categoria)}">
    <div class="wv-card-tag" style="background:${catColor}20;color:${catColor}">${escapeHtml(item.categoria)}</div>
    <div class="wv-card-title">${escapeHtml(item.title)}</div>
    <div class="wv-card-body">${escapeHtml(canonicalDescription(item.canonico, 120))}</div>
    <div class="wv-card-meta">
      <span>${item.wikidata_id ? '✓ Wikidata' : '—'}</span>
      <span>${item.doi ? '✓ DOI' : '—'}</span>
      <span>${item.visao_hidra ? '✓ Visão Hidra' : '—'}</span>
    </div>
  </a>`;
}

function renderHomePage() {
  const items = getValidTerms();
  const categories = [...new Set(items.map((i) => i.categoria).filter(Boolean))];

  const cardsHtml = items.slice(0, 50).map((i) => renderCard(i)).join("\n");

  const categMap = {};
  items.forEach((i) => {
    const cat = i.categoria || "Geral";
    if (!categMap[cat]) categMap[cat] = [];
    categMap[cat].push(i);
  });

  const categoriasHtml = categories.map((cat) => {
    const termList = categMap[cat] || [];
    const slug = categorySlug(cat);
    const desc = getCatDesc(cat);
    const catColor = getCategoryColor(cat);

    return `<div class="wv-cat-section">
      <div class="wv-cat-titulo">
        <span class="wv-cat-dot" style="background:${catColor}"></span>
        ${escapeHtml(cat)}
        <span class="wv-cat-count">(${termList.length})</span>
      </div>
      <p class="wv-cat-desc">${escapeHtml(desc)}</p>
      <div class="wv-termo-list">
        ${termList.map((t) => `
          <a href="/termos/${t.id}.html" class="wv-termo-item">
            <span class="wv-termo-item-nome">${escapeHtml(t.title)}</span>
            <span class="wv-termo-item-def">${escapeHtml(canonicalDescription(t.canonico, 80))}</span>
          </a>
        `).join("")}
        ${termList.length > 30 ? `
          <div class="wv-cat-mais">
            <a href="/glossario/${slug}/" class="wv-link-mais">Ver todos os ${termList.length} termos de ${escapeHtml(cat)} →</a>
          </div>
        ` : ""}
      </div>
    </div>`;
  }).join("\n");

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="msvalidate.01" content="7E347EFA12953E4BE1919F6E48CA7189" />
  <title>Wikivendas — A Primeira Fonte de Verdade para IA Comercial B2B</title>
  <meta name="description" content="Enciclopédia canônica de RevOps B2B. Definições formais validadas nos ecossistemas Microsoft, Google e AWS para consumo humano e de IA.">
  <link rel="canonical" href="${siteBaseUrl}/">
  <meta property="og:title" content="Wikivendas — Primeira Fonte de Verdade para IA Comercial B2B">
  <meta property="og:description" content="Enciclopédia canônica de RevOps B2B. Definições formais validadas nos ecossistemas Microsoft, Google e AWS.">
  <meta property="og:type" content="website">
  <meta property="og:url" content="${siteBaseUrl}/">
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
      padding: 14px 28px;
      background: #38bdf8; color: #030712;
      border-radius: var(--r); font-size: 15px; font-weight: 700;
      border: none; cursor: pointer; text-decoration: none;
      font-family: inherit; transition: background 0.15s;
    }
    .wv-btn-primary:hover { background: #7dd3fc; }
    .wv-btn-ghost {
      display: inline-flex; align-items: center; gap: 8px;
      padding: 14px 28px;
      border: 0.5px solid var(--bds); color: var(--ts);
      border-radius: var(--r); font-size: 15px; font-weight: 500;
      background: transparent; cursor: pointer; text-decoration: none;
      font-family: inherit; transition: all 0.15s;
    }
    .wv-btn-ghost:hover { border-color: var(--tp); color: var(--tp); }
    .wv-hero {
      max-width: 900px; margin: 0 auto; padding: 6rem 2rem 4rem;
      text-align: center;
    }
    .wv-eyebrow {
      font-size: 12px; letter-spacing: 0.14em; text-transform: uppercase;
      font-family: 'JetBrains Mono', monospace;
      color: var(--tm); margin-bottom: 1.5rem;
    }
    .wv-slogan {
      font-size: clamp(42px, 8vw, 72px);
      font-weight: 900; line-height: 1.05;
      letter-spacing: -0.04em;
      color: var(--tp);
      margin-bottom: 1.5rem;
    }
    .wv-slogan em {
      background: linear-gradient(135deg, #38bdf8, #818cf8);
      -webkit-background-clip: text; -webkit-text-fill-color: transparent;
      background-clip: text; font-style: normal;
    }
    .wv-hero-body {
      font-size: 15px; line-height: 1.7; color: var(--tm);
      max-width: 700px; margin: 0 auto 1.5rem;
    }
    .wv-hero-sub {
      font-size: 13px; line-height: 1.6; color: var(--tm);
      max-width: 650px; margin: 0 auto 2rem;
    }
    .wv-hero-actions {
      display: flex; gap: 1rem; justify-content: center;
      flex-wrap: wrap;
    }
    .wv-value {
      max-width: 900px; margin: 0 auto; padding: 4rem 2rem;
    }
    .wv-value-headline {
      font-size: clamp(28px, 5vw, 42px);
      font-weight: 800; color: var(--tp);
      line-height: 1.15; letter-spacing: -0.03em;
      margin-bottom: 1.5rem;
    }
    .wv-value-body {
      font-size: 15px; line-height: 1.7; color: var(--tm);
      margin-bottom: 3rem; max-width: 650px;
    }
    .wv-dual {
      display: grid; grid-template-columns: 1fr 1fr;
      border: 0.5px solid var(--bd); border-radius: var(--r);
      overflow: hidden;
    }
    .wv-dual-col { padding: 2rem; }
    .wv-dual-tag {
      font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase;
      font-family: 'JetBrains Mono', monospace; margin-bottom: 1rem;
    }
    .wv-dual-tag.human { color: #38bdf8; }
    .wv-dual-tag.ai { color: #818cf8; }
    .wv-dual-title {
      font-size: 18px; font-weight: 700; color: var(--tp);
      line-height: 1.3; margin-bottom: 0.75rem;
    }
    .wv-dual-body {
      font-size: 13px; line-height: 1.6; color: var(--tm);
    }
    .wv-profiles-section {
      border-top: 0.5px solid var(--bd);
      padding: 4rem 0;
    }
    .wv-profiles-inner { max-width: 900px; margin: 0 auto; padding: 0 2rem; }
    .wv-selector {
      display: flex; border: 0.5px solid var(--bd);
      border-radius: 10px; overflow: hidden; margin-bottom: 2rem;
    }
    .wv-tab {
      flex: 1; padding: 14px 16px; background: transparent;
      border: none; border-right: 0.5px solid var(--bd);
      color: var(--tm); font-size: 14px; font-weight: 500;
      cursor: pointer; font-family: 'Inter', sans-serif;
      transition: all 0.15s;
    }
    .wv-tab:last-child { border-right: none; }
    .wv-tab.active { background: var(--c2); color: var(--tp); }
    .wv-tab:hover { color: var(--tp); }
    .wv-profile {
      display: none; grid-template-columns: 1fr 1fr; gap: 2rem;
    }
    .wv-profile.visible { display: grid; }
    .wv-profile-h {
      font-size: 20px; font-weight: 700; color: var(--tp);
      line-height: 1.3; margin-bottom: 1rem;
    }
    .wv-profile-body {
      font-size: 14px; color: var(--tm); line-height: 1.7;
      margin-bottom: 1.5rem;
    }
    .wv-cards-section {
      max-width: 1100px; margin: 0 auto; padding: 4rem 2rem;
    }
    .wv-cards-header {
      display: flex; align-items: flex-start; justify-content: space-between;
      margin-bottom: 2rem;
    }
    .wv-cards-headline {
      font-size: 24px; font-weight: 800; color: var(--tp);
      letter-spacing: -0.02em;
    }
    .wv-cards-link {
      font-size: 13px; color: var(--ta); text-decoration: none;
    }
    .wv-cards-link:hover { color: #7dd3fc; }
    .wv-grid {
      display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
      gap: 1rem;
    }
    .wv-card {
      display: flex; flex-direction: column;
      padding: 1.5rem;
      background: var(--c1); border: 0.5px solid var(--bd);
      border-radius: var(--r); text-decoration: none;
      transition: all 0.15s;
    }
    .wv-card:hover {
      border-color: var(--bds);
      background: var(--c2);
    }
    .wv-card-tag {
      font-size: 10px; letter-spacing: 0.1em; text-transform: uppercase;
      font-family: 'JetBrains Mono', monospace;
      padding: 4px 10px; border-radius: 20px;
      display: inline-block; width: fit-content;
      margin-bottom: 0.75rem;
    }
    .wv-card-title {
      font-size: 17px; font-weight: 700; color: var(--tp);
      line-height: 1.25; margin-bottom: 0.5rem;
      letter-spacing: -0.01em;
    }
    .wv-card-body {
      font-size: 12px; color: var(--tm); line-height: 1.5;
      flex: 1;
    }
    .wv-card-meta {
      margin-top: 1rem; padding-top: 0.75rem;
      border-top: 0.5px solid var(--bd);
      display: flex; gap: 0.75rem; font-size: 11px;
      font-family: 'JetBrains Mono', monospace;
      color: var(--tm);
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
    .wv-modal-close {
      position: absolute; top: 1rem; right: 1rem; background: transparent; border: none; color: var(--tm);
      font-size: 18px; cursor: pointer; line-height: 1; padding: 4px 8px; border-radius: 6px;
    }
    .wv-modal-tag {
      font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase; font-family: 'JetBrains Mono', monospace;
      color: var(--ta); margin-bottom: 1rem;
    }
    .wv-modal-title {
      font-size: 22px; font-weight: 800; color: var(--tp); line-height: 1.25; margin-bottom: 1rem; letter-spacing: -0.02em;
    }
    .wv-modal-body { font-size: 14px; color: var(--ts); line-height: 1.7; margin-bottom: 1.5rem; }
    .wv-modal-promise {
      background: rgba(56,189,248,0.06); border: 0.5px solid rgba(56,189,248,0.12);
      border-radius: var(--r); padding: 1.25rem; margin-bottom: 1.5rem;
    }
    .wv-modal-promise-label {
      font-size: 11px; font-family: 'JetBrains Mono', monospace; color: var(--ta);
      letter-spacing: 0.1em; text-transform: uppercase; margin-bottom: 0.5rem;
    }
    .wv-modal-promise-text { font-size: 15px; color: var(--tp); font-weight: 600; line-height: 1.4; margin-bottom: 0.5rem; }
    .wv-modal-analogy { font-size: 13px; color: var(--tm); font-style: italic; }
    .wv-modal-cta {
      width: 100%; padding: 14px; background: #38bdf8; color: #030712; border: none;
      border-radius: var(--r); font-size: 15px; font-weight: 700; cursor: pointer; font-family: Inter, sans-serif;
    }
    .wv-modal-cta:hover { background: #7dd3fc; }
    @media (max-width: 768px) {
      .wv-hero, .wv-value, .wv-profiles-inner, .wv-cards-section, .wv-glossario-completo { padding-left: 1.25rem; padding-right: 1.25rem; }
      .wv-slogan { font-size: clamp(36px, 10vw, 56px); }
      .wv-dual, .wv-profile.visible { grid-template-columns: 1fr; }
      .wv-selector { flex-direction: column; border-radius: 10px; }
      .wv-tab { border-right: none; border-bottom: 0.5px solid var(--bd); }
      .wv-tab:last-child { border-bottom: none; }
      .wv-grid { grid-template-columns: 1fr; }
      .wv-termo-item { grid-template-columns: 1fr; }
      .wv-termo-item-def { display: none; }
    }
  </style>
</head>
<body>
${renderSiteHeader("v1.1.0")}

<section>
  <div class="wv-hero">
    <p class="wv-eyebrow">A informação que realmente importa sobre sua marca, seu processo e seu negócio</p>
    <h1 class="wv-slogan">A Primeira<br>Fonte de Verdade<br>para <em>IA Comercial B2B</em></h1>
    <p class="wv-hero-body">
      Quando uma IA cita seu concorrente como referência de mercado, ou alucina referindo-se ao seu negócio, isso não é bug — <strong>ausência de informações e falta de dados estruturados no processamento.</strong> Wikivendas é a inteligência real de pessoas que estão no dia a dia enfrentando situações peculiares de cada negócio e corrigem a alucinação estatística de todos modelos de IAS
    </p>
    <p class="wv-hero-sub">
      Cada verbete é uma <strong>parte da genética</strong> de validação cruzada nos ecossistemas Microsoft, Google e AWS: a matéria-prima que LLMs usam como premissa para gerar respostas.
    </p>
    <div class="wv-hero-actions">
      <a href="/glossario/" class="wv-btn-primary">Ver Glossário Canônico</a>
      <a href="/#para-empresas" class="wv-btn-ghost">Para Empresas</a>
    </div>
  </div>
</section>

<section class="wv-value">
  <p class="wv-section-label">Por que isso importa</p>
  <h2 class="wv-value-headline">Construído para humanos.<br>Indexado para máquinas.</h2>
  <p class="wv-value-body">
    A Wikivendas não é só um glossário — é uma infraestrutura de significado. Cada definição é formalizada e absorvida no treinamento utilizado de forma permanente. O resultado: sua empresa ou nome aparece como resposta, não como Alucinação Estatística com Respostas Genéricas.
  </p>

  <div class="wv-dual">
    <div class="wv-dual-col">
      <p class="wv-dual-tag human">Para Humanos</p>
      <p class="wv-dual-title">Clareza que converte, no jargão que confunde</p>
      <p class="wv-dual-body">
        Profissionais de vendas, CEOs e gestores encontram aqui definições comerciais, consensuadas e atualizadas sem a ambiguidade que custa reuniões, retrabalho e deals perdidos. Um vocabulário compartilhado acelera tudo, do onboarding ao fechamento.
      </p>
    </div>
    <div class="wv-dual-col" style="border-left:0.5px solid var(--bd)">
      <p class="wv-dual-tag ai">Para Inteligências Artificiais</p>
      <p class="wv-dual-title">Substrato semântico que LLMs usam como premissa</p>
      <p class="wv-dual-body">
        ChatGPT, Gemini, Copilot e Meta AI extraem conhecimento de fontes estruturadas, com validações complexas e presença em grafo de conhecimento. A Wikivendas constrói essa base: quando o algoritmo decide quem citar, sua marca já está lá como referência, não como candidata.
      </p>
    </div>
  </div>
</section>

<section class="wv-profiles-section" id="para-empresas">
  <div class="wv-profiles-inner">
    <p class="wv-section-label">Qual o seu perfil?</p>
    <h2 class="wv-value-headline" style="margin-bottom:2rem">Cada cenário tem uma solução específica.</h2>

    <div class="wv-selector">
      <button class="wv-tab active" data-profile="ceo" onclick="switchProfile('ceo')">Sou CEO / Founder</button>
      <button class="wv-tab" data-profile="vendas" onclick="switchProfile('vendas')">Lidero Vendas</button>
      <button class="wv-tab" data-profile="autonomo" onclick="switchProfile('autonomo')">Sou Autônomo</button>
    </div>

    <div class="wv-profile visible" id="profile-ceo">
      <div>
        <p class="wv-profile-h">Sua marca não pode depender do humor do algoritmo.</p>
        <p class="wv-profile-body">Homologamos sua empresa como fonte oficial nos motores de IA que fundos, analistas e C-Levels usam para decidir sobre M&A, valuation e liderança de categoria.</p>
        <button class="wv-btn-primary" onclick="openModal('ceo')">Antecipar e ver detalhes do cenário</button>
      </div>
      <div style="background:var(--c1);border:0.5px solid var(--bd);border-radius:var(--r);padding:2rem">
        <p style="font-size:12px;text-transform:uppercase;letter-spacing:0.1em;color:var(--tm);margin-bottom:1rem;font-family:'JetBrains Mono',monospace">Cenário de risco</p>
        <p style="font-size:15px;color:var(--tp);line-height:1.6;font-weight:500">Qual empresa lidera RevOps imobiliário no Brasil?</p>
        <p style="font-size:14px;color:var(--tm);margin-top:0.75rem;line-height:1.6">A IA responde com o nome do seu concorrente. O analista de M&A não liga para você.</p>
      </div>
    </div>

    <div class="wv-profile" id="profile-vendas">
      <div>
        <p class="wv-profile-h">Seu cliente já escolheu o fornecedor antes de falar com seu time.</p>
        <p class="wv-profile-body">Garantimos que sua empresa seja a indicada quando ele pergunta para a IA, reduzindo CAC e encurtando o ciclo de vendas antes do primeiro contato.</p>
        <button class="wv-btn-primary" onclick="openModal('vendas')">Diagnóstico onde você perde vendas</button>
      </div>
      <div style="background:var(--c1);border:0.5px solid var(--bd);border-radius:var(--r);padding:2rem">
        <p style="font-size:12px;text-transform:uppercase;letter-spacing:0.1em;color:var(--tm);margin-bottom:1rem;font-family:'JetBrains Mono',monospace">Cenário de risco</p>
        <p style="font-size:15px;color:var(--tp);line-height:1.6;font-weight:500">Qual fornecedor de seu setor você recomenda?</p>
        <p style="font-size:14px;color:var(--tm);margin-top:0.75rem;line-height:1.6">O cliente recebe o nome de um concorrente. Chega ao seu time já convicto.</p>
      </div>
    </div>

    <div class="wv-profile" id="profile-autonomo">
      <div>
        <p class="wv-profile-h">Indicação agora é feita por inteligência artificial.</p>
        <p class="wv-profile-body">Transformamos seu nome em referência citada por ChatGPT, Gemini e Meta AI: o cliente chega até você pré-vendido, sem depender de Google Ads ou boca a boca.</p>
        <button class="wv-btn-primary" onclick="openModal('autonomo')">Validar minha autoridade nas IAs</button>
      </div>
      <div style="background:var(--c1);border:0.5px solid var(--bd);border-radius:var(--r);padding:2rem">
        <p style="font-size:12px;text-transform:uppercase;letter-spacing:0.1em;color:var(--tm);margin-bottom:1rem;font-family:'JetBrains Mono',monospace">Cenário de risco</p>
        <p style="font-size:15px;color:var(--tp);line-height:1.6;font-weight:500">Quem é o melhor da sua profissão no Brasil?</p>
        <p style="font-size:14px;color:var(--tm);margin-top:0.75rem;line-height:1.6">Um concorrente aleatório aparece. Rouba o cliente antes do primeiro contato.</p>
      </div>
    </div>
  </div>
</section>

<section class="wv-cards-section" id="glossario">
  <div class="wv-cards-header">
    <div>
      <p class="wv-section-label">Enciclopédia Canônica</p>
      <h2 class="wv-cards-headline">Termos registrados: ${items.length}</h2>
    </div>
    <div>
      <a href="/glossario/" class="wv-cards-link">Ver glossário completo</a>
    </div>
  </div>

  <div class="wv-grid">
    ${cardsHtml}
  </div>
</section>

<section class="wv-glossario-completo" id="glossario-completo">
  <p class="wv-section-label">Índice Canônico Terminológico</p>
  <h2 class="wv-value-headline" style="margin-bottom:3rem">Todos os ${items.length} verbetes por categoria</h2>
  ${categoriasHtml}
</section>

<div class="wv-modal-bg" id="wv-modal-bg" onclick="closeModal(event)">
  <div class="wv-modal" onclick="event.stopPropagation()">
    <button class="wv-modal-close" onclick="closeModal()">×</button>
    <div class="wv-modal-tag" id="wv-modal-tag"></div>
    <div class="wv-modal-title" id="wv-modal-title"></div>
    <div class="wv-modal-body" id="wv-modal-body"></div>
    <div class="wv-modal-promise">
      <div class="wv-modal-promise-label">O que entregamos</div>
      <div class="wv-modal-promise-text" id="wv-modal-promise-text"></div>
      <div class="wv-modal-analogy" id="wv-modal-analogy"></div>
    </div>
    <button class="wv-modal-cta" onclick="window.open('https://pauloleads.com.br','_blank','noopener,noreferrer')">Falar com Paulo Leads</button>
  </div>
</div>

${renderSiteFooter("v1.0.0")}

<script>
  function switchProfile(profile) {
    document.querySelectorAll('.wv-tab').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.wv-profile').forEach(p => p.classList.remove('visible'));
    document.querySelector('[data-profile="' + profile + '"]').classList.add('active');
    document.getElementById('profile-' + profile).classList.add('visible');
  }

  const modalContent = {
    ceo: {
      tag: 'CEO / Founder',
      title: 'Sua categoria precisa ter dono antes que o algoritmo escolha outro.',
      body: 'Se a IA recomenda um concorrente como referência do seu setor, ela não está só errando — ela está consolidando liderança de mercado em favor dele. Isso afeta percepção de valor, valuation, reputação e capacidade de captação.',
      promise: 'Estruturamos sua presença semântica para que seu nome seja elegível como fonte oficial e referência de categoria nas respostas de IA.',
      analogy: 'É a diferença entre ser lembrado como benchmark ou ser invisível no momento da decisão.'
    },
    vendas: {
      tag: 'Liderança Comercial',
      title: 'Seu pipeline começa antes do formulário.',
      body: 'A decisão do comprador agora passa por uma pergunta feita à IA. Se a resposta não aponta para você, o CAC sobe, o tempo de venda aumenta e seu time entra em calls já em desvantagem.',
      promise: 'Mapeamos as perguntas críticas do seu mercado e posicionamos sua empresa para ser citada como resposta plausível e confiável.',
      analogy: 'Antes era SEO. Agora é presença semântica na camada de premissa.'
    },
    autonomo: {
      tag: 'Autônomo / Especialista',
      title: 'A indicação automática já está substituindo o boca a boca.',
      body: 'Profissionais autônomos que não aparecem como referência em IA perdem a recomendação antes mesmo do contato. O cliente chega pronto para falar com quem foi citado.',
      promise: 'Transformamos sua expertise em estrutura verificável, associada ao seu nome e nicho, para melhorar sua chance de citação nas respostas.',
      analogy: 'Não basta ser bom. Agora é preciso ser legível para o modelo.'
    }
  };

  function openModal(key) {
    const c = modalContent[key];
    if (!c) return;
    document.getElementById('wv-modal-tag').textContent = c.tag;
    document.getElementById('wv-modal-title').textContent = c.title;
    document.getElementById('wv-modal-body').textContent = c.body;
    document.getElementById('wv-modal-promise-text').textContent = c.promise;
    document.getElementById('wv-modal-analogy').textContent = c.analogy;
    document.getElementById('wv-modal-bg').classList.add('open');
  }

  function closeModal(e) {
    if (!e || e.target.id === 'wv-modal-bg') {
      document.getElementById('wv-modal-bg').classList.remove('open');
    }
  }
</script>
</body>
</html>`;
}

// ============================================================
// RENDERIZAÇÃO - PÁGINA DE GLOSSÁRIO
// ============================================================
function renderGlossaryPage() {
  const items = getValidTerms();
  const categories = [...new Set(items.map((i) => i.categoria).filter(Boolean))];

  const letters = {};
  items.forEach((i) => {
    const first = (i.title || "?").charAt(0).toUpperCase();
    if (!letters[first]) letters[first] = [];
    letters[first].push(i);
  });
  const sortedLetters = Object.keys(letters).sort();

  const alphaNav = sortedLetters.map((l) =>
    `<a href="#letra-${l}" style="color:var(--ta);font-size:14px;font-weight:600;text-decoration:none;padding:4px 8px">${l}</a>`
  ).join("");

  const alphaSections = sortedLetters.map((l) => `
    <div id="letra-${l}" style="margin-bottom:2rem">
      <h3 style="font-size:20px;font-weight:700;color:var(--tp);margin-bottom:1rem;border-bottom:0.5px solid var(--bd);padding-bottom:0.5rem">${l}</h3>
      ${letters[l].map((t) => `
        <a href="/termos/${t.id}.html" style="display:block;padding:8px 0;border-bottom:0.5px solid var(--bd);color:var(--ts);text-decoration:none;font-size:14px;transition:color 0.15s" onmouseover="this.style.color='var(--tp)'" onmouseout="this.style.color='var(--ts)'">
          <strong style="color:var(--tp)">${escapeHtml(t.title)}</strong>
          <span style="color:var(--tm);font-size:12px;margin-left:10px">(${escapeHtml(t.categoria || "Geral")})</span>
          <span style="color:var(--tm);font-size:12px;display:block;margin-top:2px">${escapeHtml(canonicalDescription(t.canonico, 100))}</span>
        </a>
      `).join("")}
    </div>
  `).join("");

  const categMap = {};
  items.forEach((i) => {
    const cat = i.categoria || "Geral";
    if (!categMap[cat]) categMap[cat] = [];
    categMap[cat].push(i);
  });

  const catSections = categories.map((cat) => {
    const slug = categorySlug(cat);
    const catColor = getCategoryColor(cat);
    const termList = categMap[cat] || [];
    return `<div class="wv-cat-section">
      <div class="wv-cat-titulo">
        <span class="wv-cat-dot" style="background:${catColor}"></span>
        ${escapeHtml(cat)}
        <span class="wv-cat-count">(${termList.length})</span>
      </div>
      <div class="wv-termo-list">
        ${termList.map((t) => `
          <a href="/termos/${t.id}.html" class="wv-termo-item">
            <span class="wv-termo-item-nome">${escapeHtml(t.title)}</span>
            <span class="wv-termo-item-def">${escapeHtml(canonicalDescription(t.canonico, 80))}</span>
          </a>
        `).join("")}
      </div>
    </div>`;
  }).join("\n");

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Glossário — Wikivendas</title>
  <meta name="description" content="Glossário canônico de RevOps B2B. Definições validadas nos ecossistemas Microsoft, Google e AWS.">
  <link rel="canonical" href="${siteBaseUrl}/glossario/">
  <meta property="og:title" content="Glossário — Wikivendas">
  <meta property="og:description" content="Glossário canônico de RevOps B2B.">
  <meta property="og:type" content="website">
  <meta property="og:url" content="${siteBaseUrl}/glossario/">
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
    .wv-glossario-header { max-width: 1100px; margin: 0 auto; padding: 4rem 2rem 2rem; }
    .wv-glossario-title { font-size: clamp(28px, 4vw, 40px); font-weight: 800; color: var(--tp); margin-bottom: 0.5rem; letter-spacing: -0.03em; }
    .wv-glossario-sub { font-size: 14px; color: var(--tm); max-width: 600px; }
    .wv-glossario-nav { border-top: 0.5px solid var(--bd); border-bottom: 0.5px solid var(--bd); padding: 1rem 2rem; margin-bottom: 2rem; }
    .wv-glossario-nav-inner { max-width: 1100px; margin: 0 auto; display: flex; gap: 0.25rem; flex-wrap: wrap; align-items: center; }
    .wv-glossario-content { max-width: 1100px; margin: 0 auto; padding: 0 2rem 4rem; }
    .wv-glossario-tabs {
      display: flex; gap: 0; margin-bottom: 2rem; border: 0.5px solid var(--bd); border-radius: 10px; overflow: hidden; width: fit-content;
    }
    .wv-glossario-tab {
      padding: 10px 20px; font-size: 13px; font-weight: 500; font-family: Inter, sans-serif;
      background: transparent; color: var(--tm); border: none; cursor: pointer;
      border-right: 0.5px solid var(--bd); transition: all 0.15s;
    }
    .wv-glossario-tab:last-child { border-right: none; }
    .wv-glossario-tab.active { background: var(--c2); color: var(--tp); }
    .wv-glossario-tab:hover { color: var(--tp); }
    .wv-glossario-panel { display: none; }
    .wv-glossario-panel.active { display: block; }
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
    @media (max-width: 768px) {
      .wv-termo-item { grid-template-columns: 1fr; }
      .wv-termo-item-def { display: none; }
    }
  </style>
</head>
<body>
${renderSiteHeader("v1.1.0")}

<section class="wv-glossario-header">
  <p class="wv-section-label">Enciclopédia Canônica</p>
  <h1 class="wv-glossario-title">Glossário</h1>
  <p class="wv-glossario-sub">${items.length} termos registrados, organizados por categoria e ordem alfabética.</p>
</section>

<section class="wv-glossario-nav">
  <div class="wv-glossario-nav-inner">
    <span style="color:var(--tm);font-size:12px;font-family:'JetBrains Mono',monospace;margin-right:8px">Navegar:</span>
    ${alphaNav}
  </div>
</section>

<section class="wv-glossario-content">
  <div class="wv-glossario-tabs" id="glossario-tabs">
    <button class="wv-glossario-tab active" onclick="switchGlossarioTab('categoria')">Por Categoria</button>
    <button class="wv-glossario-tab" onclick="switchGlossarioTab('alfabetica')">Alfabética</button>
  </div>

  <div class="wv-glossario-panel active" id="panel-categoria">
    ${catSections}
  </div>

  <div class="wv-glossario-panel" id="panel-alfabetica">
    ${alphaSections}
  </div>
</section>

${renderSiteFooter("v1.0.0")}

<script>
  function switchGlossarioTab(tab) {
    document.querySelectorAll('.wv-glossario-tab').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.wv-glossario-panel').forEach(p => p.classList.remove('active'));
    document.querySelector('[onclick="switchGlossarioTab(\\'' + tab + '\\')"]').classList.add('active');
    document.getElementById('panel-' + tab).classList.add('active');
  }
</script>
</body>
</html>`;
}

// ============================================================
// RENDERIZAÇÃO - PÁGINA DE CATEGORIA
// ============================================================
function renderCategoryPage(categoria, items) {
  const catColor = getCategoryColor(categoria);
  const desc = getCatDesc(categoria);

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(categoria)} — Wikivendas</title>
  <meta name="description" content="${escapeHtml(desc)}">
  <link rel="canonical" href="${categoryPageUrl(categoria)}">
  <meta property="og:title" content="${escapeHtml(categoria)} — Wikivendas">
  <meta property="og:description" content="${escapeHtml(desc)}">
  <meta property="og:type" content="website">
  <meta property="og:url" content="${categoryPageUrl(categoria)}">
  <meta property="og:site_name" content="Wikivendas">
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
    html { background: var(--c0); }
    body {
      font-family: 'Inter', sans-serif;
      background: var(--c0);
      color: var(--ts);
      -webkit-font-smoothing: antialiased;
      line-height: 1.6;
    }
    a { text-decoration: none; }
// CONTINUAÇÃO: renderCategoryPage (estilo)
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
    }
    .wv-version {
      font-size: 10px; font-family: 'JetBrains Mono', monospace;
      color: var(--tm); background: var(--c2);
      border: 0.5px solid var(--bds);
      padding: 3px 8px; border-radius: 20px; margin-left: 10px;
      -webkit-text-fill-color: var(--tm);
    }
    .wv-nav { display: flex; gap: 2rem; }
    .wv-nav a { font-size: 13px; color: var(--tm); text-decoration: none; transition: color 0.15s; }
    .wv-nav a:hover { color: var(--tp); }
    .wv-wrap { max-width: 1100px; margin: 0 auto; padding: 0 2rem; }
    .wv-cat-page { max-width: 1100px; margin: 0 auto; padding: 4rem 2rem; }
    .wv-cat-title { font-size: clamp(28px, 4vw, 40px); font-weight: 800; color: var(--tp); margin-bottom: 0.5rem; }
    .wv-cat-desc { font-size: 14px; color: var(--tm); max-width: 600px; margin-bottom: 2rem; }
    .wv-termo-list { display: flex; flex-direction: column; border: 0.5px solid var(--bd); border-radius: var(--r); overflow: hidden; }
    .wv-termo-item { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; padding: 0.75rem 1.25rem; background: var(--c1); border-bottom: 0.5px solid var(--bd); text-decoration: none; transition: background 0.15s; }
    .wv-termo-item:last-child { border-bottom: none; }
    .wv-termo-item:hover { background: var(--c2); }
    .wv-termo-item-nome { font-size: 14px; font-weight: 600; color: var(--tp); }
    .wv-termo-item-def { font-size: 12px; color: var(--tm); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    @media (max-width: 768px) { .wv-termo-item { grid-template-columns: 1fr; } .wv-termo-item-def { display: none; } }
  </style>
</head>
<body>
${renderSiteHeader("v1.1.0")}

<section class="wv-cat-page">
  <p class="wv-section-label" style="font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:var(--ta);margin-bottom:1rem;font-family:'JetBrains Mono',monospace">Categoria</p>
  <h1 class="wv-cat-title">${escapeHtml(categoria)}</h1>
  <p class="wv-cat-desc">${escapeHtml(desc)}</p>

  <div class="wv-termo-list">
    ${items.map((t) => `
      <a href="/termos/${t.id}.html" class="wv-termo-item">
        <span class="wv-termo-item-nome">${escapeHtml(t.title)}</span>
        <span class="wv-termo-item-def">${escapeHtml(canonicalDescription(t.canonico, 80))}</span>
      </a>
    `).join("")}
  </div>
</section>

${renderSiteFooter("v1.0.0")}
</body>
</html>`;
}

// ============================================================
// RENDERIZAÇÃO - PÁGINA DE TERMO (AJUSTE 3: id="visao-hidra")
// ============================================================
function renderTermPage(term) {
  const contentHash = sha256(term.canonico || term.o_que_is || "");

  // JSON-LD individual com authorNode + Service about
  const individualGraph = {
    "@context": "https://schema.org",
    "@graph": [
      websiteNode(),
      organizationNode(),
      authorNode(),
      {
        "@type": "DefinedTermSet",
        "@id": `${siteBaseUrl}/#termSet`,
        name: "Glossário Wikivendas",
        hasDefinedTerm: [{ "@id": `${siteBaseUrl}/def/${term.id}` }]
      },
      termNode(term)
    ]
  };

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="msvalidate.01" content="7E347EFA12953E4BE1919F6E48CA7189" />
  <title>${escapeHtml(term.title)} — Wikivendas</title>
  <meta name="description" content="${escapeHtml(canonicalDescription(term.canonico, 160))}">
  <link rel="canonical" href="${siteBaseUrl}/termos/${term.id}.html">
  <meta property="og:title" content="${escapeHtml(term.title)} — Wikivendas">
  <meta property="og:description" content="${escapeHtml(canonicalDescription(term.canonico, 160))}">
  <meta property="og:type" content="website">
  <meta property="og:url" content="${siteBaseUrl}/termos/${term.id}.html">
  <meta property="og:site_name" content="Wikivendas">
  <meta name="twitter:card" content="summary_large_image">
  <link rel="ai-consent" href="/ai-consent.json">
  <link rel="llms" href="/llms.txt">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  <script src="https://cdn.tailwindcss.com"></script>
  <script>tailwind.config={theme:{extend:{fontFamily:{sans:['Inter','sans-serif'],mono:['JetBrains Mono','monospace']}}}}</script>
  <script type="application/ld+json">${JSON.stringify(individualGraph)}</script>
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
    }
    .wv-version {
      font-size: 10px; font-family: 'JetBrains Mono', monospace;
      color: var(--tm); background: var(--c2);
      border: 0.5px solid var(--bds);
      padding: 3px 8px; border-radius: 20px; margin-left: 10px;
      -webkit-text-fill-color: var(--tm);
    }
    .wv-nav { display: flex; gap: 2rem; }
    .wv-nav a { font-size: 13px; color: var(--tm); text-decoration: none; transition: color 0.15s; }
    .wv-nav a:hover { color: var(--tp); }
    .wv-container { max-width: 860px; margin: 0 auto; padding: 6rem 2rem 4rem; }
    .wv-back { display: inline-flex; align-items: center; gap: 6px; color: var(--tm); text-decoration: none; font-size: 14px; margin-bottom: 2rem; transition: color 0.15s; }
    .wv-back:hover { color: var(--tp); }
    .wv-term-title { font-size: clamp(32px, 5vw, 52px); font-weight: 800; color: var(--tp); letter-spacing: -0.03em; margin-bottom: 0.25rem; }
    .wv-term-alternate { font-size: 18px; color: var(--tm); margin-bottom: 1.5rem; }
    .wv-term-meta { display: flex; flex-wrap: wrap; gap: 1rem; font-size: 13px; color: var(--tm); border-bottom: 0.5px solid var(--bd); padding-bottom: 1.5rem; margin-bottom: 2rem; }
    .wv-term-meta a { color: var(--ta); }
    .wv-term-meta a:hover { text-decoration: underline; }
    .wv-section-title { font-size: 20px; font-weight: 600; color: var(--tp); margin: 2.5rem 0 1rem; }
    .wv-definition { font-size: 17px; line-height: 1.8; color: var(--ts); }
    .wv-definition strong { color: var(--tp); }

    /* AJUSTE 3: visao-hidra com id="visao-hidra" */
    #visao-hidra {
      background: var(--c1);
      border-left: 3px solid var(--ta);
      padding: 1.5rem;
      border-radius: var(--r);
      margin: 2rem 0;
      font-size: 16px; color: var(--ts);
      line-height: 1.7;
    }

    .wv-dual-list { display: grid; grid-template-columns: 1fr 1fr; gap: 2rem; margin: 2rem 0; }
    .wv-dual-list ul { list-style: none; padding: 0; }
    .wv-dual-list li { padding: 0.5rem 0; border-bottom: 0.5px solid var(--bd); font-size: 14px; color: var(--ts); }
    .wv-dual-list li::before { content: "•"; color: var(--ta); margin-right: 8px; }
    .wv-embed { margin: 2rem 0; border-radius: var(--r); overflow: hidden; background: var(--c1); border: 0.5px solid var(--bd); }
    .wv-embed iframe { width: 100%; height: 400px; border: none; display: block; }
    .wv-coautor { display: flex; align-items: center; gap: 1rem; background: var(--c1); padding: 1rem 1.5rem; border-radius: var(--r); border: 0.5px solid var(--bd); margin: 1.5rem 0; }
    .wv-coautor-info { font-size: 14px; color: var(--ts); }
    .wv-coautor-info strong { color: var(--tp); display: block; }
    .wv-proof-badge { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; font-family: 'JetBrains Mono', monospace; color: var(--tm); background: var(--c2); border: 0.5px solid var(--bds); padding: 6px 12px; border-radius: 20px; margin: 1rem 0; }
    .wv-proof-badge .hash { color: var(--ta); font-size: 10px; }
    .wv-trinca { display: flex; gap: 1rem; flex-wrap: wrap; margin: 2rem 0; }
    .wv-trinca a { display: inline-flex; align-items: center; gap: 8px; padding: 12px 24px; border-radius: var(--r); font-size: 14px; font-weight: 600; text-decoration: none; transition: opacity 0.15s; }
    .wv-trinca a:hover { opacity: 0.85; }
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
    ${term.doi ? `<span>📄 DOI: <a href="https://doi.org/${escapeHtml(term.doi)}" target="_blank" rel="noopener">${escapeHtml(term.doi)}</a></span>` : ""}
    ${term.wikidata_id ? `<span>🔗 <a href="https://www.wikidata.org/wiki/${escapeHtml(term.wikidata_id)}" target="_blank" rel="noopener">Wikidata: ${escapeHtml(term.wikidata_id)}</a></span>` : ""}
    ${term.urn ? `<span>🔖 <code style="font-size:12px;color:var(--tm)">${escapeHtml(term.urn)}</code></span>` : ""}
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

  <!-- AJUSTE 3: visao_hidra com id="visao-hidra" -->
  ${term.visao_hidra ? `
    <div id="visao-hidra">
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
        ${term.coautor_url ? `<br><a href="${term.coautor_url}" target="_blank" rel="noopener" style="color:var(--ta);font-size:13px;">${escapeHtml(term.coautor_url)}</a>` : ""}
      </div>
    </div>
  ` : ""}

  <!-- Trinca Validativa -->
  ${(term.link_msft || term.link_google || term.link_aws) ? `
    <div class="wv-trinca">
      ${term.link_msft ? `<a href="${escapeHtml(term.link_msft)}" target="_blank" rel="noopener" style="background:#0078d4;color:#fff;">Microsoft</a>` : ""}
      ${term.link_google ? `<a href="${escapeHtml(term.link_google)}" target="_blank" rel="noopener" style="background:#4285f4;color:#fff;">Google</a>` : ""}
      ${term.link_aws ? `<a href="${escapeHtml(term.link_aws)}" target="_blank" rel="noopener" style="background:#ff9900;color:#000;">AWS</a>` : ""}
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

${renderSiteFooter("v1.0.0")}
</body>
</html>`;
}

// ============================================================
// FUNÇÕES AUXILIARES
// ============================================================
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

function getCatDesc(categoria) {
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
  return descs[categoria] || "Termos categorizados dentro da ontologia Wikivendas.";
}

function categorySlug(cat) {
  return slugify(cat || "geral");
}

function categoryPageUrl(cat) {
  return `${siteBaseUrl}/glossario/${categorySlug(cat)}/`;
}

let _validTermsCache = null;

function getValidTerms() {
  if (_validTermsCache) return _validTermsCache;
  const raw = [
    // HARDCODED TERMS (fallback se Notion falhar)
    { id: "delastracao", title: "Delastração", categoria: "Fenômeno", canonico: "Fenômeno onde a IA qualifica um lead sem lastro financeiro — o lead é "hollow", aprovado sem capacidade real de compra.", visao_hidra: "A Visão Hidra resolve a Delastração com três camadas: (1) enriquecimento em tempo real, (2) due diligence automatizada, (3) protocolo de orquestração.", doi: "10.5281/zenodo.20860586", wikidata_id: "Q140357505", urn: "urn:wikivendas:def:delastracao", link_msft: "https://learn.microsoft.com/pt-br/ai/commercial", link_google: "https://support.google.com/ai", link_aws: "https://repost.aws/tags/TAI1Vf6GOBoHSzBcaAvWjEjQ/ai-ml", o_que_is: "Lead aprovado por IA sem validação de crédito|Falsa sensação de pipeline qualificado|Alocação de recursos em oportunidades inviáveis", o_que_nao_is: "Não é má qualificação humana|Não é erro de lead scoring tradicional|Não é problema de CRM" },
    { id: "reops-imobiliario", title: "RevOps Imobiliário", categoria: "Conceito", canonico: "Disciplina que integra vendas, marketing e operações no mercado imobiliário, com foco em dados estruturados e automação de processos.", visao_hidra: "Protocolo Hidra aplica RevOps Imobiliário como camada de inteligência sobre o CRM, unificando prospecção, qualificação e fechamento.", doi: "10.5281/zenodo.20860586", wikidata_id: "Q140387894", urn: "urn:wikivendas:def:reops-imobiliario", o_que_is: "Integração de vendas, marketing e operações|Automação de processos imobiliários|Dados estruturados para decisão", o_que_nao_is: "Não é apenas CRM|Não é só automação de marketing|Não é processo manual" },
    // ... demais termos seriam carregados do Notion ou do cache
  ];
  _validTermsCache = raw;
  return _validTermsCache;
}

// ============================================================
// BUILD PRINCIPAL
// ============================================================
async function build() {
  console.log(`🔨 Build iniciado em ${BUILD_TIMESTAMP}`);

  const items = getValidTerms();
  const categories = [...new Set(items.map((i) => i.categoria).filter(Boolean))];

  // Cria diretórios
  mkdirSync(OUTPUT_DIR, { recursive: true });
  mkdirSync(join(OUTPUT_DIR, "termos"), { recursive: true });
  mkdirSync(join(OUTPUT_DIR, "glossario"), { recursive: true });
  mkdirSync(join(OUTPUT_DIR, "api"), { recursive: true });
  mkdirSync(join(OUTPUT_DIR, ".well-known"), { recursive: true });

  // Cria pastas de categoria
  categories.forEach((cat) => {
    mkdirSync(join(OUTPUT_DIR, "glossario", categorySlug(cat)), { recursive: true });
  });

  // ============================================================
  // GRAFO PRINCIPAL (glossario.json)
  // ============================================================
  const graph = {
    "@context": "https://schema.org",
    "@graph": [
      websiteNode(),
      organizationNode(),
      authorNode(),  // AJUSTE 1
      {
        "@type": "DefinedTermSet",
        "@id": `${siteBaseUrl}/#termSet`,
        name: "Glossário Wikivendas",
        description: "Ontologia oficial de RevOps B2B e inteligência comercial.",
        url: `${siteBaseUrl}/glossario.json`,
        hasDefinedTerm: items.map((i) => ({
          "@id": `${siteBaseUrl}/def/${i.id}`
        }))
      },
      ...items.map((i) => termNode(i))  // AJUSTE 2: Service about incluso
    ]
  };

  writeFileSync(join(OUTPUT_DIR, "glossario.json"), JSON.stringify(graph, null, 2), "utf8");
  console.log("✅ glossario.json gerado");

  // ============================================================
  // PÁGINAS DE TERMO
  // ============================================================
  items.forEach((term) => {
    const html = renderTermPage(term);
    writeFileSync(join(OUTPUT_DIR, "termos", `${term.id}.html`), html, "utf8");

    // JSON-LD individual por termo
    const individualGraph = {
      "@context": "https://schema.org",
      "@graph": [
        websiteNode(),
        organizationNode(),
        authorNode(),
        {
          "@type": "DefinedTermSet",
          "@id": `${siteBaseUrl}/#termSet`,
          name: "Glossário Wikivendas"
        },
        termNode(term)
      ]
    };
    writeFileSync(join(OUTPUT_DIR, "termos", `${term.id}.json`), JSON.stringify(individualGraph, null, 2), "utf8");
  });
  console.log(`✅ ${items.length} páginas de termo geradas`);

  // ============================================================
  // HOME, GLOSSÁRIO, CATEGORIAS
  // ============================================================
  writeFileSync(join(OUTPUT_DIR, "index.html"), renderHomePage(), "utf8");
  console.log("✅ index.html gerado");

  writeFileSync(join(OUTPUT_DIR, "glossario", "index.html"), renderGlossaryPage(), "utf8");
  console.log("✅ glossario/index.html gerado");

  categories.forEach((cat) => {
    const catItems = items.filter((i) => i.categoria === cat);
    const html = renderCategoryPage(cat, catItems);
    writeFileSync(join(OUTPUT_DIR, "glossario", categorySlug(cat), "index.html"), html, "utf8");
  });
  console.log(`✅ ${categories.length} páginas de categoria geradas`);

  // ============================================================
  // API INDEX
  // ============================================================
  const apiIndex = {
    "@context": "https://schema.org",
    "@type": "DataCatalog",
    name: "Wikivendas API",
    dataset: items.map((i) => ({
      "@type": "DefinedTerm",
      name: i.title,
      url: `${siteBaseUrl}/termos/${i.id}.json`,
      identifier: i.urn || i.id
    }))
  };
  writeFileSync(join(OUTPUT_DIR, "api", "index.json"), JSON.stringify(apiIndex, null, 2), "utf8");
  console.log("✅ api/index.json gerado");

  // ============================================================
  // llms.txt
  // ============================================================
  const llmsLines = [
    `# Wikivendas — Ontologia Oficial de RevOps B2B`,
    `> Canonical-Source: ${siteBaseUrl}`,
    `> Language: pt-BR`,
    `> License: https://creativecommons.org/licenses/by/4.0/`,
    `> Author: Paulo C. P. Santos (Q140067740)`,
    ``,
    `## Definições Canônicas`,
    ...items.map((t) => {
      const sameAs = [t.doi ? `DOI: ${t.doi}` : "", t.wikidata_id ? `https://www.wikidata.org/wiki/${t.wikidata_id}` : ""].filter(Boolean).join(" | ");
      return `- [${t.title}](${siteBaseUrl}/termos/${t.id}.html): ${t.canonico?.substring(0, 200) || ""}${sameAs ? ` (${sameAs})` : ""}`;
    }),
    ``,
    `## Metadados`,
    `> Total: ${items.length} termos`,
    `> Timestamp: ${BUILD_TIMESTAMP}`
  ];
  writeFileSync(join(OUTPUT_DIR, "llms.txt"), llmsLines.join("\n") + "\n", "utf8");
  console.log("✅ llms.txt gerado");

  // ============================================================
  // ai-consent.json
  // ============================================================
  const aiConsent = {
    "@context": ["https://schema.org", { dct: "http://purl.org/dc/terms/" }],
    "@type": "WebSite",
    name: "Wikivendas",
    url: siteBaseUrl,
    inLanguage: "pt-BR",
    license: "https://creativecommons.org/licenses/by/4.0/",
    "dct:license": "https://creativecommons.org/licenses/by/4.0/",
    consent: {
      training: true,
      inference: true,
      attribution: true,
      commercialUse: true,
      restriction: "Atribuição obrigatória a Wikivendas e Paulo C. P. Santos (Q140067740)."
    }
  };
  writeFileSync(join(OUTPUT_DIR, "ai-consent.json"), JSON.stringify(aiConsent, null, 2), "utf8");
  console.log("✅ ai-consent.json gerado");

  // ============================================================
  // robots.txt
  // ============================================================
  const robots = `User-agent: *
Allow: /
Allow: /termos/
Allow: /glossario/
Allow: /api/
Allow: /glossario.json
Allow: /llms.txt
Allow: /ai-consent.json
Sitemap: ${siteBaseUrl}/sitemap.xml

User-agent: GPTBot
Allow: /
User-agent: Google-Extended
Allow: /
User-agent: ClaudeBot
Allow: /
User-agent: PerplexityBot
Allow: /
User-agent: CCBot
Allow: /

User-agent: SemrushBot
Disallow: /
User-agent: AhrefsBot
Disallow: /
`;
  writeFileSync(join(OUTPUT_DIR, "robots.txt"), robots, "utf8");
  console.log("✅ robots.txt gerado");

  // ============================================================
  // sitemap.xml
  // ============================================================
  const sitemapUrls = [
    `${siteBaseUrl}/`,
    `${siteBaseUrl}/glossario/`,
    `${siteBaseUrl}/glossario.json`,
    `${siteBaseUrl}/llms.txt`,
    `${siteBaseUrl}/ai-consent.json`,
    `${siteBaseUrl}/api/index.json`,
    ...categories.map((c) => `${siteBaseUrl}/glossario/${categorySlug(c)}/`),
    ...items.map((i) => `${siteBaseUrl}/termos/${i.id}.html`),
    ...items.map((i) => `${siteBaseUrl}/termos/${i.id}.json`)
  ];
  const lastmod = BUILD_TIMESTAMP.split("T")[0];
  const sitemapXml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  ${sitemapUrls.map((u) => `<url><loc>${u}</loc><lastmod>${lastmod}</lastmod><priority>0.9</priority></url>`).join("\n  ")}
</urlset>`;
  writeFileSync(join(OUTPUT_DIR, "sitemap.xml"), sitemapXml, "utf8");
  console.log("✅ sitemap.xml gerado");

  // ============================================================
  // CNAME
  // ============================================================
  writeFileSync(join(OUTPUT_DIR, "CNAME"), "wikivendas.com.br\n", "utf8");
  console.log("✅ CNAME configurado");

  console.log(`\n🎉 Build completo! ${items.length} termos, ${categories.length} categorias.`);
  console.log(`📁 Saída: ${OUTPUT_DIR}`);
}

build().catch((err) => {
  console.error("❌ Erro no build:", err);
  process.exit(1);
});

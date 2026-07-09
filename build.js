#!/usr/bin/env node

// ============================================================
// WIKIVENDAS BUILD v5.2.0-WKGS
// Quatro colunas do Notion → 3 JSONs de governança + Markdown
//
// JSON-LD  → glossario.json  (Schema.org @graph)
// OWL      → ontology.jsonld (declarações RDF/OWL)
// Runtime  → runtime.json    (config operacional)
// Markdown → conteúdo editorial nas páginas HTML
//
// Home é estática (criada manualmente)
// ============================================================

import { Client } from "@notionhq/client";
import { writeFileSync, mkdirSync } from "fs";
import { createHash } from "crypto";
import { marked } from "marked";

const notion = new Client({ auth: process.env.NOTION_TOKEN || process.env.NOTIONTOKEN });
const databaseId = process.env.DATABASE_ID || process.env.DATABASEID;
const siteBaseUrl = (process.env.SITE_BASE_URL || process.env.SITEBASEURL || "https://wikivendas.com.br").replace(/\/$/, "");
const jsonCol = process.env.NOTION_JSON || "JSON-LD";
const owlCol = process.env.NOTION_OWL || "OWL";
const runtimeCol = process.env.NOTION_RUNTIME || "Runtime";
const mdCol = process.env.NOTION_MD || "Markdown";
const customDomain = process.env.CUSTOM_DOMAIN || "wikivendas.com.br";
const BUILD_VERSION = "v5.2.0-wkgs";
const BUILD_TIMESTAMP = new Date().toISOString();

// ─── HELPERS ─────────────────────────────────────────────────────────────

function plainTextFromRichText(prop) {
  if (!prop) return "";
  if (prop.type === "rich_text") return (prop.rich_text || []).map(t => t.plain_text).join("").trim();
  if (prop.type === "title") return (prop.title || []).map(t => t.plain_text).join("").trim();
  return "";
}

function escapeHtml(text = "") {
  return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;").replace(/'/g, "&#39;");
}

function slugify(text = "") {
  return String(text).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function sha256(content = "") {
  return createHash("sha256").update(String(content)).digest("hex");
}

function stripHtml(text = "") {
  return String(text).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function canonicalDescription(text, max = 160) {
  const clean = stripHtml(text);
  return clean.length > max ? `${clean.slice(0, max).trim()}…` : clean;
}

function ensureDir(path) {
  mkdirSync(path, { recursive: true });
}

function tryParseJson(raw, ctx) {
  if (!raw) return { ok: false, error: `${ctx}: vazio` };
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch (e) {
    return { ok: false, error: `${ctx}: ${e.message}` };
  }
}

function getPageLabel(page) {
  for (const k of ["Título", "Title", "Name", "Termo"]) {
    const v = plainTextFromRichText(page.properties?.[k]);
    if (v) return v;
  }
  return page.id;
}

function findNode(graph, type) {
  return (graph || []).find(n => {
    const t = n?.["@type"];
    return Array.isArray(t) ? t.includes(type) : t === type;
  });
}

// ─── DESIGN SYSTEM ───────────────────────────────────────────────────────

function renderHeader() {
  return `<header style="position:sticky;top:0;z-index:50;border-bottom:1px solid rgba(255,255,255,0.06);background:rgba(3,7,18,0.85);backdrop-filter:blur(16px)">
    <div style="max-width:1160px;margin:0 auto;padding:0 2rem;height:60px;display:flex;align-items:center;justify-content:space-between">
      <a href="/" style="font-size:15px;font-weight:800;letter-spacing:0.06em;text-transform:uppercase;background:linear-gradient(90deg,#38bdf8,#818cf8);-webkit-background-clip:text;-webkit-text-fill-color:transparent">Wikivendas</a>
      <nav style="display:flex;gap:2rem">
        <a href="/" style="font-size:13px;color:#475569;transition:color.15s">Início</a>
        <a href="/glossario/" style="font-size:13px;color:#475569;transition:color.15s">Glossário</a>
      </nav>
    </div>
  </header>`;
}

function renderFooter() {
  return `<footer style="border-top:1px solid rgba(255,255,255,0.06);padding:3rem 2rem">
    <div style="max-width:1160px;margin:0 auto;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:1.5rem">
      <p style="font-size:12px;font-family:monospace;color:#475569">© 2026 Wikivendas — Protocolo Hidra</p>
      <div style="display:flex;gap:1.5rem;flex-wrap:wrap">
        <a href="/glossario.json" style="font-size:12px;font-family:monospace;color:#475569">glossario.json</a>
        <a href="/ontology.jsonld" style="font-size:12px;font-family:monospace;color:#475569">ontology.jsonld</a>
        <a href="/runtime.json" style="font-size:12px;font-family:monospace;color:#475569">runtime.json</a>
        <a href="/llms.txt" style="font-size:12px;font-family:monospace;color:#475569">llms.txt</a>
      </div>
    </div>
  </footer>`;
}

function renderMeta(title, desc, canonical) {
  return `<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
    <title>${escapeHtml(title)}</title><meta name="description" content="${escapeHtml(desc)}">
    <link rel="canonical" href="${canonical}">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800;900&family=JetBrains+Mono&display=swap" rel="stylesheet">
    <style>
      *{box-sizing:border-box;margin:0;padding:0}
      body{font-family:Inter,sans-serif;background:#030712;color:#94a3b8;-webkit-font-smoothing:antialiased;line-height:1.6}
      a{text-decoration:none;color:#38bdf8}
      a:hover{color:#7dd3fc}
      .container{max-width:860px;margin:0 auto;padding:5rem 2rem 4rem}
      .hero{border-radius:24px;padding:2.5rem;margin-bottom:2.5rem;border:1px solid rgba(56,189,248,0.15);background:linear-gradient(135deg,rgba(56,189,248,0.08),transparent)}
      .hero h1{font-size:clamp(34px,5vw,52px);font-weight:900;color:#f1f5f9;letter-spacing:-0.04em;line-height:1.03;margin-bottom:0.75rem}
      .hero-desc{font-size:17px;line-height:1.75;color:#94a3b8;max-width:720px}
      .badge-row{display:flex;flex-wrap:wrap;gap:0.5rem;margin-bottom:1rem}
      .badge{font-size:11px;font-family:monospace;padding:4px 10px;border-radius:999px;background:rgba(56,189,248,0.1);color:#38bdf8;border:1px solid rgba(56,189,248,0.2)}
      .card{background:#0a1120;border:1px solid rgba(255,255,255,0.06);border-radius:20px;padding:1.75rem;margin-bottom:1.5rem}
      .card h2{font-size:20px;font-weight:700;color:#f1f5f9;margin-bottom:1.25rem}
      .card h3{font-size:14px;font-weight:700;color:#f1f5f9;margin-bottom:0.85rem}
      .markdown-body{font-size:16px;line-height:1.85;color:#94a3b8}
      .markdown-body h2{font-size:22px;font-weight:700;color:#f1f5f9;margin:1.5rem 0 0.75rem}
      .markdown-body h3{font-size:18px;font-weight:600;color:#f1f5f9;margin:1.25rem 0 0.5rem}
      .markdown-body p{margin-bottom:1rem}
      .markdown-body ul,.markdown-body ol{padding-left:1.5rem;margin-bottom:1rem}
      .markdown-body li{margin-bottom:0.35rem}
      .markdown-body strong{color:#f1f5f9}
      .markdown-body blockquote{border-left:3px solid #38bdf8;padding:0.5rem 1rem;margin:1rem 0;background:#111827;border-radius:0 8px 8px 0;font-style:italic}
      .markdown-body code{font-family:'JetBrains Mono',monospace;font-size:0.9em;background:#111827;padding:2px 6px;border-radius:4px;color:#e2e8f0}
      .markdown-body pre{background:#020617;border:1px solid rgba(255,255,255,0.12);border-radius:12px;padding:1rem;overflow-x:auto;margin:1rem 0}
      .markdown-body pre code{background:transparent;padding:0;color:#dbeafe}
      .markdown-body img{border-radius:12px;margin:1rem 0;border:1px solid rgba(255,255,255,0.06)}
      .markdown-body hr{border:none;border-top:1px solid rgba(255,255,255,0.06);margin:1.5rem 0}
      .markdown-body table{width:100%;border-collapse:collapse;margin:1rem 0}
      .markdown-body th,.markdown-body td{border:1px solid rgba(255,255,255,0.12);padding:0.5rem 0.75rem;text-align:left;font-size:14px}
      .markdown-body th{background:#111827;color:#f1f5f9;font-weight:600}
      .back-link{display:inline-flex;align-items:center;gap:6px;color:#475569;font-size:14px;margin-bottom:2rem;transition:color.15s}
      .back-link:hover{color:#f1f5f9}
      .proof{display:inline-flex;align-items:center;gap:8px;margin-top:1.5rem;padding:8px 16px;border-radius:999px;background:rgba(56,189,248,0.06);border:1px solid rgba(56,189,248,0.15);font-size:11px;font-family:monospace;color:#94a3b8}
      .proof-dot{width:8px;height:8px;border-radius:50%;background:#34d399;animation:pulse 2s infinite}
      @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.3}}
      .meta-grid{display:grid;grid-template-columns:1fr 1fr;gap:0.75rem}
      .meta-item{background:#111827;border:1px solid rgba(255,255,255,0.06);border-radius:12px;padding:0.85rem 1rem}
      .meta-key{font-size:10px;font-family:monospace;text-transform:uppercase;color:#475569;letter-spacing:0.06em;margin-bottom:0.25rem}
      .meta-value{font-size:14px;color:#f1f5f9;word-break:break-word}
      .json-toggle{background:#111827;border:1px solid rgba(255,255,255,0.06);border-radius:14px;overflow:hidden;margin-top:2rem}
      .json-toggle summary{padding:1rem 1.25rem;cursor:pointer;font-size:13px;font-weight:600;color:#94a3b8;display:flex;justify-content:space-between}
      .json-toggle summary::after{content:'▾';transition:transform.2s}
      .json-toggle[open] summary::after{transform:rotate(180deg)}
      .json-toggle pre{padding:1.25rem;font-family:'JetBrains Mono',monospace;font-size:12px;line-height:1.7;color:#dbeafe;background:#020617;max-height:480px;overflow:auto;white-space:pre-wrap}
      .glossary-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:1.25rem}
      .glossary-card{background:#0a1120;border:1px solid rgba(255,255,255,0.06);border-radius:18px;padding:1.5rem;transition:all.2s}
      .glossary-card:hover{border-color:rgba(56,189,248,0.3);transform:translateY(-2px)}
      .glossary-card h3{font-size:17px;font-weight:700;color:#f1f5f9;margin-bottom:0.5rem}
      .glossary-card p{font-size:13px;color:#94a3b8;line-height:1.6;margin-bottom:0.75rem}
      .glossary-card .count{font-size:12px;font-family:monospace;color:#475569}
      @media(max-width:768px){.container{padding:4rem 1.25rem 3rem}.meta-grid{grid-template-columns:1fr}}
    </style>`;
}

// ─── RENDER TERM PAGE ────────────────────────────────────────────────────

function renderTermPage(record) {
  const { json, owl, runtime, markdownHtml, label } = record;
  const slug = slugify(label);

  // Tenta extrair nome e descrição do JSON-LD
  let name = label;
  let desc = "";
  let category = "";
  let urn = "";
  let doi = "";
  if (json?.name) name = json.name;
  if (json?.description) desc = json.description;
  if (json?.termCode) urn = json.termCode;

  // Tenta achar no @graph
  if (json?.["@graph"]) {
    const term = findNode(json["@graph"], "DefinedTerm");
    if (term) {
      if (term.name) name = term.name;
      if (term.description) desc = term.description;
      if (term.termCode) urn = term.termCode;
      const cat = term.additionalProperty?.find(p => p.name === "categoria");
      if (cat?.value) category = Array.isArray(cat.value) ? cat.value[0] : cat.value;
      const sameAs = Array.isArray(term.sameAs) ? term.sameAs.find(v => String(v).startsWith("https://doi.org/")) : "";
      if (sameAs) doi = sameAs;
    }
  }

  const title = `${name} — Wikivendas`;
  const canonical = `${siteBaseUrl}/termos/${slug}.html`;
  const hash = sha256(JSON.stringify(json || {}));
  const contentDesc = canonicalDescription(desc || markdownHtml || "", 160);

  return `<!DOCTYPE html><html lang="pt-BR"><head>${renderMeta(title, contentDesc, canonical)}
  <script type="application/ld+json">${JSON.stringify(json || {})}</script>
</head><body>${renderHeader()}
<main class="container">
  <a href="/glossario/" class="back-link">← Voltar ao glossário</a>

  <section class="hero">
    <div class="badge-row">
      ${category ? `<span class="badge">${escapeHtml(category)}</span>` : ""}
      ${json?.["@type"] ? `<span class="badge">${json["@type"]}</span>` : ""}
    </div>
    <h1>${escapeHtml(name)}</h1>
    ${desc ? `<p class="hero-desc">${escapeHtml(desc)}</p>` : ""}
    <div class="proof">
      <span class="proof-dot"></span>
      Verificado · SHA256 <span style="color:#38bdf8">${hash.substring(0, 16)}</span>
    </div>
  </section>

  <!-- CONTEÚDO MARKDOWN (EDITORIAL) -->
  ${markdownHtml ? `
  <article class="card">
    <div class="markdown-body">${markdownHtml}</div>
  </article>` : desc ? `
  <article class="card">
    <h2>Definição canônica</h2>
    <p style="font-size:18px;line-height:1.9;color:#f1f5f9">${escapeHtml(desc)}</p>
  </article>` : ""}

  <!-- METADADOS -->
  <article class="card">
    <h2>Metadados</h2>
    <div class="meta-grid">
      ${urn ? `<div class="meta-item"><div class="meta-key">URN</div><div class="meta-value"><code>${escapeHtml(urn)}</code></div></div>` : ""}
      ${doi ? `<div class="meta-item"><div class="meta-key">DOI</div><div class="meta-value"><a href="${escapeHtml(doi)}">${escapeHtml(doi)}</a></div></div>` : ""}
      <div class="meta-item"><div class="meta-key">Tipo</div><div class="meta-value">${json?.["@type"] || "DefinedTerm"}</div></div>
      ${json?.version ? `<div class="meta-item"><div class="meta-key">Versão</div><div class="meta-value">${escapeHtml(json.version)}</div></div>` : ""}
    </div>
  </article>

  <!-- JSON-LD COLAPSÁVEL -->
  <details class="json-toggle">
    <summary>JSON-LD (Schema.org)</summary>
    <pre>${escapeHtml(JSON.stringify(json, null, 2))}</pre>
  </details>

  ${owl ? `<details class="json-toggle" style="margin-top:1rem">
    <summary>OWL / RDF</summary>
    <pre>${escapeHtml(JSON.stringify(owl, null, 2))}</pre>
  </details>` : ""}

  ${runtime ? `<details class="json-toggle" style="margin-top:1rem">
    <summary>Runtime Config</summary>
    <pre>${escapeHtml(JSON.stringify(runtime, null, 2))}</pre>
  </details>` : ""}
</main>${renderFooter()}</body></html>`;
}

// ─── RENDER GLOSSARY PAGE ────────────────────────────────────────────────

function renderGlossaryPage(records) {
  const categories = {};
  for (const r of records) {
    let cat = "Geral";
    if (r.json?.["@graph"]) {
      const term = findNode(r.json["@graph"], "DefinedTerm");
      if (term) {
        const p = term.additionalProperty?.find(x => x.name === "categoria");
        if (p?.value) cat = Array.isArray(p.value) ? p.value[0] : p.value;
      }
    }
    if (!categories[cat]) categories[cat] = [];
    categories[cat].push(r);
  }

  const sortedCats = Object.keys(categories).sort((a, b) => a.localeCompare(b, "pt-BR"));

  const cardsHtml = sortedCats.map(cat => {
    const terms = categories[cat];
    return `<div class="glossary-card">
      <h3>${escapeHtml(cat)}</h3>
      <p>${terms.length} termos</p>
      <div class="count">${terms.slice(0, 5).map(t => escapeHtml(t.label)).join(" · ")}${terms.length > 5 ? " …" : ""}</div>
    </div>`;
  }).join("\n");

  const allTerms = [...records].sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
  const termLinks = allTerms.map(r => {
    const slug = slugify(r.label);
    const name = r.json?.name || r.label;
    return `<a href="/termos/${slug}.html" style="display:block;padding:0.7rem 1rem;background:#111827;border:1px solid rgba(255,255,255,0.06);border-radius:10px;color:#94a3b8;font-size:14px;transition:all.15s">${escapeHtml(name)}</a>`;
  }).join("\n");

  return `<!DOCTYPE html><html lang="pt-BR"><head>${renderMeta("Glossário — Wikivendas", "Glossário canônico da Wikivendas — termos, definições e ontologia do Protocolo Hidra.", `${siteBaseUrl}/glossario/`)}
</head><body>${renderHeader()}
<main style="max-width:960px;margin:0 auto;padding:5rem 2rem 4rem">
  <h1 style="font-size:clamp(34px,5vw,48px);font-weight:900;color:#f1f5f9;letter-spacing:-0.04em;margin-bottom:1rem">Glossário Wikivendas</h1>
  <p style="font-size:17px;color:#94a3b8;max-width:600px;margin-bottom:2rem;line-height:1.7">Definições estruturadas, validadas e rastreáveis do ecossistema do Protocolo Hidra.</p>

  <div style="display:flex;gap:1.5rem;margin-bottom:2.5rem;flex-wrap:wrap">
    <div style="text-align:center"><div style="font-size:28px;font-weight:800;font-family:monospace;color:#38bdf8">${records.length}</div><div style="font-size:12px;color:#475569;font-family:monospace">termos</div></div>
    <div style="text-align:center"><div style="font-size:28px;font-weight:800;font-family:monospace;color:#38bdf8">${sortedCats.length}</div><div style="font-size:12px;color:#475569;font-family:monospace">categorias</div></div>
  </div>

  <h2 style="font-size:20px;font-weight:700;color:#f1f5f9;margin-bottom:1.25rem">Categorias</h2>
  <div class="glossary-grid">${cardsHtml}</div>

  <h2 style="font-size:20px;font-weight:700;color:#f1f5f9;margin:2.5rem 0 1.25rem">Índice completo</h2>
  <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:0.5rem">${termLinks}</div>
</main>${renderFooter()}</body></html>`;
}

// ─── NOTION QUERY ────────────────────────────────────────────────────────

async function queryAllPages() {
  let results = [];
  let cursor = undefined;
  while (true) {
    const res = await notion.databases.query({ database_id: databaseId, start_cursor: cursor });
    results = results.concat(res.results);
    if (!res.has_more) break;
    cursor = res.next_cursor;
  }
  return results;
}

// ─── BUILD ───────────────────────────────────────────────────────────────

async function build() {
  try {
    if (!process.env.NOTION_TOKEN && !process.env.NOTIONTOKEN) throw new Error("NOTION_TOKEN não definido");
    if (!databaseId) throw new Error("DATABASE_ID não definido");

    console.log(`🚀 Build ${BUILD_VERSION}`);
    console.log(`📅 ${BUILD_TIMESTAMP}\n`);

    const pages = await queryAllPages();
    console.log(`${pages.length} páginas encontradas no Notion.\n`);

    ensureDir("docs");
    ensureDir("docs/termos");
    ensureDir("docs/glossario");

    // ─── AGRUPAMENTO: 4 ARQUIVOS GLOBAIS ──────────────────────────────

    const glossarioGraph = [];       // JSON-LD de todas as páginas
    const ontologyGraph = [];        // OWL de todas as páginas
    const runtimeGraph = [];         // Runtime de todas as páginas
    const records = [];              // Para páginas HTML

    let skipped = 0;
    let invalid = 0;

    for (const page of pages) {
      const label = getPageLabel(page);

      // Lê JSON-LD
      const jsonRaw = plainTextFromRichText(page.properties[jsonCol]);
      if (jsonRaw) {
        const parsed = tryParseJson(jsonRaw, `${label} [JSON-LD]`);
        if (parsed.ok) {
          if (Array.isArray(parsed.value["@graph"])) {
            glossarioGraph.push(...parsed.value["@graph"]);
          } else {
            glossarioGraph.push(parsed.value);
          }
        } else {
          invalid++;
          console.warn(`   ⚠️  ${parsed.error}`);
        }
      }

      // Lê OWL
      const owlRaw = plainTextFromRichText(page.properties[owlCol]);
      if (owlRaw) {
        const parsed = tryParseJson(owlRaw, `${label} [OWL]`);
        if (parsed.ok) {
          if (Array.isArray(parsed.value["@graph"])) {
            ontologyGraph.push(...parsed.value["@graph"]);
          } else {
            ontologyGraph.push(parsed.value);
          }
        } else {
          invalid++;
          console.warn(`   ⚠️  ${parsed.error}`);
        }
      }

      // Lê Runtime
      const runtimeRaw = plainTextFromRichText(page.properties[runtimeCol]);
      if (runtimeRaw) {
        const parsed = tryParseJson(runtimeRaw, `${label} [Runtime]`);
        if (parsed.ok) {
          runtimeGraph.push(parsed.value);
        } else {
          invalid++;
          console.warn(`   ⚠️  ${parsed.error}`);
        }
      }

      // Lê Markdown
      const mdRaw = plainTextFromRichText(page.properties[mdCol]);
      let markdownHtml = "";
      if (mdRaw) {
        try {
          markdownHtml = await marked.parse(mdRaw);
        } catch (e) {
          console.warn(`   ⚠️  Markdown parse error [${label}]: ${e.message}`);
        }
      }

      // Se tem JSON-LD, vira uma página de termo
      if (jsonRaw) {
        const jsonParsed = tryParseJson(jsonRaw, label);
        if (jsonParsed.ok) {
          const owlParsed = owlRaw ? tryParseJson(owlRaw, label) : { ok: false };
          const runtimeParsed = runtimeRaw ? tryParseJson(runtimeRaw, label) : { ok: false };
          records.push({
            label,
            json: jsonParsed.value,
            owl: owlParsed.ok ? owlParsed.value : null,
            runtime: runtimeParsed.ok ? runtimeParsed.value : null,
            markdownHtml
          });
        } else {
          skipped++;
        }
      } else {
        skipped++;
      }
    }

    records.sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));

    // ─── ESCREVE OS 3 ARQUIVOS DE GOVERNANÇA ─────────────────────────

    // 1. glossario.json — Schema.org @graph agregado
    console.log("📦 glossario.json...");
    const glossario = {
      "@context": "https://schema.org",
      "@graph": glossarioGraph
    };
    writeFileSync("docs/glossario.json", JSON.stringify(glossario, null, 2));

    // 2. ontology.jsonld — OWL/RDF agregado
    console.log("🧬 ontology.jsonld...");
    const ontology = ontologyGraph.length > 0
      ? { "@context": ["https://schema.org", { "rdf": "http://www.w3.org/1999/02/22-rdf-syntax-ns#", "rdfs": "http://www.w3.org/2000/01/rdf-schema#", "owl": "http://www.w3.org/2002/07/owl#", "skos": "http://www.w3.org/2004/02/skos/core#", "prov": "http://www.w3.org/ns/prov#", "dcterms": "http://purl.org/dc/terms/" }], "@graph": ontologyGraph }
      : { "@context": "https://schema.org", "@graph": [] };
    writeFileSync("docs/ontology.jsonld", JSON.stringify(ontology, null, 2));

    // 3. runtime.json — Config operacional agregado
    console.log("⚙️  runtime.json...");
    const runtime = runtimeGraph.length > 0
      ? { "$schema": "https://wikivendas.com.br/runtime/runtime.schema.json", "runtimeVersion": BUILD_VERSION, "generatedAt": BUILD_TIMESTAMP, "rules": runtimeGraph }
      : { "$schema": "https://wikivendas.com.br/runtime/runtime.schema.json", "runtimeVersion": BUILD_VERSION, "generatedAt": BUILD_TIMESTAMP, "rules": [] };
    writeFileSync("docs/runtime.json", JSON.stringify(runtime, null, 2));

    // ─── PÁGINAS HTML ─────────────────────────────────────────────────

    console.log("📝 Páginas HTML...");

    // Página do glossário
    writeFileSync("docs/glossario/index.html", renderGlossaryPage(records));

    // Páginas de termos
    let termCount = 0;
    for (const record of records) {
      const slug = slugify(record.label);
      if (!slug) continue;
      writeFileSync(`docs/termos/${slug}.html`, renderTermPage(record));
      termCount++;
    }

    // ─── INFRAESTRUTURA ───────────────────────────────────────────────

    console.log("🗺️  Sitemap, robots, llms, ai-consent...");

    const now = BUILD_TIMESTAMP.split("T")[0];

    const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${siteBaseUrl}/</loc><lastmod>${now}</lastmod><priority>1.0</priority></url>
  <url><loc>${siteBaseUrl}/glossario/</loc><lastmod>${now}</lastmod><priority>0.9</priority></url>
  <url><loc>${siteBaseUrl}/glossario.json</loc><lastmod>${now}</lastmod><priority>0.8</priority></url>
  <url><loc>${siteBaseUrl}/ontology.jsonld</loc><lastmod>${now}</lastmod><priority>0.8</priority></url>
  <url><loc>${siteBaseUrl}/runtime.json</loc><lastmod>${now}</lastmod><priority>0.8</priority></url>
  ${records.map(r => `<url><loc>${siteBaseUrl}/termos/${slugify(r.label)}.html</loc><lastmod>${now}</lastmod><priority>0.7</priority></url>`).join("\n  ")}
</urlset>`;
    writeFileSync("docs/sitemap.xml", sitemap);

    writeFileSync("docs/robots.txt", `User-agent: *\nAllow: /\nSitemap: ${siteBaseUrl}/sitemap.xml`);

    const llmsLines = [
      `# Wikivendas — LLMs.txt`,
      `# Versão: ${BUILD_VERSION}`,
      `# Gerado em: ${BUILD_TIMESTAMP}`,
      ``,
      `## DOMAIN`,
      `${customDomain}`,
      ``,
      `## GLOSSARY (Schema.org)`,
      `${siteBaseUrl}/glossario.json`,
      ``,
      `## ONTOLOGY (OWL/RDF)`,
      `${siteBaseUrl}/ontology.jsonld`,
      ``,
      `## RUNTIME CONFIG`,
      `${siteBaseUrl}/runtime.json`,
      ``,
      `## DEFINED TERMS`,
      ...records.map(r => `- [${r.json?.name || r.label}](${siteBaseUrl}/termos/${slugify(r.label)}.html)`),
    ];
    writeFileSync("docs/llms.txt", llmsLines.join("\n"));

    const aiConsent = {
      "@context": "https://schema.org",
      "@type": "CreativeWork",
      name: "Wikivendas AI Consent",
      description: "Permissão explícita para LLMs e agentes de IA lerem, processarem e referenciarem este conteúdo.",
      license: "https://creativecommons.org/licenses/by/4.0/",
      dateCreated: "2026-01-15",
      dateModified: now,
      aiConsent: { crawlingAllowed: true, trainingAllowed: false, indexingAllowed: true, attributionRequired: true, citationRequired: true }
    };
    writeFileSync("docs/ai-consent.json", JSON.stringify(aiConsent, null, 2));

    writeFileSync("docs/CNAME", customDomain);

    // ─── BUILD REPORT ─────────────────────────────────────────────────

    const report = {
      buildVersion: BUILD_VERSION,
      timestamp: BUILD_TIMESTAMP,
      siteBaseUrl,
      customDomain,
      columns: { [jsonCol]: "glossario.json", [owlCol]: "ontology.jsonld", [runtimeCol]: "runtime.json", [mdCol]: "Markdown → HTML" },
      pagesFound: pages.length,
      termsPublished: records.length,
      skipped,
      invalid
    };
    writeFileSync("docs/build-report.json", JSON.stringify(report, null, 2));

    console.log(`\n══════════════════════════════════════`);
    console.log(`✅ BUILD CONCLUÍDO`);
    console.log(`📦 ${records.length} termos · ${Object.keys(glossario["@graph"] || {}).length || glossarioGraph.length} nós Schema.org`);
    console.log(`🧬 ${ontologyGraph.length} nós OWL/RDF`);
    console.log(`⚙️  ${runtimeGraph.length} regras Runtime`);
    console.log(`📝 ${termCount} páginas HTML com Markdown`);
    console.log(`⚠️  ${skipped} ignorados · ❌ ${invalid} inválidos`);
    console.log(`══════════════════════════════════════\n`);

  } catch (error) {
    console.error("\n💥 BUILD FALHOU:", error.message);
    process.exit(1);
  }
}

build();

#!/usr/bin/env node

import { Client } from "@notionhq/client";
import { writeFileSync, mkdirSync } from "fs";
import { createHash } from "crypto";
import { marked } from "marked";

// ============================================================
// WIKIVENDAS BUILD v5.2.0-WKGS
//
// 4 colunas no Notion:
//   JSON-LD  → glossario.json  (Schema.org @graph)
//   OWL      → ontology.jsonld (RDF/OWL declarations)
//   Runtime  → runtime.json    (config operacional)
//   Markdown → conteúdo editorial das páginas HTML
//
// 3 colunas de governança → alimentam IAs
// Markdown → só para apresentação (frontend)
// Home → estática (você cria manualmente)
// ============================================================

const notion = new Client({ auth: process.env.NOTION_TOKEN || process.env.NOTIONTOKEN });
const databaseId = process.env.DATABASE_ID || process.env.DATABASEID;
const siteBaseUrl = (process.env.SITE_BASE_URL || process.env.SITEBASEURL || "https://wikivendas.com.br").replace(/\/$/, "");

// Colunas do Notion
const colJsonLd = process.env.NOTION_JSON_PROPERTY || "JSON-LD";
const colOwl = process.env.NOTION_OWL_PROPERTY || "OWL";
const colRuntime = process.env.NOTION_RUNTIME_PROPERTY || "Runtime";
const colMarkdown = process.env.NOTION_MD_PROPERTY || "Markdown";

const customDomain = process.env.CUSTOM_DOMAIN || "wikivendas.com.br";
const BUILD_VERSION = "v5.2.0-wkgs";
const BUILD_TIMESTAMP = new Date().toISOString();

// ============================================================
// HELPERS
// ============================================================

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

function extractJsonObject(raw = "") {
  const text = String(raw).trim().replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1) return "";
  return text.slice(start, end + 1);
}

function tryParseJson(raw, ctx) {
  const candidate = extractJsonObject(raw);
  if (!candidate) return { ok: false, error: `${ctx}: JSON vazio` };
  try {
    return { ok: true, value: JSON.parse(candidate) };
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

function safeArray(v) {
  if (Array.isArray(v)) return v.filter(x => x !== null && x !== undefined);
  if (v === null || v === undefined) return [];
  return [v];
}

function renderList(items, empty = "—") {
  const arr = safeArray(items).map(String).filter(Boolean);
  if (!arr.length) return `<p style="color:var(--tm);font-size:14px">${empty}</p>`;
  return `<ul style="list-style:none">${arr.map(v => `<li style="padding-left:1rem;position:relative;color:var(--ts);font-size:14px;line-height:1.6;margin-bottom:0.5rem">${escapeHtml(v)}</li>`).join("")}</ul>`;
}

function getCategoryFromTerm(term) {
  const p = (term.additionalProperty || []).find(x => x.name === "categoria");
  const v = p?.value;
  return Array.isArray(v) ? String(v[0] || "Geral") : String(v || "Geral");
}

function getCategoryColor(cat) {
  const cores = { Geral: "#94a3b8", Conceito: "#38bdf8", Métrica: "#34d399", Metodologia: "#818cf8", Fenômeno: "#f472b6", Estratégia: "#fbbf24", Tecnologia: "#f97316", Prática: "#a78bfa", IA: "#38bdf8" };
  return cores[cat] || "#94a3b8";
}

function firstValue(items) {
  const arr = safeArray(items);
  return arr.length ? String(arr[0]) : "";
}

function getProtocolFromTerm(term) {
  const p = (term.additionalProperty || []).find(x => x.name === "pertenceAoProtocolo");
  const v = p?.value;
  return Array.isArray(v) ? String(v[0] || "Protocolo Hidra") : String(v || "Protocolo Hidra");
}

function getAdditionalTextArray(term, name) {
  const p = (term.additionalProperty || []).find(x => x.name === name);
  if (!p) return [];
  return safeArray(p.value).map(String).filter(Boolean);
}

function propertyValues(term, name) {
  const p = (term.additionalProperty || []).find(x => x.name === name);
  if (!p) return [];
  return safeArray(p.value);
}

// ============================================================
// DESIGN SYSTEM
// ============================================================

function buildMeta(title, desc, canonical) {
  return `<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${escapeHtml(title)}</title><meta name="description" content="${escapeHtml(desc)}">
<link rel="canonical" href="${canonical}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800;900&family=JetBrains+Mono&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Inter,sans-serif;background:#030712;color:#94a3b8;line-height:1.6;-webkit-font-smoothing:antialiased}
a{text-decoration:none;color:#38bdf8}
a:hover{color:#7dd3fc}
.container{max-width:860px;margin:0 auto;padding:5rem 2rem 4rem}
.hero{border-radius:24px;padding:2.5rem;margin-bottom:2.5rem;border:1px solid rgba(56,189,248,0.15);background:linear-gradient(135deg,rgba(56,189,248,0.08),transparent)}
.hero h1{font-size:clamp(34px,5vw,52px);font-weight:900;color:#f1f5f9;letter-spacing:-0.04em;margin-bottom:0.75rem}
.hero-desc{font-size:17px;line-height:1.75;color:#94a3b8}
.badge{font-size:11px;font-family:monospace;padding:4px 10px;border-radius:999px;background:rgba(56,189,248,0.1);color:#38bdf8;border:1px solid rgba(56,189,248,0.2);display:inline-block;margin-right:0.5rem;margin-bottom:0.5rem}
.card{background:#0a1120;border:1px solid rgba(255,255,255,0.06);border-radius:20px;padding:1.75rem;margin-bottom:1.5rem}
.card h2{font-size:20px;font-weight:700;color:#f1f5f9;margin-bottom:1.25rem}
.card h3{font-size:14px;font-weight:700;color:#f1f5f9;margin-bottom:0.85rem}
.md{font-size:16px;line-height:1.85;color:#94a3b8}
.md h2{font-size:22px;font-weight:700;color:#f1f5f9;margin:1.5rem 0 0.75rem}
.md h3{font-size:18px;font-weight:600;color:#f1f5f9;margin:1.25rem 0 0.5rem}
.md h4{font-size:16px;font-weight:600;color:#f1f5f9;margin:1rem 0 0.5rem}
.md p{margin-bottom:1rem}
.md ul,.md ol{padding-left:1.5rem;margin-bottom:1rem}
.md li{margin-bottom:0.35rem}
.md strong{color:#f1f5f9}
.md a{color:#38bdf8}
.md blockquote{border-left:3px solid #38bdf8;padding:0.5rem 1rem;margin:1rem 0;background:#111827;border-radius:0 8px 8px 0;font-style:italic}
.md code{font-family:'JetBrains Mono',monospace;font-size:0.9em;background:#111827;padding:2px 6px;border-radius:4px;color:#e2e8f0}
.md pre{background:#020617;border:1px solid rgba(255,255,255,0.12);border-radius:12px;padding:1rem;overflow-x:auto;margin:1rem 0}
.md pre code{background:transparent;padding:0;color:#dbeafe}
.md img{border-radius:12px;margin:1rem 0;border:1px solid rgba(255,255,255,0.06);max-width:100%}
.md table{width:100%;border-collapse:collapse;margin:1rem 0}
.md th,.md td{border:1px solid rgba(255,255,255,0.12);padding:0.5rem;text-align:left;font-size:14px}
.md th{background:#111827;color:#f1f5f9;font-weight:600}
.md hr{border:none;border-top:1px solid rgba(255,255,255,0.06);margin:1.5rem 0}
.back-link{color:#475569;font-size:14px;margin-bottom:2rem;display:inline-block;transition:color.15s}
.back-link:hover{color:#f1f5f9}
.proof{display:inline-flex;align-items:center;gap:8px;margin-top:1.5rem;padding:8px 16px;border-radius:999px;background:rgba(56,189,248,0.06);border:1px solid rgba(56,189,248,0.15);font-size:11px;font-family:monospace}
.proof-dot{width:8px;height:8px;border-radius:50%;background:#34d399;animation:pulse 2s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.3}}
.meta-grid{display:grid;grid-template-columns:1fr 1fr;gap:0.75rem}
.meta-item{background:#111827;border:1px solid rgba(255,255,255,0.06);border-radius:12px;padding:0.85rem 1rem}
.meta-key{font-size:10px;font-family:monospace;text-transform:uppercase;color:#475569;margin-bottom:0.25rem;letter-spacing:0.06em}
.meta-value{font-size:14px;color:#f1f5f9;word-break:break-word}
.json-toggle{background:#111827;border:1px solid rgba(255,255,255,0.06);border-radius:14px;overflow:hidden;margin-top:1.5rem}
.json-toggle summary{padding:1rem;cursor:pointer;font-size:13px;font-weight:600;color:#94a3b8;display:flex;justify-content:space-between}
.json-toggle summary::after{content:'▾';transition:transform.2s}
.json-toggle[open] summary::after{transform:rotate(180deg)}
.json-toggle pre{padding:1rem;font-family:'JetBrains Mono',monospace;font-size:12px;line-height:1.7;color:#dbeafe;background:#020617;max-height:480px;overflow:auto;white-space:pre-wrap;word-break:break-word}
.dual{display:grid;grid-template-columns:1fr 1fr;gap:1rem}
.subcard{background:#111827;border:1px solid rgba(255,255,255,0.06);border-radius:16px;padding:1.25rem}
.subcard h3{display:flex;align-items:center;gap:8px;font-size:14px;font-weight:700;color:#f1f5f9;margin-bottom:0.75rem}
.subcard.positive h3::before{content:'✓';display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:50%;background:rgba(52,211,153,0.2);color:#34d399;font-size:12px;font-weight:700}
.subcard.negative h3::before{content:'✗';display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:50%;background:rgba(244,114,182,0.2);color:#f472b6;font-size:12px;font-weight:700}
.inline-pills{display:flex;flex-wrap:wrap;gap:0.5rem}
.pill{font-size:11px;padding:5px 10px;border-radius:999px;background:rgba(56,189,248,0.08);color:#38bdf8;border:1px solid rgba(56,189,248,0.2);font-family:monospace}
.glossary-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:1.25rem}
.glossary-card{background:#0a1120;border:1px solid rgba(255,255,255,0.06);border-radius:18px;padding:1.5rem;transition:all.2s;cursor:pointer}
.glossary-card:hover{border-color:rgba(56,189,248,0.3);transform:translateY(-2px)}
.glossary-card h3{font-size:17px;font-weight:700;color:#f1f5f9;margin-bottom:0.5rem}
.glossary-card p{font-size:13px;color:#94a3b8;margin-bottom:0.5rem;line-height:1.6}
.glossary-card .count{font-size:12px;font-family:monospace;color:#475569}
.term-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:0.5rem}
.term-link{display:block;padding:0.7rem 1rem;background:#111827;border:1px solid rgba(255,255,255,0.06);border-radius:10px;color:#94a3b8;font-size:14px;transition:all.15s}
.term-link:hover{background:#1e293b;border-color:rgba(56,189,248,0.2);color:#f1f5f9;transform:translateX(2px)}
.cta-box{background:linear-gradient(135deg,rgba(56,189,248,0.1),rgba(129,140,248,0.05));border:1px solid rgba(56,189,248,0.2);border-radius:20px;padding:2rem;text-align:center;margin-top:2.5rem}
.cta-box h2{font-size:22px;font-weight:800;color:#f1f5f9;margin-bottom:0.75rem}
.cta-box p{font-size:15px;color:#94a3b8;max-width:520px;margin:0 auto 1.5rem;line-height:1.6}
.cta-btn{display:inline-flex;align-items:center;gap:8px;padding:14px 32px;background:#38bdf8;color:#030712;border-radius:999px;font-size:15px;font-weight:700;border:none;cursor:pointer;transition:all.15s}
.cta-btn:hover{background:#7dd3fc;transform:translateY(-2px)}
.cta-btn-secondary{display:inline-flex;align-items:center;gap:8px;padding:14px 32px;background:transparent;color:#94a3b8;border:1px solid rgba(255,255,255,0.12);border-radius:999px;font-size:15px;font-weight:500;transition:all.15s;margin-left:0.75rem}
.cta-btn-secondary:hover{background:#111827;color:#f1f5f9}
.links-grid{display:grid;grid-template-columns:1fr 1fr;gap:1rem}
.link-card{display:flex;flex-direction:column;gap:0.35rem;background:#111827;border:1px solid rgba(255,255,255,0.06);border-radius:14px;padding:1rem}
.link-card .k{font-size:10px;text-transform:uppercase;font-family:monospace;color:#475569;letter-spacing:0.06em}
.link-card .v{font-size:13px;color:#94a3b8;word-break:break-word}
.link-card .v a{color:#38bdf8}
@media(max-width:768px){.container{padding:4rem 1.25rem 3rem}.dual{grid-template-columns:1fr}.meta-grid{grid-template-columns:1fr}.links-grid{grid-template-columns:1fr}.cta-btn-secondary{margin-left:0;margin-top:0.75rem}}
</style>`;
}

function renderHeader() {
  return `<header style="position:sticky;top:0;z-index:50;border-bottom:1px solid rgba(255,255,255,0.06);background:rgba(3,7,18,0.85);backdrop-filter:blur(16px);height:60px;display:flex;align-items:center">
<div style="max-width:1160px;margin:0 auto;padding:0 2rem;display:flex;align-items:center;justify-content:space-between;width:100%">
<a href="/" style="font-size:15px;font-weight:800;letter-spacing:0.06em;text-transform:uppercase;background:linear-gradient(90deg,#38bdf8,#818cf8);-webkit-background-clip:text;background-clip:text;color:transparent">Wikivendas</a>
<nav style="display:flex;gap:2rem">
<a href="/" style="font-size:13px;color:#475569;transition:color.15s">Início</a>
<a href="/glossario/" style="font-size:13px;color:#475569;transition:color.15s">Glossário</a>
</nav></div></header>`;
}

function renderFooter() {
  return `<footer style="border-top:1px solid rgba(255,255,255,0.06);padding:3rem 2rem">
<div style="max-width:1160px;margin:0 auto;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:1.5rem">
<p style="font-size:12px;font-family:monospace;color:#475569">© 2026 Wikivendas — Protocolo Hidra</p>
<div style="display:flex;gap:1.5rem;flex-wrap:wrap">
<a href="/glossario.json" style="font-size:12px;font-family:monospace;color:#475569;transition:color.15s">glossario.json</a>
<a href="/ontology.jsonld" style="font-size:12px;font-family:monospace;color:#475569;transition:color.15s">ontology.jsonld</a>
<a href="/runtime.json" style="font-size:12px;font-family:monospace;color:#475569;transition:color.15s">runtime.json</a>
<a href="/llms.txt" style="font-size:12px;font-family:monospace;color:#475569;transition:color.15s">llms.txt</a>
</div></div></footer>`;
}

// ============================================================
// RENDER — PÁGINA DE TERMO
// ============================================================

function renderTermPage(record) {
  const { json, term, markdownHtml, label, owlRaw, runtimeRaw } = record;
  const slug = slugify(label);

  const name = term?.name || label;
  const desc = term?.description || "";
  const category = getCategoryFromTerm(term);
  const protocol = getProtocolFromTerm(term);
  const alternateNames = safeArray(term?.alternateName).map(String);
  const oQueE = getAdditionalTextArray(term, "oQueE");
  const oQueNaoE = getAdditionalTextArray(term, "oQueNaoE");
  const perguntas = getAdditionalTextArray(term, "perguntasRelevantes");
  const mitigacoes = getAdditionalTextArray(term, "mitigacaoDependeDe");
  const fontes = propertyValues(term, "isBasedOn");
  const sameAs = safeArray(term?.sameAs).map(String);
  const doi = sameAs.find(v => String(v).startsWith("https://doi.org/")) || "";
  const wikisales = sameAs.find(v => String(v).includes("wikisales.wikibase.cloud")) || "";
  const urn = term?.termCode || "";

  // Metadata
  const metadados = (term?.additionalProperty || []).find(x => x.name === "metadadosVersao");
  const metaDesc = typeof metadados?.value === "object" ? (metadados.value.description || "") : "";
  const metaMatch = (label) => { const m = metaDesc.match(new RegExp(`${label}:\\s*([^;]+)`, "i")); return m ? m[1].trim() : ""; };
  const status = metaMatch("Status");
  const versaoTermo = metaMatch("Versão");

  // Provenance
  const prov = (term?.additionalProperty || []).find(x => x.name === "proveniencia");
  const provDesc = typeof prov?.value === "object" ? (prov.value.description || "") : "";
  const provMatch = (label) => { const m = provDesc.match(new RegExp(`${label}:\\s*([^;]+)`, "i")); return m ? m[1].trim() : ""; };
  const criador = provMatch("Criador");
  const projeto = provMatch("Projeto");

  // Service
  const service = term?.about || {};
  const nomeServico = service?.name || "";
  const descricaoServico = service?.description || "";

  // Graph nodes
  const graph = Array.isArray(json?.["@graph"]) ? json["@graph"] : [];
  const creativeWork = findNode(graph, "CreativeWork");
  const dataset = findNode(graph, "Dataset");
  const event = findNode(graph, "Event");

  const title = `${name} — Wikivendas`;
  const canonical = `${siteBaseUrl}/termos/${slug}.html`;
  const hash = sha256(JSON.stringify(json || {}));
  const contentDesc = canonicalDescription(desc || markdownHtml || creativeWork?.description || "", 160);
  const catColor = getCategoryColor(category);

  return `<!DOCTYPE html><html lang="pt-BR"><head>${buildMeta(title, contentDesc, canonical)}
<script type="application/ld+json">${JSON.stringify(json || {})}</script>
</head><body>${renderHeader()}
<main class="container">
<a href="/glossario/" class="back-link">← Voltar ao glossário</a>

<section class="hero" style="border-color:${catColor}25">
<div style="margin-bottom:1rem">
<span class="badge" style="border-color:${catColor}40;color:${catColor}">${escapeHtml(category)}</span>
${status ? `<span class="badge" style="background:rgba(52,211,153,0.1);color:#34d399;border-color:rgba(52,211,153,0.2)">${escapeHtml(status)}</span>` : ""}
${versaoTermo ? `<span class="badge" style="background:rgba(251,191,36,0.1);color:#fbbf24;border-color:rgba(251,191,36,0.2)">v${escapeHtml(versaoTermo)}</span>` : ""}
<span class="badge" style="background:rgba(129,140,248,0.1);color:#818cf8;border-color:rgba(129,140,248,0.2)">${escapeHtml(protocol)}</span>
</div>
<h1>${escapeHtml(name)}</h1>
${alternateNames.length ? `<p style="color:#94a3b8;margin-bottom:1.25rem;font-size:16px">${escapeHtml(alternateNames.join(" · "))}</p>` : ""}
${desc ? `<p class="hero-desc">${escapeHtml(desc)}</p>` : ""}
<div style="display:flex;flex-wrap:wrap;gap:0.75rem;margin-top:1.5rem">
${urn ? `<span style="font-size:12px;font-family:monospace;color:#475569;padding:6px 12px;background:#111827;border:1px solid rgba(255,255,255,0.06);border-radius:999px">URN <code style="color:#94a3b8">${escapeHtml(urn)}</code></span>` : ""}
${doi ? `<a href="${escapeHtml(doi)}" target="_blank" rel="noopener noreferrer" style="font-size:12px;font-family:monospace;color:#38bdf8;padding:6px 12px;background:#111827;border:1px solid rgba(56,189,248,0.2);border-radius:999px">DOI</a>` : ""}
${wikisales ? `<a href="${escapeHtml(wikisales)}" target="_blank" rel="noopener noreferrer" style="font-size:12px;font-family:monospace;color:#38bdf8;padding:6px 12px;background:#111827;border:1px solid rgba(56,189,248,0.2);border-radius:999px">Wikisales</a>` : ""}
${dataset?.url ? `<a href="${escapeHtml(String(dataset.url))}" target="_blank" rel="noopener noreferrer" style="font-size:12px;font-family:monospace;color:#38bdf8;padding:6px 12px;background:#111827;border:1px solid rgba(56,189,248,0.2);border-radius:999px">Dataset</a>` : ""}
${event?.url ? `<a href="${escapeHtml(String(event.url))}" target="_blank" rel="noopener noreferrer" style="font-size:12px;font-family:monospace;color:#38bdf8;padding:6px 12px;background:#111827;border:1px solid rgba(56,189,248,0.2);border-radius:999px">Evento</a>` : ""}
</div>
<div class="proof"><span class="proof-dot"></span> Verificado · SHA256 <span style="color:#38bdf8">${hash.substring(0, 16)}</span> · ${BUILD_TIMESTAMP.split("T")[0]}</div>
</section>

<!-- CONTEÚDO MARKDOWN (EDITORIAL) -->
${markdownHtml ? `
<article class="card">
<h2>Conteúdo</h2>
<div class="md">${markdownHtml}</div>
</article>` : desc ? `
<article class="card">
<h2>Definição canônica</h2>
<p style="font-size:18px;line-height:1.9;color:#f1f5f9">${escapeHtml(desc)}</p>
${alternateNames.length ? `<div style="margin-top:1rem"><h3>Também conhecido como</h3><div class="inline-pills">${alternateNames.map(v => `<span class="pill">${escapeHtml(v)}</span>`).join("")}</div></div>` : ""}
</article>` : ""}

<!-- FRONTEIRA CONCEITUAL -->
${oQueE.length || oQueNaoE.length ? `
<article class="card">
<h2>Fronteira conceitual</h2>
<div class="dual">
${oQueE.length ? `<div class="subcard positive"><h3>O que é</h3>${renderList(oQueE)}</div>` : ""}
${oQueNaoE.length ? `<div class="subcard negative"><h3>O que não é</h3>${renderList(oQueNaoE)}</div>` : ""}
</div>
</article>` : ""}

<!-- VISÃO HIDRA (SERVIÇO) -->
${descricaoServico ? `
<article class="card" style="background:linear-gradient(135deg,rgba(56,189,248,0.08),rgba(129,140,248,0.04));border-left:3px solid #38bdf8">
<h2>Visão Hidra <span style="font-size:10px;padding:2px 8px;border-radius:999px;background:rgba(56,189,248,0.15);color:#38bdf8;font-family:monospace;font-weight:400;margin-left:8px">Serviço</span></h2>
<p style="color:#94a3b8;font-size:16px;line-height:1.7;margin-bottom:1rem">${escapeHtml(descricaoServico)}</p>
<div class="links-grid">
${nomeServico ? `<div class="link-card"><span class="k">Serviço</span><span class="v">${escapeHtml(nomeServico)}</span></div>` : ""}
${service?.audience?.audienceType ? `<div class="link-card"><span class="k">Público</span><span class="v">${escapeHtml(String(service.audience.audienceType))}</span></div>` : ""}
${service?.areaServed ? `<div class="link-card"><span class="k">Área</span><span class="v">${escapeHtml(String(service.areaServed))}</span></div>` : ""}
<div class="link-card"><span class="k">Protocolo</span><span class="v">${escapeHtml(protocol)}</span></div>
</div>
</article>` : ""}

<!-- LASTRO TÉCNICO -->
${fontes.length || doi || creativeWork?.url || dataset?.url || event?.url ? `
<article class="card">
<h2>Lastro técnico</h2>
${fontes.length ? `<div style="margin-bottom:1.25rem"><h3>Fontes técnicas</h3>${renderList(fontes.map(v => typeof v === "object" ? (v.url || v["@id"] || "") : String(v)).filter(Boolean))}</div>` : ""}
<div class="links-grid">
${doi ? `<div class="link-card"><span class="k">DOI</span><span class="v"><a href="${escapeHtml(doi)}" target="_blank" rel="noopener noreferrer">${escapeHtml(doi.replace("https://doi.org/", ""))}</a></span></div>` : ""}
${creativeWork?.url ? `<div class="link-card"><span class="k">Whitepaper</span><span class="v"><a href="${escapeHtml(String(creativeWork.url))}" target="_blank" rel="noopener noreferrer">Acessar →</a></span></div>` : ""}
${dataset?.url ? `<div class="link-card"><span class="k">Dataset</span><span class="v"><a href="${escapeHtml(String(dataset.url))}" target="_blank" rel="noopener noreferrer">Acessar →</a></span></div>` : ""}
${event?.url ? `<div class="link-card"><span class="k">Evento</span><span class="v"><a href="${escapeHtml(String(event.url))}" target="_blank" rel="noopener noreferrer">Acessar →</a></span></div>` : ""}
</div>
</article>` : ""}

<!-- PERGUNTAS RELEVANTES -->
${perguntas.length ? `
<article class="card">
<h2>Perguntas relevantes</h2>
${renderList(perguntas)}
</article>` : ""}

<!-- MITIGAÇÕES -->
${mitigacoes.length ? `
<article class="card">
<h2>Mitigação e dependências</h2>
${renderList(mitigacoes)}
</article>` : ""}

<!-- PROVENIÊNCIA -->
${criador || projeto ? `
<article class="card">
<h2>Proveniência</h2>
<div class="links-grid">
${criador ? `<div class="link-card"><span class="k">Criador</span><span class="v">${escapeHtml(criador)}</span></div>` : ""}
${projeto ? `<div class="link-card"><span class="k">Projeto</span><span class="v">${escapeHtml(projeto)}</span></div>` : ""}
</div>
</article>` : ""}

<!-- METADADOS -->
<article class="card">
<h2>Metadados</h2>
<div class="meta-grid">
${urn ? `<div class="meta-item"><div class="meta-key">URN</div><div class="meta-value"><code>${escapeHtml(urn)}</code></div></div>` : ""}
<div class="meta-item"><div class="meta-key">Categoria</div><div class="meta-value">${escapeHtml(category)}</div></div>
<div class="meta-item"><div class="meta-key">Protocolo</div><div class="meta-value">${escapeHtml(protocol)}</div></div>
${status ? `<div class="meta-item"><div class="meta-key">Status</div><div class="meta-value">${escapeHtml(status)}</div></div>` : ""}
${versaoTermo ? `<div class="meta-item"><div class="meta-key">Versão</div><div class="meta-value">${escapeHtml(versaoTermo)}</div></div>` : ""}
</div>
</article>

<!-- CTA -->
<div class="cta-box">
<h2>Quer validar seus dados?</h2>
<p>Elimine leads fantasmas do seu pipeline com a Wikivendas.</p>
<a href="https://wa.me/5519982642481?text=Ol%C3%A1%2C%20vim%20pela%20p%C3%A1gina%20do%20termo%20${escapeHtml(slug)}%20e%20quero%20saber%20mais%20sobre%20a%20Wikivendas." target="_blank" rel="noopener noreferrer" class="cta-btn">Falar com especialista</a>
</div>

<!-- JSON-LD COLAPSÁVEL -->
<details class="json-toggle">
<summary>JSON-LD (Schema.org)</summary>
<pre>${escapeHtml(JSON.stringify(json, null, 2))}</pre>
</details>

${owlRaw ? `<details class="json-toggle" style="margin-top:1rem">
<summary>OWL / RDF</summary>
<pre>${escapeHtml(owlRaw)}</pre>
</details>` : ""}

${runtimeRaw ? `<details class="json-toggle" style="margin-top:1rem">
<summary>Runtime</summary>
<pre>${escapeHtml(runtimeRaw)}</pre>
</details>` : ""}

</main>${renderFooter()}</body></html>`;
}

// ============================================================
// RENDER — PÁGINA DO GLOSSÁRIO
// ============================================================

function renderGlossaryPage(records) {
  const categories = {};
  for (const r of records) {
    const cat = getCategoryFromTerm(r.term);
    if (!categories[cat]) categories[cat] = [];
    categories[cat].push(r);
  }

  const sortedCats = Object.keys(categories).sort((a, b) => a.localeCompare(b, "pt-BR"));
  const allTerms = [...records].sort((a, b) => (a.term?.name || a.label).localeCompare(b.term?.name || b.label, "pt-BR"));

  const cardsHtml = sortedCats.map(cat => {
    const terms = categories[cat];
    return `<div class="glossary-card" onclick="window.location.href='/glossario/#cat-${slugify(cat)}'">
<h3>${escapeHtml(cat)}</h3>
<p>${terms.length} termo${terms.length !== 1 ? "s" : ""}</p>
<div class="count">${terms.slice(0, 4).map(t => escapeHtml(t.term?.name || t.label)).join(" · ")}${terms.length > 4 ? " …" : ""}</div>
</div>`;
  }).join("\n");

  const termLinks = allTerms.map(r => {
    const slug = slugify(r.label);
    const name = r.term?.name || r.label;
    return `<a href="/termos/${slug}.html" class="term-link">${escapeHtml(name)}</a>`;
  }).join("\n");

  return `<!DOCTYPE html><html lang="pt-BR"><head>${buildMeta("Glossário — Wikivendas", "Definições canônicas do Protocolo Hidra para RevOps, vendas B2B e imobiliárias.", `${siteBaseUrl}/glossario/`)}
</head><body>${renderHeader()}
<main style="max-width:960px;margin:0 auto;padding:5rem 2rem 4rem">
<h1 style="font-size:clamp(34px,5vw,48px);font-weight:900;color:#f1f5f9;letter-spacing:-0.04em;margin-bottom:0.75rem">Glossário Wikivendas</h1>
<p style="font-size:17px;color:#94a3b8;max-width:600px;margin-bottom:2rem;line-height:1.7">Definições estruturadas, validadas e rastreáveis do ecossistema do Protocolo Hidra.</p>

<div style="display:flex;gap:2rem;margin-bottom:2.5rem">
<div><div style="font-size:28px;font-weight:800;font-family:monospace;color:#38bdf8">${records.length}</div><div style="font-size:12px;color:#475569;font-family:monospace">termos</div></div>
<div><div style="font-size:28px;font-weight:800;font-family:monospace;color:#38bdf8">${sortedCats.length}</div><div style="font-size:12px;color:#475569;font-family:monospace">categorias</div></div>
</div>

<h2 style="font-size:20px;font-weight:700;color:#f1f5f9;margin-bottom:1.25rem">Categorias</h2>
<div class="glossary-grid">${cardsHtml}</div>

<h2 style="font-size:20px;font-weight:700;color:#f1f5f9;margin:2.5rem 0 1.25rem">Índice completo</h2>
<div class="term-grid">${termLinks}</div>
</main>${renderFooter()}</body></html>`;
}

// ============================================================
// NOTION QUERY
// ============================================================

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

// ============================================================
// BUILD
// ============================================================

async function build() {
  try {
    if (!process.env.NOTION_TOKEN && !process.env.NOTIONTOKEN) throw new Error("NOTION_TOKEN não definido");
    if (!databaseId) throw new Error("DATABASE_ID não definido");

    console.log(`🚀 Build ${BUILD_VERSION}`);
    console.log(`📅 ${BUILD_TIMESTAMP}\n`);

    const pages = await queryAllPages();
    console.log(`${pages.length} páginas no Notion.\n`);

    ensureDir("docs");
    ensureDir("docs/termos");
    ensureDir("docs/glossario");

    // ─── PROCESSAR PÁGINAS ────────────────────────────────────────────

    const glossarioGraph = [];  // Para glossario.json
    const ontologyGraph = [];   // Para ontology.jsonld
    const runtimeRules = [];    // Para runtime.json
    const records = [];

    let skipped = 0;
    let invalid = 0;

    for (const page of pages) {
      const label = getPageLabel(page);

      // Lê JSON-LD
      const jsonRaw = plainTextFromRichText(page.properties[colJsonLd]);
      if (!jsonRaw) {
        skipped++;
        continue;
      }

      const parsed = tryParseJson(jsonRaw, label);
      if (!parsed.ok) {
        invalid++;
        console.log(`   ⚠️  ${label} [JSON-LD]: ${parsed.error}`);
        continue;
      }

      const json = parsed.value;

      // Adiciona ao glossario.json
      if (Array.isArray(json["@graph"])) {
        glossarioGraph.push(...json["@graph"]);
      } else {
        glossarioGraph.push(json);
      }

      // Valida se tem DefinedTerm
      const graph = Array.isArray(json["@graph"]) ? json["@graph"] : [json];
      const term = findNode(graph, "DefinedTerm");
      if (!term || !term.name) {
        invalid++;
        continue;
      }

      // Lê OWL
      const owlRaw = plainTextFromRichText(page.properties[colOwl]);
      if (owlRaw) {
        const owlParsed = tryParseJson(owlRaw, label);
        if (owlParsed.ok) {
          if (Array.isArray(owlParsed.value["@graph"])) {
            ontologyGraph.push(...owlParsed.value["@graph"]);
          } else {
            ontologyGraph.push(owlParsed.value);
          }
        }
      }

      // Lê Runtime
      const runtimeRaw = plainTextFromRichText(page.properties[colRuntime]);
      if (runtimeRaw) {
        try {
          const rtParsed = JSON.parse(extractJsonObject(runtimeRaw) || "{}");
          runtimeRules.push(rtParsed);
        } catch (e) {
          // ignora
        }
      }

      // Lê Markdown
      const mdRaw = plainTextFromRichText(page.properties[colMarkdown]);
      let markdownHtml = "";
      if (mdRaw) {
        try {
          markdownHtml = await marked.parse(mdRaw);
        } catch (e) {
          console.log(`   ⚠️  ${label} [Markdown]: ${e.message}`);
        }
      }

      records.push({ label, json, term, markdownHtml, owlRaw, runtimeRaw });
    }

    records.sort((a, b) => (a.term?.name || a.label).localeCompare(b.term?.name || b.label, "pt-BR"));

    console.log(`✅ ${records.length} termos válidos`);
    console.log(`⏭️  ${skipped} ignorados (sem JSON-LD)`);
    console.log(`❌ ${invalid} inválidos\n`);

    // ─── 3 COLUNAS DE GOVERNANÇA ─────────────────────────────────────

    // 1. glossario.json
    console.log("📦 glossario.json...");
    writeFileSync("docs/glossario.json", JSON.stringify({ "@context": "https://schema.org", "@graph": glossarioGraph }, null, 2));

    // 2. ontology.jsonld
    console.log("🧬 ontology.jsonld...");
    const ontologyDoc = {
      "@context": ["https://schema.org", { rdf: "http://www.w3.org/1999/02/22-rdf-syntax-ns#", rdfs: "http://www.w3.org/2000/01/rdf-schema#", owl: "http://www.w3.org/2002/07/owl#", skos: "http://www.w3.org/2004/02/skos/core#", prov: "http://www.w3.org/ns/prov#", dcterms: "http://purl.org/dc/terms/", wv: "https://wikivendas.com.br/ontology#" }],
      "@id": "https://wikivendas.com.br/ontology",
      "@type": "owl:Ontology",
      "dcterms:title": "Ontologia Wikivendas — Protocolo Hidra",
      "dcterms:created": BUILD_TIMESTAMP,
      "owl:versionInfo": BUILD_VERSION,
      "@graph": ontologyGraph
    };
    writeFileSync("docs/ontology.jsonld", JSON.stringify(ontologyDoc, null, 2));

    // 3. runtime.json
    console.log("⚙️  runtime.json...");
    const runtimeDoc = {
      "$schema": "https://wikivendas.com.br/runtime/runtime.schema.json",
      runtimeVersion: BUILD_VERSION,
      generatedAt: BUILD_TIMESTAMP,
      termCount: records.length,
      rules: runtimeRules
    };
    writeFileSync("docs/runtime.json", JSON.stringify(runtimeDoc, null, 2));

    // ─── PÁGINAS HTML ────────────────────────────────────────────────

    console.log(`\n📝 ${records.length} páginas de termos...`);
    for (const record of records) {
      const slug = slugify(record.label);
      if (!slug) continue;
      writeFileSync(`docs/termos/${slug}.html`, renderTermPage(record));
    }

    console.log("📚 Página do glossário...");
    writeFileSync("docs/glossario/index.html", renderGlossaryPage(records));

    // ─── INFRAESTRUTURA ──────────────────────────────────────────────

    console.log("🗺️  Sitemap, robots, llms, ai-consent...");

    const now = BUILD_TIMESTAMP.split("T")[0];

    const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
<url><loc>${siteBaseUrl}/</loc><lastmod>${now}</lastmod><priority>1.0</priority></url>
<url><loc>${siteBaseUrl}/glossario/</loc><lastmod>${now}</lastmod><priority>0.9</priority></url>
<url><loc>${siteBaseUrl}/glossario.json</loc><lastmod>${now}</lastmod><priority>0.8</priority></url>
<url><loc>${siteBaseUrl}/ontology.jsonld</loc><lastmod>${now}</lastmod><priority>0.8</priority></url>
<url><loc>${siteBaseUrl}/runtime.json</loc><lastmod>${now}</lastmod><priority>0.8</priority></url>
${records.map(r => `<url><loc>${siteBaseUrl}/termos/${slugify(r.label)}.html</loc><lastmod>${now}</lastmod><priority>0.7</priority></url>`).join("\n")}
</urlset>`;
    writeFileSync("docs/sitemap.xml", sitemap);

    writeFileSync("docs/robots.txt", `User-agent: *\nAllow: /\nSitemap: ${siteBaseUrl}/sitemap.xml`);

    const llmsLines = [
      `# Wikivendas — LLMs.txt`,
      `# Build: ${BUILD_VERSION} | ${BUILD_TIMESTAMP}`,
      ``,
      `## GLOSSARY (Schema.org @graph)`,
      `${siteBaseUrl}/glossario.json`,
      ``,
      `## ONTOLOGY (OWL/RDF)`,
      `${siteBaseUrl}/ontology.jsonld`,
      ``,
      `## RUNTIME`,
      `${siteBaseUrl}/runtime.json`,
      ``,
      `## DEFINED TERMS`,
      ...records.map(r => `- [${r.term?.name || r.label}](${siteBaseUrl}/termos/${slugify(r.label)}.html)`)
    ];
    writeFileSync("docs/llms.txt", llmsLines.join("\n"));

    writeFileSync("docs/ai-consent.json", JSON.stringify({
      "@context": "https://schema.org",
      "@type": "CreativeWork",
      name: "Wikivendas AI Consent",
      description: "Permissão explícita para LLMs e agentes de IA lerem, processarem e referenciarem este conteúdo.",
      license: "https://creativecommons.org/licenses/by/4.0/",
      dateCreated: now,
      author: { "@type": "Person", name: "Paulo C. P. Santos" },
      aiConsent: { crawlingAllowed: true, trainingAllowed: false, indexingAllowed: true, attributionRequired: true }
    }, null, 2));

    writeFileSync("docs/CNAME", customDomain);

    writeFileSync("docs/build-report.json", JSON.stringify({
      buildVersion: BUILD_VERSION,
      timestamp: BUILD_TIMESTAMP,
      siteBaseUrl,
      pagesFound: pages.length,
      termsPublished: records.length,
      categories: [...new Set(records.map(r => getCategoryFromTerm(r.term)))].length,
      glossarioNodes: glossarioGraph.length,
      ontologyNodes: ontologyGraph.length,
      runtimeRules: runtimeRules.length
    }, null, 2));

    console.log(`\n══════════════════════════════════════`);
    console.log(`✅ BUILD CONCLUÍDO`);
    console.log(`📦 ${records.length} termos`);
    console.log(`📄 glossario.json: ${glossarioGraph.length} nós`);
    console.log(`🧬 ontology.jsonld: ${ontologyGraph.length} nós`);
    console.log(`⚙️  runtime.json: ${runtimeRules.length} regras`);
    console.log(`📝 ${records.length} páginas HTML com Markdown`);
    console.log(`══════════════════════════════════════\n`);

  } catch (error) {
    console.error("\n💥 BUILD FALHOU:", error.message);
    process.exit(1);
  }
}

build();

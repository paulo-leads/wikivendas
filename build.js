#!/usr/bin/env node

import { Client } from "@notionhq/client";
import { writeFileSync, mkdirSync } from "fs";
import { createHash } from "crypto";

// ============================================================
// WIKIVENDAS BUILD v4.0.0 MASTER
// JSON-first, template-preserved, hardened, GitHub Pages ready
// Compatível com o TEMPLATE MESTRE — TERMO CANÔNICO WIKIVENDAS
// ============================================================

const notion = new Client({ auth: process.env.NOTION_TOKEN || process.env.NOTIONTOKEN });
const databaseId = process.env.DATABASE_ID || process.env.DATABASEID;
const siteBaseUrl = (process.env.SITE_BASE_URL || process.env.SITEBASEURL || "https://wikivendas.com.br").replace(/\/$/, "");
const jsonPropertyName = process.env.NOTION_JSON_PROPERTY || process.env.NOTIONJSONPROPERTY || "JSON-LD";
const customDomain = process.env.CUSTOM_DOMAIN || process.env.CUSTOMDOMAIN || "wikivendas.com.br";
const BUILD_VERSION = "v4.0.0-master-template-mestre";
const BUILD_TIMESTAMP = new Date().toISOString();

// ============================================================
// HELPERS BÁSICOS
// ============================================================

function plainTextFromRichText(prop) {
  if (!prop) return "";
  if (prop.type === "rich_text") return (prop.rich_text || []).map(t => t.plain_text).join("").trim();
  if (prop.type === "title") return (prop.title || []).map(t => t.plain_text).join("").trim();
  if (prop.type === "formula" && prop.formula?.type === "string") return prop.formula.string || "";
  return "";
}

function escapeHtml(text = "") {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function slugify(text = "") {
  return String(text)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
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


function normalizeJsonText(raw = "") {
  return String(raw)
    .trim()
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(
      /https:\/\/wikisales\.wikibase\.cloud\/wiki\/Item:\s*Q/g,
      "https://wikisales.wikibase.cloud/wiki/Item:Q"
    )
    .replace(/[\u0000-\u001F]+/g, " ");
}


function extractJsonObject(raw = "") {
  const text = normalizeJsonText(raw);
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return "";
  return text.slice(start, end + 1);
}

function tryParseJson(raw, contextLabel) {
  const candidate = extractJsonObject(raw);
  if (!candidate) return { ok: false, error: `${contextLabel}: JSON vazio ou ausente`, excerpt: "" };
  try {
    return { ok: true, value: JSON.parse(candidate) };
  } catch (error) {
    const posMatch = String(error.message).match(/position\s+(\d+)/i);
    const pos = posMatch ? Number(posMatch[1]) : null;
    const excerpt = pos !== null
      ? candidate.slice(Math.max(0, pos - 150), Math.min(candidate.length, pos + 150))
      : candidate.slice(0, 320);
    return { ok: false, error: `${contextLabel}: ${error.message}`, excerpt };
  }
}

function getPageLabel(page) {
  const keys = ["Título", "Title", "Name", "Termo"];
  for (const key of keys) {
    const prop = page.properties?.[key];
    const value = plainTextFromRichText(prop);
    if (value) return value;
  }
  return page.id;
}

function safeArray(value) {
  if (Array.isArray(value)) return value.filter(v => v !== null && v !== undefined && String(v).trim() !== "");
  if (value === null || value === undefined || String(value).trim() === "") return [];
  return [value];
}

function toDisplayText(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "object" && value.url) return String(value.url);
  if (typeof value === "object" && value.description) return String(value.description);
  return JSON.stringify(value);
}

function renderList(items, empty = "Não informado.") {
  const arr = safeArray(items).map(toDisplayText).filter(Boolean);
  if (!arr.length) return `<p class="wv-empty">${escapeHtml(empty)}</p>`;
  return `<ul class="wv-bullets">${arr.map(v => `<li>${escapeHtml(v)}</li>`).join("")}</ul>`;
}

function renderLinkList(items, empty = "Não informado.") {
  const arr = safeArray(items).map(item => typeof item === "object" ? (item.url || item['@id'] || "") : item).filter(Boolean);
  if (!arr.length) return `<p class="wv-empty">${escapeHtml(empty)}</p>`;
  return `<ul class="wv-bullets">${arr.map(v => `<li><a href="${escapeHtml(v)}" target="_blank" rel="noopener noreferrer">${escapeHtml(v)}</a></li>`).join("")}</ul>`;
}

function firstValue(items) {
  const arr = safeArray(items);
  return arr.length ? arr[0] : "";
}

// ============================================================
// GRAPH HELPERS
// ============================================================

function findNode(graph, type) {
  return (graph || []).find(node => {
    const t = node?.["@type"];
    return Array.isArray(t) ? t.includes(type) : t === type;
  });
}

function findNodes(graph, type) {
  return (graph || []).filter(node => {
    const t = node?.["@type"];
    return Array.isArray(t) ? t.includes(type) : t === type;
  });
}

function findProperty(term, name) {
  return (term.additionalProperty || []).find(p => p?.name === name);
}

function propertyValues(term, name) {
  const prop = findProperty(term, name);
  if (!prop) return [];
  return Array.isArray(prop.value) ? prop.value : [prop.value].filter(Boolean);
}

function propertyThingDescription(term, name) {
  const prop = findProperty(term, name);
  return typeof prop?.value === "object" ? (prop.value?.description || "") : "";
}

function getDefinedTermId(termNode) {
  const id = termNode?.["@id"] || "";
  return id.split("/").pop() || slugify(termNode?.name || "termo");
}

function getTermPrimaryDoi(term) {
  if (!Array.isArray(term.sameAs)) return "";
  const doi = term.sameAs.find(v => String(v).startsWith("https://doi.org/"));
  return doi || "";
}

function getTermPrimaryWikisales(term) {
  if (!Array.isArray(term.sameAs)) return "";
  const qid = term.sameAs.find(v => String(v).includes("wikisales.wikibase.cloud/wiki/Item:Q"));
  return qid || "";
}

function getAdditionalTextArray(term, name) {
  return propertyValues(term, name).map(toDisplayText).filter(Boolean);
}

function getSameAsLinks(term) {
  return safeArray(term.sameAs).map(String).filter(Boolean);
}

function getWhitepaperNode(graph, termId) {
  return (graph || []).find(node => String(node?.["@id"] || "") === `${termId}#whitepaper`) || findNode(graph, "CreativeWork");
}

function getEventNode(graph, termId) {
  return (graph || []).find(node => String(node?.["@id"] || "") === `${termId}#event-apresentacao`) || findNode(graph, "Event");
}

// ============================================================
// VALIDAÇÃO
// ============================================================

function validateGraph(json) {
  if (!json || json["@context"] !== "https://schema.org") {
    throw new Error("@context ausente ou diferente de https://schema.org");
  }

  if (!Array.isArray(json["@graph"]) || !json["@graph"].length) {
    throw new Error("@graph ausente ou vazio");
  }

  const required = ["WebSite", "Organization", "Person", "DefinedTermSet", "DefinedTerm"];
  for (const type of required) {
    if (!findNode(json["@graph"], type)) {
      throw new Error(`Nó obrigatório ausente: ${type}`);
    }
  }

  const term = findNode(json["@graph"], "DefinedTerm");
  ["dateCreated", "dateModified", "version", "status"].forEach((field) => {
    if (field in term) {
      throw new Error(`DefinedTerm não pode conter ${field} diretamente`);
    }
  });

  if (!term.name) throw new Error("DefinedTerm sem name");
  if (!term.termCode) throw new Error("DefinedTerm sem termCode");
  return true;
}

// ============================================================
// IDENTIDADE / TAXONOMIA / TEMPLATE MESTRE
// ============================================================

function getCategoryFromTerm(term) {
  return firstValue(propertyValues(term, "categoria")) || "Geral";
}

function getProtocolFromTerm(term) {
  return firstValue(propertyValues(term, "pertenceAoProtocolo")) || "Protocolo Hidra";
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
    "Prática": "#a78bfa",
    "IA": "#38bdf8"
  };
  return cores[categoria] || "#94a3b8";
}

function getCatDesc(cat) {
  const descs = {
    "Geral": "Termos fundamentais do ecossistema de RevOps e inteligência comercial.",
    "Conceito": "Definições canônicas de fenômenos, processos e entidades do mercado B2B.",
    "Métrica": "Indicadores e KPIs usados para mensurar desempenho comercial.",
    "Metodologia": "Frameworks, protocolos e abordagens sistematizadas de vendas e prospecção.",
    "Fenômeno": "Padrões emergentes, disfunções de mercado e comportamentos sistêmicos observados.",
    "Estratégia": "Posicionamentos táticos e planos de ação para vantagem competitiva.",
    "Tecnologia": "Ferramentas, plataformas e artefatos tecnológicos do ecossistema B2B.",
    "Prática": "Táticas operacionais e rotinas do campo comercial.",
    "IA": "Termos ligados a IA, autoridade semântica e infraestrutura cognitiva."
  };
  return descs[cat] || "Termos categorizados dentro da ontologia Wikivendas.";
}

function parseMetadataDescription(metaText = "") {
  const text = String(metaText || "");
  const extract = (label) => {
    const match = text.match(new RegExp(`${label}:\\s*([^;]+)`, "i"));
    return match ? match[1].trim() : "";
  };
  return {
    versao: extract("Versão do termo"),
    status: extract("Status"),
    criadoEm: extract("Criado em"),
    modificadoEm: extract("Modificado em")
  };
}

function parseProvenanceDescription(text = "") {
  const extract = (label) => {
    const match = String(text).match(new RegExp(`${label}:\\s*([^;]+)`, "i"));
    return match ? match[1].trim() : "";
  };
  return {
    criador: extract("Criador"),
    projeto: extract("Projeto"),
    primeiraPublicacao: extract("Primeira publicação"),
    contexto: extract("Contexto")
  };
}

function extractTemplateData(record) {
  const { json, graph, term, creativeWork, dataCatalog, dataset, event } = record;
  const termId = term?.["@id"] || "";
  const termSlug = getDefinedTermId(term);
  const category = getCategoryFromTerm(term);
  const protocol = getProtocolFromTerm(term);
  const oQueE = getAdditionalTextArray(term, "oQueE");
  const oQueNaoE = getAdditionalTextArray(term, "oQueNaoE");
  const perguntas = getAdditionalTextArray(term, "perguntasRelevantes");
  const mitigacoes = getAdditionalTextArray(term, "mitigacaoDependeDe");
  const fontes = propertyValues(term, "isBasedOn");
  const provenance = propertyThingDescription(term, "proveniencia");
  const metadados = propertyThingDescription(term, "metadadosVersao");
  const parsedMeta = parseMetadataDescription(metadados);
  const parsedProv = parseProvenanceDescription(provenance);
  const service = term.about || {};
  const sameAs = getSameAsLinks(term);
  const doi = getTermPrimaryDoi(term);
  const wikisales = getTermPrimaryWikisales(term);
  const alternateNames = safeArray(term.alternateName).map(String);
  const datasetKeywords = safeArray(dataset?.keywords).map(String);
  const urlPaginaTermo = term.url || `${siteBaseUrl}/termos/${termSlug}.html`;
  const shortDescription = canonicalDescription(term.description || creativeWork?.description || "", 220);

  return {
    raw: json,
    graph,
    termId,
    termSlug,
    nomeCanonico: term.name || termSlug,
    sigla: (() => {
      const m = String(term.name || "").match(/\(([A-Z0-9\-]+)\)/);
      return m ? m[1] : "";
    })(),
    slug: termSlug,
    urn: term.termCode || "",
    status: parsedMeta.status,
    versaoTermo: parsedMeta.versao,
    dataCriacaoTermo: parsedMeta.criadoEm,
    dataModificacaoTermo: parsedMeta.modificadoEm,
    descricaoCurta: shortDescription,
    descricaoLonga: term.description || "",
    alternateNames,
    categoria: category,
    pertenceAoProtocolo: protocol,
    oQueE,
    oQueNaoE,
    nomeServico: service.name || "Visão Hidra",
    descricaoServico: service.description || "",
    publico: service?.audience?.audienceType || "",
    areaAtendida: service.areaServed || "",
    fontesTecnicas: fontes.map(v => (typeof v === "object" ? (v.url || v["@id"] || JSON.stringify(v)) : String(v))).filter(Boolean),
    doi,
    sameAs,
    urlPrincipalPagina: urlPaginaTermo,
    urlWhitepaper: creativeWork?.url || "",
    urlDataset: dataset?.url || "",
    urlEvento: event?.url || "",
    mitigacoes,
    perguntas,
    criador: parsedProv.criador,
    projeto: parsedProv.projeto,
    contexto: parsedProv.contexto,
    primeiraPublicacao: parsedProv.primeiraPublicacao,
    whitepaper: creativeWork,
    dataCatalog,
    dataset,
    event,
    videoUrl: event?.url || "",
    wikibaseItem: dataCatalog?.url || dataset?.url || "",
    wikisales,
    metadadosTexto: metadados,
    provenienciaTexto: provenance,
    datasetKeywords
  };
}

function fallbackWebsiteNode() {
  return {
    "@type": "WebSite",
    "@id": `${siteBaseUrl}/#website`,
    name: "Wikivendas",
    url: siteBaseUrl,
    inLanguage: "pt-BR",
    description: "Primeira fonte de verdade para IA comercial B2B no Brasil — Ontologia do Protocolo Hidra."
  };
}

function fallbackOrganizationNode() {
  return {
    "@type": "Organization",
    "@id": `${siteBaseUrl}/#organization`,
    name: "Wikivendas",
    url: siteBaseUrl,
    description: "Projeto de ontologia e inteligência comercial B2B, mantendo o Protocolo Hidra."
  };
}

function fallbackAuthorNode() {
  return {
    "@type": "Person",
    "@id": `${siteBaseUrl}/#author`,
    name: "Paulo C. P. Santos",
    alternateName: "Paulo Leads",
    url: "https://pauloleads.com.br"
  };
}

function fallbackTermSetNode() {
  return {
    "@type": "DefinedTermSet",
    "@id": `${siteBaseUrl}/glossario.json#set`,
    name: "Glossário Wikivendas",
    description: "Ontologia oficial e definições canônicas do ecossistema Wikivendas.",
    url: `${siteBaseUrl}/glossario.json`
  };
}

// ============================================================
// META / SHELL DO SITE
// ============================================================

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
      --c0: #030712;
      --c1: #0a1120;
      --c2: #111827;
      --c3: #1e293b;
      --tp: #f1f5f9;
      --ts: #94a3b8;
      --tm: #475569;
      --ta: #38bdf8;
      --ta2: #818cf8;
      --tpink: #f472b6;
      --bd: rgba(255,255,255,0.06);
      --bds: rgba(255,255,255,0.12);
      --r: 14px;
      --r2: 18px;
    }
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    html { background: var(--c0); scroll-behavior: smooth; }
    body { font-family: 'Inter', sans-serif; background: var(--c0); color: var(--ts); -webkit-font-smoothing: antialiased; overflow-x: hidden; line-height: 1.6; }
    a { text-decoration: none; }
    .wv-header { position: sticky; top: 0; z-index: 50; border-bottom: 0.5px solid var(--bd); background: rgba(3,7,18,0.85); backdrop-filter: blur(16px); }
    .wv-header-inner { max-width: 1160px; margin: 0 auto; padding: 0 2rem; height: 60px; display: flex; align-items: center; justify-content: space-between; }
    .wv-logo { font-size: 15px; font-weight: 800; letter-spacing: 0.06em; text-transform: uppercase; background: linear-gradient(90deg, #38bdf8, #818cf8); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; }
    .wv-version { font-size: 10px; font-family: 'JetBrains Mono', monospace; color: var(--tm); background: var(--c2); border: 0.5px solid var(--bds); padding: 3px 8px; border-radius: 20px; margin-left: 10px; -webkit-text-fill-color: var(--tm); }
    .wv-nav { display: flex; gap: 2rem; }
    .wv-nav a { font-size: 13px; color: var(--tm); transition: color 0.15s; }
    .wv-nav a:hover { color: var(--tp); }
    .wv-section-label { font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--ta); margin-bottom: 1rem; font-family: 'JetBrains Mono', monospace; }
    .wv-btn-primary { display: inline-flex; align-items: center; gap: 8px; padding: 12px 28px; background: #38bdf8; color: #030712; border-radius: var(--r); font-size: 14px; font-weight: 700; transition: background 0.15s, transform 0.1s; border: none; cursor: pointer; }
    .wv-btn-primary:hover { background: #7dd3fc; transform: translateY(-1px); }
    .wv-btn-ghost { display: inline-flex; align-items: center; gap: 8px; padding: 12px 24px; background: transparent; color: var(--ts); border: 0.5px solid var(--bds); border-radius: var(--r); font-size: 14px; transition: background 0.15s, color 0.15s; }
    .wv-btn-ghost:hover { background: var(--c2); color: var(--tp); }
    .wv-pill { font-size: 10px; background: rgba(56,189,248,0.1); color: var(--ta); border: 0.5px solid rgba(56,189,248,0.2); padding: 3px 8px; border-radius: 20px; font-family: 'JetBrains Mono', monospace; }
    .wv-footer { border-top: 0.5px solid var(--bd); background: var(--c0); padding: 3rem 2rem; }
    .wv-footer-inner { max-width: 1160px; margin: 0 auto; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 1.5rem; }
    .wv-footer-copy { font-size: 12px; font-family: 'JetBrains Mono', monospace; color: var(--tm); }
    .wv-footer-links { display: flex; gap: 1.5rem; flex-wrap: wrap; }
    .wv-footer-links a { font-size: 12px; font-family: 'JetBrains Mono', monospace; color: var(--tm); transition: color 0.15s; }
    .wv-footer-links a:hover { color: var(--ts); }
    .wv-empty { color: var(--tm); font-size: 14px; }
    .wv-bullets { list-style: none; display: flex; flex-direction: column; gap: .8rem; }
    .wv-bullets li { position: relative; padding-left: 1rem; color: var(--ts); font-size: 14px; line-height: 1.65; }
    .wv-bullets li::before { content: ''; position: absolute; left: 0; top: .68rem; width: 6px; height: 6px; border-radius: 999px; background: var(--ta); }
    @media (max-width: 768px) { .wv-nav { display: none; } }
  </style>`;
}

function renderSiteHeader(version = BUILD_VERSION) {
  return `<header class="wv-header"><div class="wv-header-inner"><div style="display:flex;align-items:center"><a href="/" class="wv-logo">Wikivendas</a><span class="wv-version">${version}</span></div><nav class="wv-nav"><a href="/">Início</a><a href="/glossario/">Glossário</a><a href="/sobre/">Sobre</a><a href="https://pauloleads.com.br" target="_blank" rel="noopener noreferrer">Paulo Leads</a></nav></div></header>`;
}

function renderSiteFooter(version = BUILD_VERSION) {
  return `<footer class="wv-footer"><div class="wv-footer-inner"><div><div style="display:flex;align-items:center;gap:10px;margin-bottom:0.5rem"><span class="wv-logo">Wikivendas</span><span class="wv-version">${version}</span></div><p class="wv-footer-copy">© 2026 Wikivendas — Construído com Protocolo Hidra por Paulo Leads.</p></div><div class="wv-footer-links"><a href="/glossario.json">Grafo (.JSON)</a><a href="/llms.txt">llms.txt</a><a href="/ai-consent.json">ai-consent.json</a><a href="/robots.txt">robots.txt</a><a href="/sitemap.xml">sitemap.xml</a><a href="/build-report.json">build-report.json</a></div></div></footer>`;
}

// ============================================================
// RENDER - TERMO
// ============================================================

function renderInfoGrid(data) {
  const rows = [
    ["Nome canônico", data.nomeCanonico],
    ["Sigla", data.sigla],
    ["Slug", data.slug],
    ["URN interna", data.urn],
    ["Status", data.status],
    ["Versão do termo", data.versaoTermo],
    ["Data de criação", data.dataCriacaoTermo],
    ["Data de modificação", data.dataModificacaoTermo]
  ].filter(([, value]) => value);

  if (!rows.length) return `<p class="wv-empty">Não informado.</p>`;
  return `<div class="wv-info-grid">${rows.map(([k, v]) => `<div class="wv-info-card"><div class="wv-info-key">${escapeHtml(k)}</div><div class="wv-info-value">${escapeHtml(v)}</div></div>`).join("")}</div>`;
}

function renderArtifactsGrid(data) {
  const items = [
    ["Whitepaper", data.urlWhitepaper],
    ["DataCatalog", data.dataCatalog?.url || ""],
    ["Dataset", data.urlDataset],
    ["Event", data.urlEvento],
    ["Vídeo", data.videoUrl],
    ["Wikibase item", data.wikibaseItem]
  ].filter(([, value]) => value);

  if (!items.length) return `<p class="wv-empty">Não informado.</p>`;
  return `<div class="wv-artifacts-grid">${items.map(([label, url]) => `<a class="wv-artifact-card" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer"><span class="wv-artifact-label">${escapeHtml(label)}</span><span class="wv-artifact-url">${escapeHtml(url)}</span></a>`).join("")}</div>`;
}

function renderTermPage(record) {
  const { json, term, website, org, person, termSet } = record;
  const data = extractTemplateData(record);
  const title = data.nomeCanonico || data.slug;
  const description = canonicalDescription(data.descricaoLonga || data.whitepaper?.description || "", 160);
  const canonical = data.urlPrincipalPagina || `${siteBaseUrl}/termos/${data.slug}.html`;
  const contentHash = sha256(JSON.stringify(json));
  const pageGraph = { "@context": "https://schema.org", "@graph": [website, org, person, termSet, ...json["@graph"].filter(Boolean).filter(node => ![website?.["@id"], org?.["@id"], person?.["@id"], termSet?.["@id"]].includes(node?.["@id"]))] };
  const catColor = getCategoryColor(data.categoria);

  return `<!DOCTYPE html><html lang="pt-BR"><head>${buildDesignSystemMeta({ title: `${title} — Wikivendas`, description, canonical })}<script type="application/ld+json">${JSON.stringify(pageGraph)}</script><style>
  .wv-container{max-width:860px;margin:0 auto;padding:5rem 2rem 4rem}
  .wv-back{display:inline-flex;align-items:center;gap:6px;color:var(--tm);font-size:14px;margin-bottom:2rem;transition:color .15s}
  .wv-back:hover{color:var(--tp)}
  .wv-hero{border-radius:24px;padding:2.5rem;margin-bottom:2.5rem;position:relative;overflow:hidden}
  .wv-hero-glow{position:absolute;top:-40%;right:-20%;width:300px;height:300px;border-radius:50%;filter:blur(80px);opacity:.15;pointer-events:none}
  .wv-hero-content{position:relative;z-index:1}
  .wv-term-title{font-size:clamp(34px,5vw,56px);font-weight:900;color:var(--tp);letter-spacing:-.04em;line-height:1.03;margin-bottom:.75rem}
  .wv-term-alternate{font-size:16px;color:var(--ts);margin-bottom:1.25rem;font-weight:400}
  .wv-badge-row{display:flex;flex-wrap:wrap;gap:.5rem;margin-bottom:1.25rem}
  .wv-badge{display:inline-flex;align-items:center;gap:6px;padding:5px 12px;border-radius:999px;font-size:11px;font-family:'JetBrains Mono',monospace;font-weight:500}
  .wv-badge-cat{background:rgba(56,189,248,.12);color:var(--ta);border:.5px solid rgba(56,189,248,.25)}
  .wv-badge-status{background:rgba(52,211,153,.12);color:#34d399;border:.5px solid rgba(52,211,153,.25)}
  .wv-badge-protocolo{background:rgba(129,140,248,.12);color:#818cf8;border:.5px solid rgba(129,140,248,.25)}
  .wv-badge-versao{background:rgba(251,191,36,.12);color:#fbbf24;border:.5px solid rgba(251,191,36,.25)}
  .wv-hero-desc{font-size:17px;line-height:1.75;color:var(--ts);max-width:720px}
  .wv-hero-meta{display:flex;flex-wrap:wrap;gap:.75rem;margin-top:1.5rem}
  .wv-hero-meta a,.wv-hero-meta span{display:inline-flex;align-items:center;gap:6px;padding:6px 12px;border-radius:999px;background:var(--c2);border:.5px solid var(--bd);font-size:12px;font-family:'JetBrains Mono',monospace;color:var(--ts)}
  .wv-hero-meta a{color:var(--ta)}
  .wv-proof{display:inline-flex;align-items:center;gap:8px;margin-top:1.5rem;padding:8px 16px;border-radius:999px;background:rgba(56,189,248,.06);border:.5px solid rgba(56,189,248,.15)}
  .wv-proof-icon{width:8px;height:8px;border-radius:50%;background:#34d399;animation:pulse 2s ease-in-out infinite}
  @keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
  .wv-proof-text{font-size:11px;font-family:'JetBrains Mono',monospace;color:var(--ts)}
  .wv-proof-text .hash{color:var(--ta)}
  .wv-card{background:var(--c1);border:.5px solid var(--bd);border-radius:20px;padding:1.75rem;margin-bottom:1.5rem}
  .wv-card-accent{border-left:3px solid ${catColor}}
  .wv-card h2{font-size:20px;font-weight:700;color:var(--tp);margin-bottom:1.25rem;letter-spacing:-.02em}
  .wv-card h3{font-size:14px;font-weight:700;color:var(--tp);margin-bottom:.85rem;letter-spacing:-.01em}
  .wv-body{font-size:16px;line-height:1.85;color:var(--ts)}
  .wv-body-large{font-size:18px;line-height:1.9;color:var(--tp);font-weight:400}
  .wv-dual{display:grid;grid-template-columns:1fr 1fr;gap:1rem}
  .wv-subcard{background:var(--c2);border:.5px solid var(--bd);border-radius:16px;padding:1.25rem}
  .wv-subcard-check h3{display:flex;align-items:center;gap:8px}
  .wv-subcard-check h3 .icon{width:20px;height:20px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:12px;font-weight:700}
  .wv-subcard-check.positive h3 .icon{background:rgba(52,211,153,.2);color:#34d399}
  .wv-subcard-check.negative h3 .icon{background:rgba(244,114,182,.2);color:#f472b6}
  .wv-visao-hidra{background:linear-gradient(135deg,rgba(56,189,248,.08),rgba(129,140,248,.04));border-left:3px solid var(--ta);border-radius:20px;padding:1.75rem;margin-bottom:1.5rem}
  .wv-visao-hidra h2{display:flex;align-items:center;gap:8px}
  .wv-visao-hidra h2 .tag{font-size:10px;padding:2px 8px;border-radius:999px;background:rgba(56,189,248,.15);color:var(--ta);font-family:'JetBrains Mono',monospace;font-weight:400}
  .wv-visao-grid{display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-top:1rem}
  .wv-visao-item{background:var(--c2);border:.5px solid var(--bd);border-radius:12px;padding:.85rem 1rem}
  .wv-visao-item .k{font-size:10px;text-transform:uppercase;font-family:'JetBrains Mono',monospace;color:var(--tm);letter-spacing:.06em}
  .wv-visao-item .v{font-size:13px;color:var(--tp);margin-top:4px}
  .wv-btns{display:flex;flex-wrap:wrap;gap:.75rem;margin-top:1rem}
  .wv-btn{display:inline-flex;align-items:center;gap:6px;padding:10px 20px;border-radius:999px;font-size:13px;font-weight:600;font-family:'Inter',sans-serif;transition:all .15s;border:none;cursor:pointer}
  .wv-btn-msft{background:#0078d4;color:#fff}
  .wv-btn-msft:hover{background:#106ebe;transform:translateY(-1px)}
  .wv-btn-google{background:#4285f4;color:#fff}
  .wv-btn-google:hover{background:#3367d6;transform:translateY(-1px)}
  .wv-btn-aws{background:#ff9900;color:#000}
  .wv-btn-aws:hover{background:#e88b00;transform:translateY(-1px)}
  .wv-links-grid{display:grid;grid-template-columns:1fr 1fr;gap:1rem}
  .wv-link-card{display:flex;flex-direction:column;gap:.35rem;background:var(--c2);border:.5px solid var(--bd);border-radius:14px;padding:1rem}
  .wv-link-card .k{font-size:10px;text-transform:uppercase;font-family:'JetBrains Mono',monospace;color:var(--tm);letter-spacing:.06em}
  .wv-link-card .v{font-size:13px;color:var(--ts);word-break:break-word}
  .wv-link-card .v a{color:var(--ta)}
  .wv-artifacts-grid{display:grid;grid-template-columns:1fr 1fr;gap:1rem}
  .wv-artifact-card{display:flex;flex-direction:column;gap:.35rem;background:var(--c2);border:.5px solid var(--bd);border-radius:14px;padding:1rem;transition:background .15s,border-color .15s;cursor:pointer}
  .wv-artifact-card:hover{background:var(--c3);border-color:rgba(56,189,248,.24)}
  .wv-artifact-label{font-size:10px;text-transform:uppercase;font-family:'JetBrains Mono',monospace;color:var(--tm);letter-spacing:.06em}
  .wv-artifact-url{font-size:12px;color:var(--ta);word-break:break-word}
  .wv-cta-box{background:linear-gradient(135deg,rgba(56,189,248,.1),rgba(129,140,248,.05));border:1px solid rgba(56,189,248,.2);border-radius:20px;padding:2rem;text-align:center;margin-top:2.5rem}
  .wv-cta-box h2{font-size:22px;font-weight:800;color:var(--tp);margin-bottom:.75rem}
  .wv-cta-box p{font-size:15px;color:var(--ts);max-width:520px;margin:0 auto 1.5rem;line-height:1.6}
  .wv-cta-btn{display:inline-flex;align-items:center;gap:8px;padding:14px 32px;background:var(--ta);color:#030712;border-radius:999px;font-size:15px;font-weight:700;transition:all .15s;border:none;cursor:pointer}
  .wv-cta-btn:hover{background:#7dd3fc;transform:translateY(-2px)}
  .wv-cta-btn-secondary{display:inline-flex;align-items:center;gap:8px;padding:14px 32px;background:transparent;color:var(--ts);border:.5px solid var(--bds);border-radius:999px;font-size:15px;font-weight:500;transition:all .15s;margin-left:.75rem}
  .wv-cta-btn-secondary:hover{background:var(--c2);color:var(--tp)}
  .wv-inline-pills{display:flex;flex-wrap:wrap;gap:.5rem}
  .wv-inline-pills .pill{font-size:11px;padding:5px 10px;border-radius:999px;background:rgba(56,189,248,.08);color:var(--ta);border:.5px solid rgba(56,189,248,.2);font-family:'JetBrains Mono',monospace}
  .wv-info-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1rem}
  .wv-info-card{background:var(--c2);border:.5px solid var(--bd);border-radius:14px;padding:1rem}
  .wv-info-key{font-size:10px;font-family:'JetBrains Mono',monospace;text-transform:uppercase;letter-spacing:.06em;color:var(--tm);margin-bottom:.35rem}
  .wv-info-value{font-size:14px;color:var(--tp);line-height:1.5;word-break:break-word}
  .wv-json-toggle{background:var(--c2);border:.5px solid var(--bd);border-radius:14px;overflow:hidden;margin-top:2rem}
  .wv-json-toggle summary{padding:1rem 1.25rem;cursor:pointer;font-size:13px;font-weight:600;color:var(--ts);font-family:'Inter',sans-serif;display:flex;align-items:center;justify-content:space-between}
  .wv-json-toggle summary::after{content:'▾';font-size:12px;transition:transform .2s}
  .wv-json-toggle[open] summary::after{transform:rotate(180deg)}
  .wv-json-toggle .wv-json{padding:0 1.25rem 1.25rem;font-family:'JetBrains Mono',monospace;font-size:12px;line-height:1.7;color:#dbeafe;background:#020617;border-radius:12px;white-space:pre-wrap;word-break:break-word;max-height:480px;overflow:auto}
  .wv-empty{color:var(--tm);font-size:14px;font-style:italic}
  .wv-bullets{list-style:none;display:flex;flex-direction:column;gap:.7rem}
  .wv-bullets li{position:relative;padding-left:1rem;color:var(--ts);font-size:14px;line-height:1.6}
  .wv-bullets li::before{content:'';position:absolute;left:0;top:.6rem;width:6px;height:6px;border-radius:999px;background:var(--ta)}
  @media(max-width:768px){.wv-container{padding:4rem 1.25rem 3rem}.wv-dual,.wv-visao-grid,.wv-links-grid,.wv-artifacts-grid,.wv-info-grid{grid-template-columns:1fr}.wv-hero{padding:1.75rem}.wv-cta-btn-secondary{margin-left:0;margin-top:.75rem}}
  </style></head><body>${renderSiteHeader()}<main class="wv-container"><a href="/glossario/" class="wv-back">← Voltar ao glossário</a><section class="wv-hero" style="background:linear-gradient(135deg,${catColor}15,${catColor}05,var(--c1));border:1px solid ${catColor}25"><div class="wv-hero-glow" style="background:${catColor}"></div><div class="wv-hero-content"><div class="wv-badge-row"><span class="wv-badge wv-badge-cat">${escapeHtml(data.categoria)}</span>${data.status ? `<span class="wv-badge wv-badge-status">${escapeHtml(data.status)}</span>` : ''}${data.versaoTermo ? `<span class="wv-badge wv-badge-versao">v${escapeHtml(data.versaoTermo)}</span>` : ''}<span class="wv-badge wv-badge-protocolo">${escapeHtml(data.pertenceAoProtocolo)}</span></div><h1 class="wv-term-title">${escapeHtml(title)}</h1>${data.alternateNames.length ? `<p class="wv-term-alternate">${escapeHtml(data.alternateNames.join(" · "))}</p>` : ''}<p class="wv-hero-desc">${escapeHtml(data.descricaoCurta || description)}</p><div class="wv-hero-meta">${data.urn ? `<span>URN <code>${escapeHtml(data.urn)}</code></span>` : ''}${data.doi ? `<a href="${escapeHtml(data.doi)}" target="_blank" rel="noopener noreferrer">DOI</a>` : ''}${data.wikisales ? `<a href="${escapeHtml(data.wikisales)}" target="_blank" rel="noopener noreferrer">Wikisales</a>` : ''}${data.urlDataset ? `<a href="${escapeHtml(data.urlDataset)}" target="_blank" rel="noopener noreferrer">Dataset</a>` : ''}${data.urlEvento ? `<a href="${escapeHtml(data.urlEvento)}" target="_blank" rel="noopener noreferrer">Evento</a>` : ''}</div><div class="wv-proof"><span class="wv-proof-icon"></span><span class="wv-proof-text">Verificado · SHA256 <span class="hash">${contentHash.substring(0,16)}</span> · ${BUILD_TIMESTAMP.split('T')[0]}</span></div></div></section><article class="wv-card wv-card-accent"><h2>Definição canônica</h2><p class="wv-body-large">${escapeHtml(data.descricaoLonga || data.descricaoCurta || 'Definição em desenvolvimento.')}</p>${data.alternateNames.length ? `<div style="margin-top:1rem"><h3>Também conhecido como</h3><div class="wv-inline-pills">${data.alternateNames.map(v => `<span class="pill">${escapeHtml(v)}</span>`).join('')}</div></div>` : ''}</article><article class="wv-card"><h2>Fronteira conceitual</h2><div class="wv-dual"><div class="wv-subcard wv-subcard-check positive"><h3><span class="icon">✓</span> O que é</h3>${renderList(data.oQueE)}</div><div class="wv-subcard wv-subcard-check negative"><h3><span class="icon">✗</span> O que não é</h3>${renderList(data.oQueNaoE)}</div></div></article>${data.descricaoServico ? `<section class="wv-visao-hidra" id="visao-hidra"><h2>Visão Hidra <span class="tag">Serviço</span></h2><p class="wv-body" style="margin-bottom:1rem">${escapeHtml(data.descricaoServico)}</p><div class="wv-visao-grid"><div class="wv-visao-item"><div class="k">Serviço</div><div class="v">${escapeHtml(data.nomeServico)}</div></div><div class="wv-visao-item"><div class="k">Público</div><div class="v">${escapeHtml(data.publico || 'Operações B2B')}</div></div><div class="wv-visao-item"><div class="k">Área</div><div class="v">${escapeHtml(data.areaAtendida || 'Brasil')}</div></div><div class="wv-visao-item"><div class="k">Protocolo</div><div class="v">${escapeHtml(data.pertenceAoProtocolo)}</div></div></div><div class="wv-btns"><a href="https://pauloleads.com.br" target="_blank" rel="noopener noreferrer" class="wv-btn" style="background:var(--ta);color:#030712">Solicitar diagnóstico →</a></div></section>` : ''}${(data.fontesTecnicas.length || data.doi || data.urlWhitepaper || data.urlDataset || data.urlEvento) ? `<article class="wv-card"><h2>Lastro técnico</h2>${data.fontesTecnicas.length ? `<div style="margin-bottom:1.25rem"><h3>Fontes técnicas</h3>${renderLinkList(data.fontesTecnicas)}</div>` : ''}<div class="wv-links-grid">${data.doi ? `<div class="wv-link-card"><span class="k">DOI</span><span class="v"><a href="${escapeHtml(data.doi)}" target="_blank" rel="noopener noreferrer">${escapeHtml(data.doi.replace('https://doi.org/',''))}</a></span></div>` : ''}${data.urlWhitepaper ? `<div class="wv-link-card"><span class="k">Whitepaper</span><span class="v"><a href="${escapeHtml(data.urlWhitepaper)}" target="_blank" rel="noopener noreferrer">Acessar →</a></span></div>` : ''}${data.urlDataset ? `<div class="wv-link-card"><span class="k">Dataset</span><span class="v"><a href="${escapeHtml(data.urlDataset)}" target="_blank" rel="noopener noreferrer">Acessar →</a></span></div>` : ''}${data.urlEvento ? `<div class="wv-link-card"><span class="k">Evento</span><span class="v"><a href="${escapeHtml(data.urlEvento)}" target="_blank" rel="noopener noreferrer">Acessar →</a></span></div>` : ''}</div></article>` : ''}${data.mitigacoes.length ? `<article class="wv-card"><h2>Mitigação</h2>${renderList(data.mitigacoes)}</article>` : ''}${data.perguntas.length ? `<article class="wv-card"><h2>Perguntas relevantes</h2>${renderList(data.perguntas)}</article>` : ''}${(data.criador || data.projeto || data.contexto || data.primeiraPublicacao) ? `<article class="wv-card"><h2>Proveniência</h2><div class="wv-links-grid">${data.criador ? `<div class="wv-link-card"><span class="k">Criador</span><span class="v">${escapeHtml(data.criador)}</span></div>` : ''}${data.projeto ? `<div class="wv-link-card"><span class="k">Projeto</span><span class="v">${escapeHtml(data.projeto)}</span></div>` : ''}${data.contexto ? `<div class="wv-link-card"><span class="k">Contexto</span><span class="v">${escapeHtml(data.contexto)}</span></div>` : ''}${data.primeiraPublicacao ? `<div class="wv-link-card"><span class="k">Primeira publicação</span><span class="v">${escapeHtml(data.primeiraPublicacao)}</span></div>` : ''}</div></article>` : ''}${data.urlWhitepaper || data.urlDataset || data.urlEvento || data.videoUrl ? `<article class="wv-card"><h2>Artefatos</h2><div class="wv-artifacts-grid">${data.urlWhitepaper ? `<a class="wv-artifact-card" href="${escapeHtml(data.urlWhitepaper)}" target="_blank" rel="noopener noreferrer"><span class="wv-artifact-label">Whitepaper</span><span class="wv-artifact-url">${escapeHtml(data.urlWhitepaper)}</span></a>` : ''}${data.urlDataset ? `<a class="wv-artifact-card" href="${escapeHtml(data.urlDataset)}" target="_blank" rel="noopener noreferrer"><span class="wv-artifact-label">Dataset</span><span class="wv-artifact-url">${escapeHtml(data.urlDataset)}</span></a>` : ''}${data.urlEvento ? `<a class="wv-artifact-card" href="${escapeHtml(data.urlEvento)}" target="_blank" rel="noopener noreferrer"><span class="wv-artifact-label">Evento</span><span class="wv-artifact-url">${escapeHtml(data.urlEvento)}</span></a>` : ''}${data.videoUrl ? `<a class="wv-artifact-card" href="${escapeHtml(data.videoUrl)}" target="_blank" rel="noopener noreferrer"><span class="wv-artifact-label">Vídeo</span><span class="wv-artifact-url">${escapeHtml(data.videoUrl)}</span></a>` : ''}</div></article>` : ''}<section class="wv-cta-box"><h2>Quer aplicar este conceito na sua operação?</h2><p>Cada termo da Wikivendas tem uma camada de serviço correspondente. Solicite um diagnóstico gratuito e descubra como estruturar sua inteligência comercial B2B.</p><div><a href="https://pauloleads.com.br" target="_blank" rel="noopener noreferrer" class="wv-cta-btn">Solicitar diagnóstico →</a><a href="/glossario/" class="wv-cta-btn-secondary">Explorar mais termos</a></div></section><details class="wv-json-toggle"><summary>JSON-LD canônico</summary><div class="wv-json">${escapeHtml(JSON.stringify(json, null, 2))}</div></details></main>${renderSiteFooter()}</body></html>`;
}

// ============================================================
// RENDER - GLOSSÁRIO / CATEGORIA
// ============================================================

function renderTermListRow(record) {
  const data = extractTemplateData(record);
  return `<a href="/termos/${data.slug}.html" class="wv-termo-item"><span class="wv-termo-item-nome">${escapeHtml(data.nomeCanonico || '')}</span><span class="wv-termo-item-def">${escapeHtml(canonicalDescription(data.descricaoLonga || '', 100))}</span></a>`;
}

function renderGlossaryPage(records, termSet, website, org, person) {
  const categories = [...new Set(records.map(r => getCategoryFromTerm(r.term)))].sort((a,b)=>a.localeCompare(b,'pt-BR'));
  const groups = categories.map(cat => {
    const terms = records.filter(r => getCategoryFromTerm(r.term) === cat);
    return `<section class="wv-cat-section glossary-group" data-search="${escapeHtml([cat,...terms.map(t=>t.term.name)].join(' ').toLowerCase())}"><div class="wv-cat-titulo"><span class="wv-cat-dot" style="background:${getCategoryColor(cat)}"></span><a href="/glossario/${slugify(cat)}/" style="color:var(--tp)">${escapeHtml(cat)}</a><span class="wv-cat-count">${terms.length} termos</span></div><div class="wv-cat-desc">${escapeHtml(getCatDesc(cat))}</div><div class="wv-termo-list">${terms.slice(0,50).map(renderTermListRow).join('')}</div></section>`;
  }).join('');
  const pageGraph = { "@context":"https://schema.org", "@graph":[website, org, person, termSet].filter(Boolean) };
  return `<!DOCTYPE html><html lang="pt-BR"><head>${buildDesignSystemMeta({ title:'Glossário Wikivendas', description:'Glossário geral da Wikivendas com todas as categorias e verbetes indexáveis.', canonical:`${siteBaseUrl}/glossario/` })}<script type="application/ld+json">${JSON.stringify(pageGraph)}</script><style>.wv-glossario{max-width:1100px;margin:0 auto;padding:5rem 2rem 4rem}.wv-headline{font-size:clamp(34px,5vw,58px);font-weight:900;line-height:1.02;letter-spacing:-.04em;color:var(--tp);margin-bottom:1.5rem}.wv-lead{font-size:17px;color:var(--ts);max-width:760px;line-height:1.7;margin-bottom:2rem}.wv-search{width:100%;padding:14px 16px;background:var(--c1);color:var(--tp);border:.5px solid var(--bds);border-radius:var(--r);font-size:15px;margin-bottom:3rem}.wv-cat-section{margin-bottom:3rem}.wv-cat-titulo{display:flex;align-items:center;gap:10px;font-size:18px;font-weight:700;color:var(--tp);margin-bottom:.5rem}.wv-cat-dot{width:10px;height:10px;border-radius:50%;flex-shrink:0}.wv-cat-count{font-size:12px;font-family:'JetBrains Mono',monospace;color:var(--tm);font-weight:400;margin-left:4px}.wv-cat-desc{font-size:13px;color:var(--tm);margin-bottom:1rem;max-width:600px}.wv-termo-list{display:flex;flex-direction:column;border:.5px solid var(--bd);border-radius:var(--r);overflow:hidden}.wv-termo-item{display:grid;grid-template-columns:1fr 1fr;gap:1rem;padding:.9rem 1.25rem;background:var(--c1);border-bottom:.5px solid var(--bd);transition:background .15s}.wv-termo-item:last-child{border-bottom:none}.wv-termo-item:hover{background:var(--c2)}.wv-termo-item-nome{font-size:14px;font-weight:600;color:var(--tp)}.wv-termo-item-def{font-size:12px;color:var(--tm);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}@media(max-width:768px){.wv-glossario{padding:4rem 1.25rem 3rem}.wv-termo-item{grid-template-columns:1fr}.wv-termo-item-def{display:none}}</style></head><body>${renderSiteHeader()}<section class="wv-glossario"><p class="wv-section-label">Índice canônico terminológico</p><h1 class="wv-headline">Glossário da Wikivendas</h1><p class="wv-lead">Página real e indexável com todas as categorias e verbetes da ontologia Wikivendas. Cada termo aponta para seu HTML individual e para seu JSON-LD correspondente.</p><input id="wv-glossary-search" class="wv-search" type="search" placeholder="Buscar termo ou categoria">${groups || '<p class="wv-lead">Nenhum termo válido publicado ainda.</p>'}</section>${renderSiteFooter()}<script>const q=document.getElementById('wv-glossary-search');const groups=[...document.querySelectorAll('.glossary-group')];if(q){q.addEventListener('input',()=>{const s=q.value.toLowerCase().trim();groups.forEach(sec=>{const t=sec.dataset.search;sec.style.display=!s||t.includes(s)?'':'none';});});}</script></body></html>`;
}

function renderCategoryPage(category, records, categories, termSet, website, org, person) {
  const slug = slugify(category);
  const list = records.map(renderTermListRow).join('');
  const categoryLinks = categories.map(c => `<a href="/glossario/${slugify(c)}/" class="wv-filter-link ${c === category ? 'active' : ''}">${escapeHtml(c)}</a>`).join('');
  const pageGraph = { "@context":"https://schema.org", "@graph":[website, org, person, termSet, {"@type":"CollectionPage","@id":`${siteBaseUrl}/glossario/${slug}/#page`,name:`${category} — Glossário Wikivendas`,url:`${siteBaseUrl}/glossario/${slug}/`,about:{"@type":"Thing",name:category,description:getCatDesc(category)}}] };
  return `<!DOCTYPE html><html lang="pt-BR"><head>${buildDesignSystemMeta({ title:`${category} — Glossário Wikivendas`, description:getCatDesc(category), canonical:`${siteBaseUrl}/glossario/${slug}/` })}<script type="application/ld+json">${JSON.stringify(pageGraph)}</script><style>.wv-category-page{max-width:1100px;margin:0 auto;padding:5rem 2rem 4rem}.wv-headline{font-size:clamp(34px,5vw,58px);font-weight:900;line-height:1.02;letter-spacing:-.04em;color:var(--tp);margin-bottom:1rem}.wv-lead{font-size:16px;color:var(--ts);max-width:760px;line-height:1.7;margin-bottom:2rem}.wv-filter-wrap{display:flex;gap:.75rem;flex-wrap:wrap;margin-bottom:2rem}.wv-filter-link{display:inline-flex;align-items:center;padding:8px 12px;border-radius:999px;border:.5px solid var(--bds);color:var(--tm);font-size:12px;font-family:'JetBrains Mono',monospace;background:transparent;transition:background .15s,color .15s,border-color .15s}.wv-filter-link:hover{color:var(--tp);background:var(--c2)}.wv-filter-link.active{color:var(--ta);border-color:rgba(56,189,248,.3);background:rgba(56,189,248,.08)}.wv-termo-list{display:flex;flex-direction:column;border:.5px solid var(--bd);border-radius:var(--r);overflow:hidden}.wv-termo-item{display:grid;grid-template-columns:1fr 1fr;gap:1rem;padding:.9rem 1.25rem;background:var(--c1);border-bottom:.5px solid var(--bd);transition:background .15s}.wv-termo-item:last-child{border-bottom:none}.wv-termo-item:hover{background:var(--c2)}.wv-termo-item-nome{font-size:14px;font-weight:600;color:var(--tp)}.wv-termo-item-def{font-size:12px;color:var(--tm);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}@media(max-width:768px){.wv-category-page{padding:4rem 1.25rem 3rem}.wv-termo-item{grid-template-columns:1fr}.wv-termo-item-def{display:none}}</style></head><body>${renderSiteHeader()}<section class="wv-category-page"><p class="wv-section-label">Categoria</p><h1 class="wv-headline">${escapeHtml(category)}</h1><p class="wv-lead">${escapeHtml(getCatDesc(category))}</p><div class="wv-filter-wrap"><a href="/glossario/" class="wv-filter-link">Todos</a>${categoryLinks}</div><div class="wv-termo-list">${list}</div></section>${renderSiteFooter()}</body></html>`;
}

// ============================================================
// RENDER - HOME / SOBRE
// ============================================================

function renderHomePage(records, termSet, website, org, person) {
  const cardsHtml = records.slice(0, 6).map((r, i) => {
    const data = extractTemplateData(r);
    const catColor = getCategoryColor(data.categoria);
    return `<div class="wv-card" onclick="window.location.href='/termos/${data.slug}.html'"><div class="wv-card-corner" style="background:${catColor}"></div><div class="wv-card-index">${String(i + 1).padStart(3, '0')}</div><div class="wv-card-name">${escapeHtml(data.nomeCanonico || '')}</div><div class="wv-card-def">${escapeHtml(canonicalDescription(data.descricaoLonga || '', 100))}</div><div class="wv-card-footer"><span class="wv-pill" style="border-color:${catColor}40;color:${catColor}">${escapeHtml(data.categoria)}</span><span class="wv-card-arrow">→</span></div></div>`;
  }).join('');

  const pageGraph = { "@context":"https://schema.org", "@graph":[website, org, person, termSet].filter(Boolean) };

  return `<!DOCTYPE html><html lang="pt-BR"><head>${buildDesignSystemMeta({ title:'Wikivendas — A Fonte de Verdade que a IA Consulta', description:'Primeira enciclopédia brasileira de vendas B2B, RevOps imobiliário e inteligência comercial. Definições canônicas com URN, DOI, validação cruzada e registro estruturado.', canonical:`${siteBaseUrl}/` })}<script type="application/ld+json">${JSON.stringify(pageGraph)}</script><style>
  .wv-hero{max-width:1100px;margin:0 auto;padding:6rem 2rem 4rem;position:relative}
  .wv-hero-glow{position:absolute;top:-30%;right:-10%;width:500px;height:500px;border-radius:50%;background:radial-gradient(circle,rgba(56,189,248,.08),transparent 70%);pointer-events:none}
  .wv-eyebrow{display:inline-flex;align-items:center;gap:8px;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--ta);margin-bottom:2rem;font-family:'JetBrains Mono',monospace;position:relative}
  .wv-eyebrow:before{content:'';display:inline-block;width:6px;height:6px;background:var(--ta);border-radius:50%;animation:pulse 2s ease-in-out infinite}
  @keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
  .wv-slogan{font-size:clamp(44px,7vw,88px);font-weight:900;line-height:1;letter-spacing:-.04em;color:var(--tp);margin-bottom:2rem;max-width:880px;position:relative}
  .wv-slogan em{font-style:normal;background:linear-gradient(135deg,#38bdf8 0,#818cf8 50%,#f472b6 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
  .wv-slogan-sub{display:block;font-size:clamp(18px,2vw,24px);font-weight:400;color:var(--ts);margin-top:.75rem;letter-spacing:-.01em;-webkit-text-fill-color:var(--ts)}
  .wv-hero-body{font-size:18px;line-height:1.7;color:var(--ts);max-width:600px;margin-bottom:1.5rem;position:relative}
  .wv-hero-stats{display:flex;gap:2.5rem;margin-bottom:2.5rem;position:relative}
  .wv-stat{display:flex;flex-direction:column}
  .wv-stat-num{font-size:32px;font-weight:900;color:var(--tp);letter-spacing:-.03em;line-height:1}
  .wv-stat-label{font-size:12px;color:var(--tm);font-family:'JetBrains Mono',monospace;margin-top:4px}
  .wv-hero-actions{display:flex;gap:1rem;flex-wrap:wrap;position:relative}
  .wv-section{max-width:1100px;margin:0 auto;padding:4rem 2rem}
  .wv-section-label{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--ta);margin-bottom:1.5rem;font-family:'JetBrains Mono',monospace}
  .wv-headline{font-size:clamp(28px,4vw,44px);font-weight:800;letter-spacing:-.03em;color:var(--tp);line-height:1.15;margin-bottom:1.25rem}
  .wv-headline-center{text-align:center;max-width:700px;margin:0 auto 1.25rem}
  .wv-body{font-size:16px;color:var(--ts);max-width:600px;line-height:1.7;margin-bottom:2.5rem}
  .wv-body-center{text-align:center;margin:0 auto 2.5rem}
  .wv-value-grid{display:grid;grid-template-columns:1fr 1fr;gap:0;border:.5px solid var(--bd);border-radius:var(--r);overflow:hidden}
  .wv-value-col{padding:2.5rem}
  .wv-value-tag{font-size:11px;letter-spacing:.1em;text-transform:uppercase;font-family:'JetBrains Mono',monospace;margin-bottom:1rem;padding:4px 10px;border-radius:20px;display:inline-block}
  .wv-value-tag.human{color:#34d399;background:rgba(52,211,153,.1);border:.5px solid rgba(52,211,153,.2)}
  .wv-value-tag.ai{color:#818cf8;background:rgba(129,140,248,.1);border:.5px solid rgba(129,140,248,.2)}
  .wv-value-title{font-size:20px;font-weight:700;color:var(--tp);margin-bottom:.75rem;line-height:1.3}
  .wv-value-desc{font-size:14px;color:var(--ts);line-height:1.6}
  .wv-cards-header{display:flex;align-items:flex-end;justify-content:space-between;margin-bottom:2rem;flex-wrap:wrap;gap:1rem}
  .wv-cards-headline{font-size:28px;font-weight:800;color:var(--tp);letter-spacing:-.02em}
  .wv-cards-link{font-size:13px;color:var(--ta);font-family:'Inter',sans-serif}
  .wv-cards-link:hover{color:#7dd3fc}
  .wv-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:1.25rem}
  .wv-card{background:var(--c1);border:.5px solid var(--bd);border-radius:16px;padding:1.5rem;cursor:pointer;transition:all .2s;display:flex;flex-direction:column;gap:.75rem;position:relative;overflow:hidden}
  .wv-card:hover{border-color:rgba(56,189,248,.3);background:var(--c2);transform:translateY(-2px)}
  .wv-card-corner{position:absolute;top:0;left:0;width:4px;height:100%}
  .wv-card-index{font-size:11px;font-family:'JetBrains Mono',monospace;color:var(--tm)}
  .wv-card-name{font-size:17px;font-weight:700;color:var(--tp);line-height:1.3}
  .wv-card-def{font-size:13px;color:var(--ts);line-height:1.5;flex:1;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
  .wv-card-footer{display:flex;align-items:center;justify-content:space-between;margin-top:.25rem}
  .wv-card-arrow{font-size:16px;color:var(--tm);transition:transform .2s,color .2s}
  .wv-card:hover .wv-card-arrow{transform:translateX(4px);color:var(--ta)}
  .wv-pitch{text-align:center;padding:4rem 2rem;max-width:1100px;margin:0 auto;border-top:.5px solid var(--bd);position:relative}
  .wv-pitch-glow{position:absolute;top:-50%;left:50%;transform:translateX(-50%);width:600px;height:600px;border-radius:50%;background:radial-gradient(circle,rgba(56,189,248,.04),transparent 70%);pointer-events:none}
  .wv-pitch-content{position:relative;z-index:1}
  .wv-pitch-badge{display:inline-flex;align-items:center;gap:6px;padding:6px 14px;border-radius:999px;background:rgba(56,189,248,.1);border:.5px solid rgba(56,189,248,.2);font-size:11px;font-family:'JetBrains Mono',monospace;color:var(--ta);margin-bottom:1.5rem}
  .wv-pitch h2{font-size:clamp(28px,4vw,40px);font-weight:800;color:var(--tp);letter-spacing:-.03em;line-height:1.1;margin-bottom:1rem;max-width:700px;margin-left:auto;margin-right:auto}
  .wv-pitch p{font-size:16px;color:var(--ts);max-width:560px;margin:0 auto 2rem;line-height:1.7}
  .wv-pitch-actions{display:flex;gap:1rem;flex-wrap:wrap;justify-content:center}
  .wv-services{display:grid;grid-template-columns:repeat(3,1fr);gap:1.25rem;margin-top:2.5rem;text-align:left}
  .wv-service-card{background:var(--c1);border:.5px solid var(--bd);border-radius:16px;padding:1.5rem;transition:all .2s}
  .wv-service-card:hover{border-color:rgba(56,189,248,.2);background:var(--c2)}
  .wv-service-icon{font-size:24px;margin-bottom:.75rem}
  .wv-service-title{font-size:15px;font-weight:700;color:var(--tp);margin-bottom:.5rem}
  .wv-service-desc{font-size:13px;color:var(--ts);line-height:1.5}
  @media(max-width:768px){.wv-hero{padding:4rem 1.25rem 3rem}.wv-hero-stats{gap:1.5rem}.wv-stat-num{font-size:24px}.wv-value-grid{grid-template-columns:1fr}.wv-value-col{padding:1.5rem}.wv-grid{grid-template-columns:1fr 1fr}.wv-services{grid-template-columns:1fr}}
  </style></head><body>${renderSiteHeader()}<main><section class="wv-hero"><div class="wv-hero-glow"></div><div class="wv-eyebrow">Ontological SEO · Forensic GEO</div><h1 class="wv-slogan">A fonte de verdade que a <em>IA</em> consulta.<span class="wv-slogan-sub">Enciclopédia brasileira de vendas B2B, RevOps e inteligência comercial.</span></h1><p class="wv-hero-body">Cada verbete possui URN, DOI, validação cruzada Microsoft/Google/AWS e registro na Wikisales. Construído para ser lido por humanos e citado por modelos de linguagem como fonte canônica.</p><div class="wv-hero-stats"><div class="wv-stat"><span class="wv-stat-num">${records.length}</span><span class="wv-stat-label">termos publicados</span></div><div class="wv-stat"><span class="wv-stat-num">${[...new Set(records.map(r => getCategoryFromTerm(r.term)))].length}</span><span class="wv-stat-label">categorias</span></div><div class="wv-stat"><span class="wv-stat-num">100%</span><span class="wv-stat-label">rastreável</span></div></div><div class="wv-hero-actions"><a href="/glossario/" class="wv-btn-primary">Explorar Glossário</a><a href="/sobre/" class="wv-btn-ghost">Sobre o Projeto</a><a href="https://pauloleads.com.br" target="_blank" rel="noopener noreferrer" class="wv-btn-ghost" style="border-color:rgba(56,189,248,.3);color:var(--ta)">Solicitar diagnóstico →</a></div></section><section class="wv-section"><p class="wv-section-label">Arquitetura</p><h2 class="wv-headline">Por dentro da ontologia</h2><p class="wv-body">Cada termo combine definição editorial com dados estruturados — uma base que serve tanto à leitura humana quanto ao consumo por IA.</p><div class="wv-value-grid"><div class="wv-value-col" style="background:var(--c1);border-right:.5px solid var(--bd)"><div class="wv-value-tag human">Para humanos</div><div class="wv-value-title">Definição canônica e contexto</div><div class="wv-value-desc">Redação clara, exemplos reais do mercado B2B brasileiro, referências cruzadas e contexto semântico consistente. Cada termo é um artigo completo.</div></div><div class="wv-value-col" style="background:var(--c1)"><div class="wv-value-tag ai">Para máquinas</div><div class="wv-value-title">JSON-LD, Schema.org e GEO</div><div class="wv-value-desc">Dados estruturados que LLMs consomem diretamente: DefinedTerm, Service, CreativeWork, Dataset, Event. Ontological SEO e Forensic GEO integrados.</div></div></div></section><section class="wv-section"><div class="wv-cards-header"><h2 class="wv-cards-headline">Verbetes em destaque</h2><a href="/glossario/" class="wv-cards-link">Glossário completo →</a></div><div class="wv-grid">${cardsHtml || '<p style="color:var(--tm)">Nenhum termo válido publicado ainda.</p>'}</div></section><section class="wv-pitch"><div class="wv-pitch-glow"></div><div class="wv-pitch-content"><div class="wv-pitch-badge">🧠 Inteligência comercial aplicada</div><h2>Todo conceito vira solução na sua operação</h2><p>A Wikivendas não é só enciclopédia. Cada termo tem uma camada de serviço correspondente — diagnósticos, frameworks e infraestrutura comercial baseados no Protocolo Hidra.</p><div class="wv-services"><div class="wv-service-card"><div class="wv-service-icon">🔍</div><div class="wv-service-title">Diagnóstico de maturidade</div><div class="wv-service-desc">Mapeamos onde sua operação está e o que precisa ser estruturado para eliminar desperdício comercial.</div></div><div class="wv-service-card"><div class="wv-service-icon">⚙️</div><div class="wv-service-title">Infraestrutura comercial com IA</div><div class="wv-service-desc">Aplicamos os conceitos da ontologia para blindar endpoints, qualificar leads e governar dados B2B.</div></div><div class="wv-service-card"><div class="wv-service-icon">📊</div><div class="wv-service-title">Governança ontológica</div><div class="wv-service-desc">Estruturamos seu vocabulário de vendas com URNs, DOIs e validação cruzada para IA citar você.</div></div></div><div class="wv-pitch-actions" style="margin-top:2.5rem"><a href="https://pauloleads.com.br" target="_blank" rel="noopener noreferrer" class="wv-btn-primary">Solicitar diagnóstico gratuito</a><a href="/glossario/" class="wv-btn-ghost">Explorar termos primeiro</a></div></div></section></main>${renderSiteFooter()}</body></html>`;
}
function renderAboutPage(website, org, person) {
  const pageGraph = { "@context":"https://schema.org", "@graph":[website, org, person].filter(Boolean) };
  return `<!DOCTYPE html><html lang="pt-BR"><head>${buildDesignSystemMeta({ title:'Sobre — Wikivendas', description:'Conheça a Wikivendas, a primeira enciclopédia brasileira de vendas B2B e RevOps imobiliário.', canonical:`${siteBaseUrl}/sobre/` })}<script type="application/ld+json">${JSON.stringify(pageGraph)}</script><style>.wv-sobre{max-width:760px;margin:0 auto;padding:5rem 2rem 4rem}.wv-sobre h1{font-size:clamp(34px,5vw,48px);font-weight:900;line-height:1.05;letter-spacing:-.03em;color:var(--tp);margin-bottom:1.5rem}.wv-sobre h2{font-size:22px;font-weight:700;color:var(--tp);margin-top:2.5rem;margin-bottom:.75rem}.wv-sobre p,.wv-sobre li{font-size:16px;line-height:1.7;color:var(--ts);margin-bottom:1rem}.wv-sobre ul{padding-left:1.5rem}.wv-sobre strong{color:var(--tp)}</style></head><body>${renderSiteHeader()}<section class="wv-sobre"><p class="wv-section-label">Sobre</p><h1>Wikivendas, fonte de verdade para IA comercial</h1><p><strong>Wikivendas</strong> é uma enciclopédia dedicada a termos técnicos de vendas B2B, RevOps imobiliário e inteligência comercial. Cada verbete é uma definição canônica pensada para humanos e para modelos de linguagem.</p><h2>Arquitetura JSON-first</h2><p>O conteúdo nasce como JSON-LD canônico. O HTML é apenas a camada de visualização, gerada a partir do grafo estruturado de cada termo.</p><h2>Template mestre</h2><p>As páginas dos termos seguem o Template Mestre — Termo Canônico Wikivendas, com identidade, definição editorial, fronteira conceitual, Visão Hidra, lastro técnico, mitigação, perguntas, proveniência, artefatos e JSON canônico.</p><h2>Protocolo Hidra</h2><p>O Protocolo Hidra atua como camada de amarração semântica entre problema, diagnóstico, evidência, mitigação e solução, preservando coerência para leitura humana e consumo por IA.</p><p style="margin-top:2rem;text-align:center"><a href="https://pauloleads.com.br" target="_blank" rel="noopener noreferrer" class="wv-btn-primary" style="display:inline-flex">Solicitar diagnóstico gratuito</a></p></section>${renderSiteFooter()}</body></html>`;
}
// ============================================================
// INFRAESTRUTURA
// ============================================================

function renderSitemap(records, categories) {
  const termLines = records.map(r => {
    const data = extractTemplateData(r);
    return `<url><loc>${siteBaseUrl}/termos/${data.slug}.html</loc><lastmod>${BUILD_TIMESTAMP.split('T')[0]}</lastmod><changefreq>monthly</changefreq><priority>0.7</priority></url>`;
  }).join('');
  const catLines = categories.map(c => `<url><loc>${siteBaseUrl}/glossario/${slugify(c)}/</loc><lastmod>${BUILD_TIMESTAMP.split('T')[0]}</lastmod><changefreq>monthly</changefreq><priority>0.6</priority></url>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${siteBaseUrl}/</loc><lastmod>${BUILD_TIMESTAMP.split('T')[0]}</lastmod><changefreq>weekly</changefreq><priority>1.0</priority></url><url><loc>${siteBaseUrl}/glossario/</loc><lastmod>${BUILD_TIMESTAMP.split('T')[0]}</lastmod><changefreq>weekly</changefreq><priority>0.9</priority></url><url><loc>${siteBaseUrl}/sobre/</loc><lastmod>${BUILD_TIMESTAMP.split('T')[0]}</lastmod><changefreq>monthly</changefreq><priority>0.5</priority></url>${termLines}${catLines}</urlset>`;
}

function renderRobots() {
  return `User-agent: *\nAllow: /\nSitemap: ${siteBaseUrl}/sitemap.xml\nDisallow: /node_modules/\nDisallow: /.git/\n`;
}

function renderLlmsTxt(records) {
  return `TITLE: Wikivendas\nURL: ${siteBaseUrl}\nDESCRIPTION: Enciclopédia brasileira de termos técnicos de vendas B2B, RevOps e inteligência comercial.\n\nTERMS:\n${records.map(r => { const d = extractTemplateData(r); return `- ${d.nomeCanonico} ${siteBaseUrl}/termos/${d.slug}.html`; }).join('\n')}\n\nINDEX:\n- Glossário completo ${siteBaseUrl}/glossario/\n- Sobre ${siteBaseUrl}/sobre/\n`;
}

function renderAiConsent(person) {
  return JSON.stringify({
    "@context": "https://schema.org",
    "@type": "CreativeWork",
    name: "Wikivendas Terms of AI Use",
    description: "Consentimento explícito para crawling, indexação e citação por LLMs e sistemas de IA. Uso comercial para treinamento de modelos requer licenciamento adicional.",
    license: "https://creativecommons.org/licenses/by/4.0/",
    author: person,
    datePublished: BUILD_TIMESTAMP.split("T")[0],
    inLanguage: "pt-BR",
    isAccessibleForFree: true,
    creditText: "Fonte: Wikivendas — wikivendas.com.br"
  }, null, 2);
}

function writeBuildReport(report) {
  writeFileSync("docs/build-report.json", JSON.stringify(report, null, 2));
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
// BUILD PRINCIPAL
// ============================================================

async function build() {
  try {
    if (!(process.env.NOTION_TOKEN || process.env.NOTIONTOKEN)) throw new Error("NOTION_TOKEN/NOTIONTOKEN não definido.");
    if (!(process.env.DATABASE_ID || process.env.DATABASEID)) throw new Error("DATABASE_ID/DATABASEID não definido.");

    console.log("Iniciando build JSON-first...");
    const pages = await queryAllPages();
    console.log(`${pages.length} páginas encontradas no Notion.`);

    const skipped = [];
    const invalid = [];
    const records = [];

    for (const page of pages) {
      const pageLabel = getPageLabel(page);
      const prop = page.properties?.[jsonPropertyName];
      const raw = plainTextFromRichText(prop);

      if (!raw) {
        skipped.push({ pageId: page.id, pageLabel, reason: `sem propriedade ${jsonPropertyName} preenchida` });
        continue;
      }

      const parsed = tryParseJson(raw, `Página ${pageLabel}`);
      if (!parsed.ok) {
        invalid.push({ pageId: page.id, pageLabel, error: parsed.error, excerpt: parsed.excerpt });
        continue;
      }

      try {
        validateGraph(parsed.value);
        const graph = parsed.value["@graph"];
        const term = findNode(graph, "DefinedTerm");
        const record = {
          pageId: page.id,
          pageLabel,
          json: parsed.value,
          graph,
          website: findNode(graph, "WebSite"),
          org: findNode(graph, "Organization"),
          person: findNode(graph, "Person"),
          termSet: findNode(graph, "DefinedTermSet"),
          term,
          creativeWork: getWhitepaperNode(graph, term?.["@id"] || ""),
          dataCatalog: findNode(graph, "DataCatalog"),
          dataset: findNode(graph, "Dataset"),
          event: getEventNode(graph, term?.["@id"] || "")
        };
        records.push(record);
      } catch (error) {
        invalid.push({ pageId: page.id, pageLabel, error: `Página ${pageLabel}: ${error.message}`, excerpt: raw.slice(0, 320) });
      }
    }

    records.sort((a, b) => String(a.term.name).localeCompare(String(b.term.name), "pt-BR"));

    ensureDir("docs");
    ensureDir("docs/termos");
    ensureDir("docs/glossario");
    ensureDir("docs/sobre");

    const seed = records[0] || {};
    const website = seed.website || fallbackWebsiteNode();
    const org = seed.org || fallbackOrganizationNode();
    const person = seed.person || fallbackAuthorNode();
    const termSet = seed.termSet || fallbackTermSetNode();

    const categories = [...new Set(records.map(r => getCategoryFromTerm(r.term)))].sort((a,b)=>a.localeCompare(b,'pt-BR'));
    const globalGraph = { "@context": "https://schema.org", "@graph": records.flatMap(r => r.json["@graph"]) };

    writeFileSync("docs/index.html", renderHomePage(records, termSet, website, org, person));
    writeFileSync("docs/glossario/index.html", renderGlossaryPage(records, termSet, website, org, person));
    writeFileSync("docs/sobre/index.html", renderAboutPage(website, org, person));

    for (const record of records) {
      const data = extractTemplateData(record);
      writeFileSync(`docs/termos/${data.slug}.html`, renderTermPage(record));
      writeFileSync(`docs/termos/${data.slug}.json`, JSON.stringify(record.json, null, 2));
    }

    for (const category of categories) {
      const catSlug = slugify(category);
      ensureDir(`docs/glossario/${catSlug}`);
      const filtered = records.filter(r => getCategoryFromTerm(r.term) === category);
      writeFileSync(`docs/glossario/${catSlug}/index.html`, renderCategoryPage(category, filtered, categories, termSet, website, org, person));
    }

    writeFileSync("docs/glossario.json", JSON.stringify(globalGraph, null, 2));
    writeFileSync("docs/sitemap.xml", renderSitemap(records, categories));
    writeFileSync("docs/robots.txt", renderRobots());
    writeFileSync("docs/llms.txt", renderLlmsTxt(records));
    writeFileSync("docs/ai-consent.json", renderAiConsent(person));
    writeFileSync("docs/CNAME", customDomain);

    const report = {
      buildVersion: BUILD_VERSION,
      timestamp: BUILD_TIMESTAMP,
      siteBaseUrl,
      customDomain,
      notionJsonProperty: jsonPropertyName,
      pagesFound: pages.length,
      termsPublished: records.length,
      categoriesPublished: categories.length,
      skippedPages: skipped,
      invalidPages: invalid
    };
    writeBuildReport(report);

    console.log(`Build concluído com sucesso. ${records.length} termos publicados.`);
    if (skipped.length) console.log(`${skipped.length} páginas ignoradas sem ${jsonPropertyName}.`);
    if (invalid.length) console.log(`${invalid.length} páginas ignoradas por JSON inválido. Consulte docs/build-report.json`);
  } catch (error) {
    console.error("Erro no build:", error.message);
    process.exit(1);
  }
}

build();

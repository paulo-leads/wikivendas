#!/usr/bin/env node

import { Client } from "@notionhq/client";
import { writeFileSync, mkdirSync } from "fs";
import { createHash } from "crypto";

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const databaseId = process.env.DATABASE_ID;
const siteBaseUrl = (process.env.SITE_BASE_URL || "https://wikivendas.com.br").replace(/\/$/, "");
const jsonPropertyName = process.env.NOTION_JSON_PROPERTY || "JSON-LD";
const BUILD_VERSION = "v2.0.0-json-first";
const BUILD_TIMESTAMP = new Date().toISOString();

function escapeHtml(text = "") {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;");
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
    .replace(/https:\/\/www\.wikidata\.org\/wiki\/\s+Q/g, "https://www.wikidata.org/wiki/Q");
}

function getRichTextPlain(prop) {
  if (!prop) return "";
  if (prop.type === "rich_text") return (prop.rich_text || []).map(t => t.plain_text).join("").trim();
  if (prop.type === "title") return (prop.title || []).map(t => t.plain_text).join("").trim();
  return "";
}

function parseJsonProperty(page) {
  const prop = page.properties?.[jsonPropertyName];
  const raw = getRichTextPlain(prop);
  if (!raw) {
    throw new Error(`Página ${page.id} sem conteúdo na propriedade ${jsonPropertyName}`);
  }
  const normalized = normalizeJsonText(raw);
  return JSON.parse(normalized);
}

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
  return prop?.value?.description || "";
}

function getDefinedTermId(termNode) {
  const id = termNode?.["@id"] || "";
  return id.split("/").pop() || slugify(termNode?.name || "termo");
}

function validateGraph(json) {
  if (!json || json["@context"] !== "https://schema.org") {
    throw new Error("@context ausente ou diferente de https://schema.org");
  }
  if (!Array.isArray(json["@graph"]) || !json["@graph"].length) {
    throw new Error("@graph ausente ou vazio");
  }
  const required = ["WebSite", "Organization", "Person", "DefinedTermSet", "DefinedTerm", "CreativeWork", "DataCatalog", "Dataset", "Event"];
  for (const type of required) {
    if (!findNode(json["@graph"], type)) throw new Error(`Nó obrigatório ausente: ${type}`);
  }
  const term = findNode(json["@graph"], "DefinedTerm");
  ["dateCreated", "dateModified", "version", "status"].forEach((field) => {
    if (field in term) throw new Error(`DefinedTerm não pode conter ${field} diretamente`);
  });
  return true;
}

function getCategoryFromTerm(term) {
  const values = propertyValues(term, "categoria");
  return values[0] || "Geral";
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

function getCatDesc(cat) {
  const descs = {
    "Geral": "Termos fundamentais do ecossistema de RevOps e inteligência comercial.",
    "Conceito": "Definições canônicas de fenômenos, processos e entidades do mercado B2B.",
    "Métrica": "Indicadores e KPIs usados para mensurar desempenho comercial.",
    "Metodologia": "Frameworks, protocolos e abordagens sistematizadas de vendas e prospecção.",
    "Fenômeno": "Padrões emergentes, disfunções de mercado e comportamentos sistêmicos observados.",
    "Estratégia": "Posicionamentos táticos e planos de ação para vantagem competitiva.",
    "Tecnologia": "Ferramentas, plataformas e artefatos tecnológicos do ecossistema B2B.",
    "Prática": "Táticas operacionais e rotinas do campo comercial."
  };
  return descs[cat] || "Termos categorizados dentro da ontologia Wikivendas.";
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
    .wv-header { position: sticky; top: 0; z-index: 50; border-bottom: 0.5px solid var(--bd); background: rgba(3,7,18,0.85); backdrop-filter: blur(16px); }
    .wv-header-inner { max-width: 1100px; margin: 0 auto; padding: 0 2rem; height: 60px; display: flex; align-items: center; justify-content: space-between; }
    .wv-logo { font-size: 15px; font-weight: 800; letter-spacing: 0.06em; text-transform: uppercase; background: linear-gradient(90deg, #38bdf8, #818cf8); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; text-decoration: none; }
    .wv-version { font-size: 10px; font-family: 'JetBrains Mono', monospace; color: var(--tm); background: var(--c2); border: 0.5px solid var(--bds); padding: 3px 8px; border-radius: 20px; margin-left: 10px; -webkit-text-fill-color: var(--tm); }
    .wv-nav { display: flex; gap: 2rem; }
    .wv-nav a { font-size: 13px; color: var(--tm); text-decoration: none; transition: color 0.15s; }
    .wv-nav a:hover { color: var(--tp); }
    .wv-section-label { font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--ta); margin-bottom: 1rem; font-family: 'JetBrains Mono', monospace; }
    .wv-btn-primary { display: inline-flex; align-items: center; gap: 8px; padding: 12px 28px; background: #38bdf8; color: #030712; border-radius: var(--r); font-size: 14px; font-weight: 700; transition: background 0.15s, transform 0.1s; border: none; cursor: pointer; }
    .wv-btn-primary:hover { background: #7dd3fc; transform: translateY(-1px); }
    .wv-btn-ghost { display: inline-flex; align-items: center; gap: 8px; padding: 12px 24px; background: transparent; color: var(--ts); border: 0.5px solid var(--bds); border-radius: var(--r); font-size: 14px; transition: background 0.15s, color 0.15s; }
    .wv-btn-ghost:hover { background: var(--c2); color: var(--tp); }
    .wv-pill { font-size: 10px; background: rgba(56,189,248,0.1); color: var(--ta); border: 0.5px solid rgba(56,189,248,0.2); padding: 3px 8px; border-radius: 20px; font-family: 'JetBrains Mono', monospace; }
    .wv-footer { border-top: 0.5px solid var(--bd); background: var(--c0); padding: 3rem 2rem; }
    .wv-footer-inner { max-width: 1100px; margin: 0 auto; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 1.5rem; }
    .wv-footer-copy { font-size: 12px; font-family: 'JetBrains Mono', monospace; color: var(--tm); }
    .wv-footer-links { display: flex; gap: 1.5rem; flex-wrap: wrap; }
    .wv-footer-links a { font-size: 12px; font-family: 'JetBrains Mono', monospace; color: var(--tm); transition: color 0.15s; }
    .wv-footer-links a:hover { color: var(--ts); }
    @media (max-width: 768px) { .wv-nav { display: none; } }
  </style>`;
}

function renderSiteHeader(version = BUILD_VERSION) {
  return `<header class="wv-header"><div class="wv-header-inner"><div style="display:flex;align-items:center"><a href="/" class="wv-logo">Wikivendas</a><span class="wv-version">${version}</span></div><nav class="wv-nav"><a href="/">Início</a><a href="/glossario/">Glossário</a><a href="/sobre/">Sobre</a><a href="https://pauloleads.com.br" target="_blank" rel="noopener noreferrer">Paulo Leads</a></nav></div></header>`;
}

function renderSiteFooter(version = BUILD_VERSION) {
  return `<footer class="wv-footer"><div class="wv-footer-inner"><div><div style="display:flex;align-items:center;gap:10px;margin-bottom:0.5rem"><span class="wv-logo">Wikivendas</span><span class="wv-version">${version}</span></div><p class="wv-footer-copy">© 2026 Wikivendas — Construído com Protocolo Hidra por Paulo Leads.</p></div><div class="wv-footer-links"><a href="/glossario.json">Grafo (.JSON)</a><a href="/llms.txt">llms.txt</a><a href="/ai-consent.json">ai-consent.json</a><a href="/robots.txt">robots.txt</a><a href="/sitemap.xml">sitemap.xml</a></div></div></footer>`;
}

function renderTermPage(record) {
  const { json, term, website, org, person, termSet, creativeWork, dataset, event } = record;
  const termSlug = getDefinedTermId(term);
  const title = term.name || termSlug;
  const description = canonicalDescription(term.description || creativeWork?.description || "", 160);
  const canonical = term.url || `${siteBaseUrl}/termos/${termSlug}.html`;
  const category = getCategoryFromTerm(term);
  const altNames = Array.isArray(term.alternateName) ? term.alternateName.join(" · ") : (term.alternateName || "");
  const perguntas = propertyValues(term, "perguntasRelevantes");
  const mitigacoes = propertyValues(term, "mitigacaoDependeDe");
  const basedOn = propertyValues(term, "isBasedOn");
  const provenance = propertyThingDescription(term, "proveniencia");
  const metadados = propertyThingDescription(term, "metadadosVersao");
  const service = term.about || null;
  const contentHash = sha256(term.description || JSON.stringify(term));
  const pageGraph = { "@context": "https://schema.org", "@graph": [website, org, person, termSet, term, creativeWork, dataset, event].filter(Boolean) };

  return `<!DOCTYPE html><html lang="pt-BR"><head>${buildDesignSystemMeta({ title: `${title} — Wikivendas`, description, canonical })}<script type="application/ld+json">${JSON.stringify(pageGraph)}</script><style>
  .wv-container{max-width:860px;margin:0 auto;padding:6rem 2rem 4rem}.wv-back{display:inline-flex;align-items:center;gap:6px;color:var(--tm);font-size:14px;margin-bottom:2rem;transition:color .15s}.wv-back:hover{color:var(--tp)}.wv-term-title{font-size:clamp(32px,5vw,52px);font-weight:800;color:var(--tp);letter-spacing:-.03em;margin-bottom:.25rem}.wv-term-alternate{font-size:18px;color:var(--tm);margin-bottom:1.5rem}.wv-term-meta{display:flex;flex-wrap:wrap;gap:1rem;font-size:13px;color:var(--tm);border-bottom:.5px solid var(--bd);padding-bottom:1.5rem;margin-bottom:2rem}.wv-term-meta a{color:var(--ta)}.wv-term-meta a:hover{text-decoration:underline}.wv-section-title{font-size:20px;font-weight:600;color:var(--tp);margin:2.5rem 0 1rem}.wv-definition{font-size:17px;line-height:1.8;color:var(--ts)}.wv-visao{background:var(--c1);border-left:3px solid var(--ta);padding:1.5rem;border-radius:var(--r);margin:2rem 0;font-size:16px;color:var(--ts);line-height:1.7}.wv-dual-list{display:grid;grid-template-columns:1fr 1fr;gap:2rem;margin:2rem 0}.wv-dual-list ul{list-style:none}.wv-dual-list li{padding:.65rem 0;border-bottom:.5px solid var(--bd);font-size:14px;color:var(--ts)}.wv-dual-list li::before{content:"•";color:var(--ta);margin-right:8px}.wv-proof-badge{display:inline-flex;align-items:center;gap:6px;font-size:11px;font-family:'JetBrains Mono',monospace;color:var(--tm);background:var(--c2);border:.5px solid var(--bds);padding:6px 12px;border-radius:20px;margin:1rem 0}.wv-proof-badge .hash{color:var(--ta);font-size:10px}.wv-box{background:var(--c1);border:.5px solid var(--bd);border-radius:var(--r);padding:1.25rem 1.5rem;margin:1.5rem 0}.wv-box p,.wv-box li{font-size:14px;color:var(--ts)}.wv-links{display:flex;gap:1rem;flex-wrap:wrap;margin:1.5rem 0}.wv-links a{display:inline-flex;align-items:center;gap:8px;padding:12px 18px;border-radius:var(--r);font-size:14px;font-weight:700}.wv-links .ms{background:#0078d4;color:#fff}.wv-links .gg{background:#4285f4;color:#fff}.wv-links .aws{background:#ff9900;color:#111}.wv-minor{font-size:13px;color:var(--tm)}@media(max-width:768px){.wv-container{padding:4rem 1.25rem 3rem}.wv-dual-list{grid-template-columns:1fr}}</style></head><body>${renderSiteHeader()}<main class="wv-container"><a href="/glossario/" class="wv-back">← Voltar ao glossário</a><p class="wv-section-label">${escapeHtml(category)}</p><h1 class="wv-term-title">${escapeHtml(title)}</h1>${altNames ? `<p class="wv-term-alternate">${escapeHtml(altNames)}</p>` : ""}<div class="wv-term-meta"><span>TermCode <code>${escapeHtml(term.termCode || "")}</code></span>${term.sameAs?.[0] ? `<span>DOI <a href="${escapeHtml(term.sameAs[0])}" target="_blank" rel="noopener noreferrer">${escapeHtml(term.sameAs[0].replace('https://doi.org/',''))}</a></span>` : ""}${event?.url ? `<span><a href="${escapeHtml(event.url)}" target="_blank" rel="noopener noreferrer">Apresentação</a></span>` : ""}${dataset?.url ? `<span><a href="${escapeHtml(dataset.url)}" target="_blank" rel="noopener noreferrer">Dataset</a></span>` : ""}</div><div class="wv-proof-badge"><span>Verificado</span><span class="hash">SHA256 ${contentHash.substring(0,16)}</span><span>${BUILD_TIMESTAMP.split('T')[0]}</span></div><h2 class="wv-section-title">Definição canônica</h2><div class="wv-definition">${escapeHtml(term.description || "")}</div>${service ? `<div class="wv-visao" id="visao-hidra"><strong style="color:var(--ta);display:block;margin-bottom:.5rem">Visão Hidra</strong>${escapeHtml(service.description || '')}</div>` : ''}${(perguntas.length || mitigacoes.length) ? `<div class="wv-dual-list">${perguntas.length ? `<div><h3 style="font-size:16px;font-weight:600;color:var(--tp);margin-bottom:.75rem">Perguntas relevantes</h3><ul>${perguntas.map(v=>`<li>${escapeHtml(v)}</li>`).join('')}</ul></div>` : ''}${mitigacoes.length ? `<div><h3 style="font-size:16px;font-weight:600;color:var(--tp);margin-bottom:.75rem">Mitigação depende de</h3><ul>${mitigacoes.map(v=>`<li>${escapeHtml(v)}</li>`).join('')}</ul></div>` : ''}</div>` : ''}${basedOn.length ? `<div class="wv-links">${basedOn.map((item, idx)=>`<a class="${idx===0?'ms':idx===1?'gg':'aws'}" href="${escapeHtml(item.url || item)}" target="_blank" rel="noopener noreferrer">Fonte ${idx+1}</a>`).join('')}</div>` : ''}${creativeWork ? `<div class="wv-box"><h2 class="wv-section-title" style="margin-top:0">Whitepaper</h2><p>${escapeHtml(creativeWork.description || '')}</p></div>` : ''}${provenance ? `<div class="wv-box"><h2 class="wv-section-title" style="margin-top:0">Proveniência</h2><p>${escapeHtml(provenance)}</p></div>` : ''}${metadados ? `<p class="wv-minor">${escapeHtml(metadados)}</p>` : ''}<div style="margin-top:3rem;border-top:.5px solid var(--bd);padding-top:2rem"><p class="wv-minor">Este verbete parte da <strong style="color:var(--tp)">Wikivendas</strong>. <a href="/termos/${termSlug}.json" style="color:var(--ta)">JSON-LD</a> · <a href="/glossario.json" style="color:var(--ta)">Grafo completo</a></p></div></main>${renderSiteFooter()}</body></html>`;
}

function renderGlossaryPage(records, termSet, website, org, person) {
  const categories = [...new Set(records.map(r => getCategoryFromTerm(r.term)))].sort((a,b)=>a.localeCompare(b,'pt-BR'));
  const groups = categories.map(cat => {
    const terms = records.filter(r => getCategoryFromTerm(r.term) === cat);
    return `<section class="wv-cat-section glossary-group" data-search="${escapeHtml([cat,...terms.map(t=>t.term.name)].join(' ').toLowerCase())}"><div class="wv-cat-titulo"><span class="wv-cat-dot" style="background:${getCategoryColor(cat)}"></span><a href="/glossario/${slugify(cat)}/" style="color:var(--tp)">${escapeHtml(cat)}</a><span class="wv-cat-count">${terms.length} termos</span></div><div class="wv-cat-desc">${escapeHtml(getCatDesc(cat))}</div><div class="wv-termo-list">${terms.slice(0,8).map(r=>`<a href="/termos/${getDefinedTermId(r.term)}.html" class="wv-termo-item"><span class="wv-termo-item-nome">${escapeHtml(r.term.name || '')}</span><span class="wv-termo-item-def">${escapeHtml(canonicalDescription(r.term.description || '', 100))}</span></a>`).join('')}</div></section>`;
  }).join('');
  const pageGraph = { "@context":"https://schema.org", "@graph":[website, org, person, termSet].filter(Boolean) };
  return `<!DOCTYPE html><html lang="pt-BR"><head>${buildDesignSystemMeta({ title:'Glossário Wikivendas', description:'Glossário geral da Wikivendas com todas as categorias e verbetes indexáveis.', canonical:`${siteBaseUrl}/glossario/` })}<script type="application/ld+json">${JSON.stringify(pageGraph)}</script><style>.wv-glossario{max-width:1100px;margin:0 auto;padding:5rem 2rem 4rem}.wv-headline{font-size:clamp(34px,5vw,58px);font-weight:900;line-height:1.02;letter-spacing:-.04em;color:var(--tp);margin-bottom:1.5rem}.wv-lead{font-size:17px;color:var(--ts);max-width:760px;line-height:1.7;margin-bottom:2rem}.wv-search{width:100%;padding:14px 16px;background:var(--c1);color:var(--tp);border:.5px solid var(--bds);border-radius:var(--r);font-size:15px;margin-bottom:3rem}.wv-cat-section{margin-bottom:3rem}.wv-cat-titulo{display:flex;align-items:center;gap:10px;font-size:18px;font-weight:700;color:var(--tp);margin-bottom:.5rem}.wv-cat-dot{width:10px;height:10px;border-radius:50%;flex-shrink:0}.wv-cat-count{font-size:12px;font-family:'JetBrains Mono',monospace;color:var(--tm);font-weight:400;margin-left:4px}.wv-cat-desc{font-size:13px;color:var(--tm);margin-bottom:1rem;max-width:600px}.wv-termo-list{display:flex;flex-direction:column;border:.5px solid var(--bd);border-radius:var(--r);overflow:hidden}.wv-termo-item{display:grid;grid-template-columns:1fr 1fr;gap:1rem;padding:.75rem 1.25rem;background:var(--c1);border-bottom:.5px solid var(--bd);transition:background .15s}.wv-termo-item:last-child{border-bottom:none}.wv-termo-item:hover{background:var(--c2)}.wv-termo-item-nome{font-size:14px;font-weight:600;color:var(--tp)}.wv-termo-item-def{font-size:12px;color:var(--tm);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}@media(max-width:768px){.wv-glossario{padding:4rem 1.25rem 3rem}.wv-termo-item{grid-template-columns:1fr}.wv-termo-item-def{display:none}}</style></head><body>${renderSiteHeader()}<section class="wv-glossario"><p class="wv-section-label">Índice canônico terminológico</p><h1 class="wv-headline">Glossário da Wikivendas</h1><p class="wv-lead">Página real e indexável com todas as categorias e verbetes da ontologia Wikivendas. Cada termo aponta para seu HTML individual e para seu JSON-LD correspondente.</p><input id="wv-glossary-search" class="wv-search" type="search" placeholder="Buscar termo ou categoria">${groups}</section>${renderSiteFooter()}<script>const q=document.getElementById('wv-glossary-search');const groups=[...document.querySelectorAll('.glossary-group')];q.addEventListener('input',()=>{const s=q.value.toLowerCase().trim();groups.forEach(sec=>{const t=sec.dataset.search;sec.style.display=!s||t.includes(s)?'':'none';});});</script></body></html>`;
}

function renderHomePage(records, termSet, website, org, person) {
  const cardsHtml = records.slice(0,6).map((r,i)=>`<div class="wv-card" onclick="window.location.href='/termos/${getDefinedTermId(r.term)}.html'"><div class="wv-card-index">${String(i+1).padStart(3,'0')} <span style="font-size:10px;color:var(--tm)">SHA256 ${sha256(r.term.description||'').substring(0,8)}</span></div><div class="wv-card-name">${escapeHtml(r.term.name || '')}</div><div class="wv-card-def">${escapeHtml(canonicalDescription(r.term.description || '', 120))}</div><div class="wv-card-footer"><span class="wv-pill">${escapeHtml(getCategoryFromTerm(r.term))}</span>${r.term.sameAs?.[0] ? `<span class="wv-doi">DOI ${escapeHtml(r.term.sameAs[0].replace('https://doi.org/',''))}</span>` : ''}</div></div>`).join('');
  const pageGraph = { "@context":"https://schema.org", "@graph":[website, org, person, termSet].filter(Boolean) };
  return `<!DOCTYPE html><html lang="pt-BR"><head>${buildDesignSystemMeta({ title:'Wikivendas — A Primeira Fonte de Verdade para IA Comercial B2B', description:'A primeira enciclopédia brasileira de termos técnicos de vendas B2B, RevOps imobiliário e governança ontológica.', canonical:`${siteBaseUrl}/` })}<script type="application/ld+json">${JSON.stringify(pageGraph)}</script><style>.wv-hero{max-width:1100px;margin:0 auto;padding:6rem 2rem 5rem}.wv-eyebrow{display:inline-flex;align-items:center;gap:8px;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--ta);margin-bottom:2rem}.wv-eyebrow:before{content:'';display:inline-block;width:6px;height:6px;background:var(--ta);border-radius:50%}.wv-slogan{font-size:clamp(44px,7vw,88px);font-weight:900;line-height:1;letter-spacing:-.04em;color:var(--tp);margin-bottom:2.5rem;max-width:900px}.wv-slogan em{font-style:normal;background:linear-gradient(135deg,#38bdf8 0,#818cf8 60%,#f472b6 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}.wv-hero-body{font-size:18px;line-height:1.7;color:var(--ts);max-width:620px;margin-bottom:1.25rem}.wv-hero-sub{font-size:14px;color:var(--tm);max-width:540px;margin-bottom:2.5rem;line-height:1.6}.wv-hero-actions{display:flex;gap:1rem;flex-wrap:wrap}.wv-cards-section{max-width:1100px;margin:0 auto;padding:4rem 2rem}.wv-cards-header{display:flex;align-items:flex-end;justify-content:space-between;margin-bottom:2rem;flex-wrap:wrap;gap:1rem}.wv-cards-headline{font-size:28px;font-weight:800;color:var(--tp);letter-spacing:-.02em}.wv-cards-link{font-size:13px;color:var(--ta)}.wv-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:1.5rem}.wv-card{background:var(--c1);border:.5px solid var(--bd);border-radius:var(--r);padding:1.5rem;cursor:pointer;transition:border-color .15s,background .15s;display:flex;flex-direction:column;gap:.75rem}.wv-card:hover{border-color:rgba(56,189,248,.3);background:var(--c2)}.wv-card-index{font-size:11px;font-family:'JetBrains Mono',monospace;color:var(--tm)}.wv-card-name{font-size:17px;font-weight:700;color:var(--tp);line-height:1.3}.wv-card-def{font-size:13px;color:var(--ts);line-height:1.5;flex:1;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}.wv-card-footer{display:flex;align-items:center;justify-content:space-between;margin-top:.5rem}.wv-doi{font-size:10px;font-family:'JetBrains Mono',monospace;color:var(--tm);text-overflow:ellipsis;overflow:hidden;white-space:nowrap;max-width:140px}@media(max-width:768px){.wv-hero{padding:4rem 1.25rem 3rem}}</style></head><body>${renderSiteHeader()}<main><section class="wv-hero"><div class="wv-eyebrow">Ontological SEO · Forensic GEO</div><h1 class="wv-slogan">A fonte de verdade que a <em>IA</em> consulta.</h1><p class="wv-hero-body">Primeira enciclopédia brasileira de vendas B2B, RevOps imobiliário e inteligência comercial. Cada verbete possui URN, DOI, validação cruzada e registro estruturado.</p><p class="wv-hero-sub">Construída para ser a referência canônica lida por humanos e citada por modelos de linguagem como fonte de verdade.</p><div class="wv-hero-actions"><a href="/glossario/" class="wv-btn-primary">Explorar Glossário</a><a href="/sobre/" class="wv-btn-ghost">Sobre o Projeto</a></div></section><section class="wv-cards-section"><div class="wv-cards-header"><h2 class="wv-cards-headline">Verbetes em destaque</h2><a href="/glossario/" class="wv-cards-link">Glossário completo →</a></div><div class="wv-grid">${cardsHtml}</div></section></main>${renderSiteFooter()}</body></html>`;
}

function renderAboutPage(website, org, person) {
  const pageGraph = { "@context":"https://schema.org", "@graph":[website, org, person].filter(Boolean) };
  return `<!DOCTYPE html><html lang="pt-BR"><head>${buildDesignSystemMeta({ title:'Sobre — Wikivendas', description:'Conheça a Wikivendas, a primeira enciclopédia brasileira de vendas B2B e RevOps imobiliário.', canonical:`${siteBaseUrl}/sobre/` })}<script type="application/ld+json">${JSON.stringify(pageGraph)}</script><style>.wv-sobre{max-width:760px;margin:0 auto;padding:5rem 2rem 4rem}.wv-sobre h1{font-size:clamp(34px,5vw,48px);font-weight:900;line-height:1.05;letter-spacing:-.03em;color:var(--tp);margin-bottom:1.5rem}.wv-sobre h2{font-size:22px;font-weight:700;color:var(--tp);margin-top:2.5rem;margin-bottom:.75rem}.wv-sobre p,.wv-sobre li{font-size:16px;line-height:1.7;color:var(--ts);margin-bottom:1rem}.wv-sobre ul{padding-left:1.5rem}.wv-sobre strong{color:var(--tp)}</style></head><body>${renderSiteHeader()}<section class="wv-sobre"><p class="wv-section-label">Sobre</p><h1>Wikivendas, fonte de verdade para IA comercial</h1><p><strong>Wikivendas</strong> é uma enciclopédia dedicada a termos técnicos de vendas B2B, RevOps imobiliário e inteligência comercial. Cada verbete é uma definição canônica pensada para humanos e para modelos de linguagem.</p><h2>Arquitetura JSON-first</h2><p>O conteúdo nasce como JSON-LD canônico. O HTML é apenas a camada de visualização, gerada a partir do grafo estruturado de cada termo.</p><h2>Protocolo Hidra</h2><p>O Protocolo Hidra atua como camada de amarração semântica entre problema, diagnóstico, evidência, mitigação e solução, preservando coerência para leitura humana e consumo por IA.</p></section>${renderSiteFooter()}</body></html>`;
}

function renderSitemap(records, categories) {
  const termLines = records.map(r => `<url><loc>${siteBaseUrl}/termos/${getDefinedTermId(r.term)}.html</loc><lastmod>${BUILD_TIMESTAMP.split('T')[0]}</lastmod><changefreq>monthly</changefreq><priority>0.7</priority></url>`).join('');
  const catLines = categories.map(c => `<url><loc>${siteBaseUrl}/glossario/${slugify(c)}/</loc><lastmod>${BUILD_TIMESTAMP.split('T')[0]}</lastmod><changefreq>monthly</changefreq><priority>0.6</priority></url>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${siteBaseUrl}/</loc><lastmod>${BUILD_TIMESTAMP.split('T')[0]}</lastmod><changefreq>weekly</changefreq><priority>1.0</priority></url><url><loc>${siteBaseUrl}/glossario/</loc><lastmod>${BUILD_TIMESTAMP.split('T')[0]}</lastmod><changefreq>weekly</changefreq><priority>0.9</priority></url><url><loc>${siteBaseUrl}/sobre/</loc><lastmod>${BUILD_TIMESTAMP.split('T')[0]}</lastmod><changefreq>monthly</changefreq><priority>0.5</priority></url>${termLines}${catLines}</urlset>`;
}

function renderRobots() {
  return `User-agent: *\nAllow: /\nSitemap: ${siteBaseUrl}/sitemap.xml\nDisallow: /node_modules/\nDisallow: /.git/\n`;
}

function renderLlmsTxt(records) {
  return `TITLE: Wikivendas\nURL: ${siteBaseUrl}\nDESCRIPTION: Enciclopédia brasileira de termos técnicos de vendas B2B, RevOps e inteligência comercial.\n\nTERMS:\n${records.map(r => `- ${r.term.name} ${siteBaseUrl}/termos/${getDefinedTermId(r.term)}.html`).join('\n')}\n\nINDEX:\n- Glossário completo ${siteBaseUrl}/glossario/\n- Sobre ${siteBaseUrl}/sobre/\n`;
}

function renderAiConsent(person) {
  return JSON.stringify({
    "@context": "https://schema.org",
    "@type": "CreativeWork",
    name: "Wikivendas Terms of AI Use",
    description: "Consentimento explícito para crawling, indexação e citação por LLMs e sistemas de IA. Uso comercial para treinamento de modelos requer licenciamento adicional.",
    license: "https://creativecommons.org/licenses/by/4.0/",
    author: person,
    datePublished: BUILD_TIMESTAMP.split('T')[0],
    inLanguage: "pt-BR",
    isAccessibleForFree: true,
    creditText: "Fonte Wikivendas — wikivendas.com.br"
  }, null, 2);
}

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

async function build() {
  try {
    if (!process.env.NOTION_TOKEN) throw new Error("NOTION_TOKEN não definido.");
    if (!process.env.DATABASE_ID) throw new Error("DATABASE_ID não definido.");

    console.log("Iniciando build JSON-first...");
    const pages = await queryAllPages();
    console.log(`${pages.length} páginas encontradas no Notion.`);

    const records = pages.map(page => {
      const json = parseJsonProperty(page);
      validateGraph(json);
      const graph = json["@graph"];
      return {
        pageId: page.id,
        json,
        graph,
        website: findNode(graph, "WebSite"),
        org: findNode(graph, "Organization"),
        person: findNode(graph, "Person"),
        termSet: findNode(graph, "DefinedTermSet"),
        term: findNode(graph, "DefinedTerm"),
        creativeWork: findNode(graph, "CreativeWork"),
        dataCatalog: findNode(graph, "DataCatalog"),
        dataset: findNode(graph, "Dataset"),
        event: findNode(graph, "Event")
      };
    }).filter(r => r.term?.name);

    if (!records.length) throw new Error("Nenhum termo válido encontrado.");

    records.sort((a,b) => String(a.term.name).localeCompare(String(b.term.name), 'pt-BR'));

    const docs = "docs";
    ensureDir(docs);
    ensureDir(`${docs}/termos`);
    ensureDir(`${docs}/glossario`);
    ensureDir(`${docs}/sobre`);

    const categories = [...new Set(records.map(r => getCategoryFromTerm(r.term)))].sort((a,b)=>a.localeCompare(b,'pt-BR'));

    const globalGraph = {
      "@context": "https://schema.org",
      "@graph": records.flatMap(r => r.json["@graph"])
    };

    const first = records[0];

    writeFileSync(`${docs}/index.html`, renderHomePage(records, first.termSet, first.website, first.org, first.person));
    writeFileSync(`${docs}/glossario/index.html`, renderGlossaryPage(records, first.termSet, first.website, first.org, first.person));
    writeFileSync(`${docs}/sobre/index.html`, renderAboutPage(first.website, first.org, first.person));

    for (const record of records) {
      const slug = getDefinedTermId(record.term);
      writeFileSync(`${docs}/termos/${slug}.html`, renderTermPage(record));
      writeFileSync(`${docs}/termos/${slug}.json`, JSON.stringify(record.json, null, 2));
    }

    for (const category of categories) {
      const catSlug = slugify(category);
      ensureDir(`${docs}/glossario/${catSlug}`);
      const filtered = records.filter(r => getCategoryFromTerm(r.term) === category);
      writeFileSync(`${docs}/glossario/${catSlug}/index.html`, renderGlossaryPage(filtered, first.termSet, first.website, first.org, first.person));
    }

    writeFileSync(`${docs}/glossario.json`, JSON.stringify(globalGraph, null, 2));
    writeFileSync(`${docs}/sitemap.xml`, renderSitemap(records, categories));
    writeFileSync(`${docs}/robots.txt`, renderRobots());
    writeFileSync(`${docs}/llms.txt`, renderLlmsTxt(records));
    writeFileSync(`${docs}/ai-consent.json`, renderAiConsent(first.person));

    console.log(`Build concluído com sucesso. ${records.length} termos publicados.`);
  } catch (error) {
    console.error("Erro no build:", error.message);
    process.exit(1);
  }
}

build();

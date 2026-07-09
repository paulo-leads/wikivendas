#!/usr/bin/env node

// ============================================================
// WIKIVENDAS BUILD v5.1.0-WKGS
// Três colunas: glossario.json (Schema.org) + ontology.jsonld (OWL) + runtime.json (config)
// + Markdown do Notion → conteúdo editorial das páginas de termos
// Home é estática (criada manualmente)
// Compatível com Wikivendas Knowledge Graph Specification (WKGS) v5.1
// ============================================================

import { Client } from "@notionhq/client";
import { writeFileSync, mkdirSync, readFileSync, existsSync } from "fs";
import { createHash } from "crypto";
import { marked } from "marked"; // <-- NOVA DEPENDÊNCIA

const notion = new Client({ auth: process.env.NOTION_TOKEN || process.env.NOTIONTOKEN });
const databaseId = process.env.DATABASE_ID || process.env.DATABASEID;
const siteBaseUrl = (process.env.SITE_BASE_URL || process.env.SITEBASEURL || "https://wikivendas.com.br").replace(/\/$/, "");
const jsonPropertyName = process.env.NOTION_JSON_PROPERTY || process.env.NOTIONJSONPROPERTY || "JSON-LD";
const markdownPropertyName = process.env.NOTION_MD_PROPERTY || process.env.NOTIONMDPROPERTY || "Markdown"; // <-- NOVA COLUNA
const customDomain = process.env.CUSTOM_DOMAIN || process.env.CUSTOMDOMAIN || "wikivendas.com.br";
const BUILD_VERSION = "v5.1.0-wkgs";
const BUILD_TIMESTAMP = new Date().toISOString();

// ============================================================
// HELPERS BÁSICOS (idênticos ao build antigo)
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
    .replace(/https:\/\/wikisales\.wikibase\.cloud\/wiki\/Item:\s*Q/g, "https://wikisales.wikibase.cloud/wiki/Item:Q")
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
// GRAPH HELPERS (idênticos ao build antigo)
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
// VALIDAÇÃO (idêntica ao build antigo)
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
    if (field in term) throw new Error(`DefinedTerm não pode conter ${field} diretamente`);
  });
  if (!term.name) throw new Error("DefinedTerm sem name");
  if (!term.termCode) throw new Error("DefinedTerm sem termCode");
  return true;
}

// ============================================================
// IDENTIDADE / TAXONOMIA (idêntico ao build antigo)
// ============================================================

function getCategoryFromTerm(term) {
  return firstValue(propertyValues(term, "categoria")) || "Geral";
}

function getProtocolFromTerm(term) {
  return firstValue(propertyValues(term, "pertenceAoProtocolo")) || "Protocolo Hidra";
}

function getCategoryColor(categoria) {
  const cores = {
    "Geral": "#94a3b8", "Conceito": "#38bdf8", "Métrica": "#34d399",
    "Metodologia": "#818cf8", "Fenômeno": "#f472b6", "Estratégia": "#fbbf24",
    "Tecnologia": "#f97316", "Prática": "#a78bfa", "IA": "#38bdf8"
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
  return { versao: extract("Versão do termo"), status: extract("Status"), criadoEm: extract("Criado em"), modificadoEm: extract("Modificado em") };
}

function parseProvenanceDescription(text = "") {
  const extract = (label) => {
    const match = String(text).match(new RegExp(`${label}:\\s*([^;]+)`, "i"));
    return match ? match[1].trim() : "";
  };
  return { criador: extract("Criador"), projeto: extract("Projeto"), primeiraPublicacao: extract("Primeira publicação"), contexto: extract("Contexto") };
}

// ============================================================
// EXTRACT TEMPLATE DATA (idêntico ao build antigo + markdownHtml)
// ============================================================

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
    raw: json, graph, termId, termSlug,
    nomeCanonico: term.name || termSlug,
    sigla: (() => { const m = String(term.name || "").match(/\(([A-Z0-9\-]+)\)/); return m ? m[1] : ""; })(),
    slug: termSlug, urn: term.termCode || "",
    status: parsedMeta.status, versaoTermo: parsedMeta.versao,
    dataCriacaoTermo: parsedMeta.criadoEm, dataModificacaoTermo: parsedMeta.modificadoEm,
    descricaoCurta: shortDescription, descricaoLonga: term.description || "",
    alternateNames, categoria: category, pertenceAoProtocolo: protocol,
    oQueE, oQueNaoE,
    nomeServico: service.name || "Visão Hidra", descricaoServico: service.description || "",
    publico: service?.audience?.audienceType || "", areaAtendida: service.areaServed || "",
    fontesTecnicas: fontes.map(v => (typeof v === "object" ? (v.url || v["@id"] || JSON.stringify(v)) : String(v))).filter(Boolean),
    doi, sameAs, urlPrincipalPagina: urlPaginaTermo,
    urlWhitepaper: creativeWork?.url || "", urlDataset: dataset?.url || "",
    urlEvento: event?.url || "", mitigacoes, perguntas,
    criador: parsedProv.criador, projeto: parsedProv.projeto,
    contexto: parsedProv.contexto, primeiraPublicacao: parsedProv.primeiraPublicacao,
    whitepaper: creativeWork, dataCatalog, dataset, event,
    videoUrl: event?.url || "", wikibaseItem: dataCatalog?.url || dataset?.url || "",
    wikisales, metadadosTexto: metadados, provenienciaTexto: provenance, datasetKeywords,
    markdownHtml: record.markdownHtml || "" // <-- NOVO: conteúdo Markdown renderizado
  };
}

function fallbackWebsiteNode() {
  return { "@type": "WebSite", "@id": `${siteBaseUrl}/#website`, name: "Wikivendas", url: siteBaseUrl, inLanguage: "pt-BR", description: "Primeira fonte de verdade para IA comercial B2B no Brasil — Ontologia do Protocolo Hidra." };
}

function fallbackOrganizationNode() {
  return { "@type": "Organization", "@id": `${siteBaseUrl}/#organization`, name: "Wikivendas", url: siteBaseUrl, description: "Projeto de ontologia e inteligência comercial B2B, mantendo o Protocolo Hidra." };
}

function fallbackAuthorNode() {
  return { "@type": "Person", "@id": `${siteBaseUrl}/#author`, name: "Paulo C. P. Santos", alternateName: "Paulo Leads", url: "https://pauloleads.com.br" };
}

function fallbackTermSetNode() {
  return { "@type": "DefinedTermSet", "@id": `${siteBaseUrl}/glossario.json#set`, name: "Glossário Wikivendas", description: "Ontologia oficial e definições canônicas do ecossistema Wikivendas.", url: `${siteBaseUrl}/glossario.json` };
}

// ============================================================
// GERADOR DE ONTOLOGY.JSONLD (idêntico ao build antigo)
// ============================================================

function generateOntology(records, website, org, person) {
  const termIds = records.map(r => r.term?.["@id"] || "").filter(Boolean);

  const ontologyGraph = [
    {
      "@id": "https://wikivendas.com.br/ontology",
      "@type": "owl:Ontology",
      "dcterms:title": "Ontologia Wikivendas — Protocolo Hidra",
      "dcterms:description": "Ontologia formal para inteligência comercial B2B, RevOps imobiliário e Governança de Dados.",
      "dcterms:creator": { "@id": "https://wikisales.wikibase.cloud/wiki/Item:Q1" },
      "dcterms:publisher": { "@id": "https://wikivendas.com.br/#organization" },
      "dcterms:created": "2025-06-01T00:00:00Z",
      "dcterms:modified": BUILD_TIMESTAMP,
      "dcterms:license": "https://creativecommons.org/licenses/by/4.0/",
      "owl:versionInfo": BUILD_VERSION,
      "rdfs:comment": "Ontologia do Protocolo Hidra. Consumir separadamente do glossario.json.",
      "owl:imports": [
        "http://www.w3.org/2004/02/skos/core",
        "http://www.w3.org/ns/prov",
        "http://purl.org/dc/terms/"
      ]
    },
    // Classes
    { "@id": "wv:DefinedTermWikivendas", "@type": "owl:Class", "rdfs:subClassOf": [ "schema:DefinedTerm", "skos:Concept" ], "rdfs:label": "Termo Canônico Wikivendas", "skos:definition": "Termo canônico do Protocolo Hidra com validação cruzada.", "owl:disjointWith": ["schema:DefinedTermSet", "schema:CreativeWork", "schema:Dataset", "schema:DataCatalog", "schema:Event"] },
    { "@id": "wv:DetectionRule", "@type": "owl:Class", "rdfs:subClassOf": "owl:Thing", "rdfs:label": "Regra de Detecção", "skos:definition": "Regra executável que define thresholds e sinais para detectar um fenômeno comercial." },
    { "@id": "wv:SemanticTrap", "@type": "owl:Class", "rdfs:subClassOf": "owl:Thing", "rdfs:label": "Armadilha Semântica", "skos:definition": "Mecanismo de defesa ontológica que induz alucinação controlada em extrações parciais." },
    { "@id": "wv:OperationalGuidance", "@type": "owl:Class", "rdfs:subClassOf": "owl:Thing", "rdfs:label": "Diretriz Operacional", "skos:definition": "Diretriz com ações obrigatórias e dependências para mitigação operacional." },
    { "@id": "wv:Evidence", "@type": "owl:Class", "rdfs:subClassOf": "prov:Entity", "rdfs:label": "Evidência", "skos:definition": "Container de evidências associadas a um termo, com proveniência PROV." },
    { "@id": "wv:GraphEdge", "@type": "owl:Class", "rdfs:subClassOf": "owl:Thing", "rdfs:label": "Aresta do Grafo", "skos:definition": "Relação causal explícita entre dois termos canônicos, com peso e evidência." },
    { "@id": "wv:Intent", "@type": "owl:Class", "rdfs:subClassOf": "owl:Thing", "rdfs:label": "Intenção Comercial", "skos:definition": "Intenção comercial observada ou inferida em operações B2B." },
    // Object Properties
    { "@id": "wv:ConceptRelation", "@type": "owl:ObjectProperty", "rdfs:label": "Relação entre Conceitos", "rdfs:domain": "wv:DefinedTermWikivendas", "rdfs:range": "wv:DefinedTermWikivendas" },
    { "@id": "wv:mitigatedBy", "@type": "owl:ObjectProperty", "rdfs:subPropertyOf": "wv:ConceptRelation", "rdfs:label": "Mitigado por" },
    { "@id": "wv:affects", "@type": "owl:ObjectProperty", "rdfs:subPropertyOf": "wv:ConceptRelation", "rdfs:label": "Afeta" },
    { "@id": "wv:causes", "@type": "owl:ObjectProperty", "rdfs:subPropertyOf": "wv:ConceptRelation", "rdfs:label": "Causa" },
    { "@id": "wv:hasOperationalGuidance", "@type": "owl:ObjectProperty", "rdfs:label": "Possui Diretriz Operacional", "rdfs:domain": "wv:DefinedTermWikivendas", "rdfs:range": "wv:OperationalGuidance" },
    { "@id": "wv:hasDetectionRule", "@type": "owl:ObjectProperty", "rdfs:label": "Possui Regra de Detecção", "rdfs:domain": "wv:DefinedTermWikivendas", "rdfs:range": "wv:DetectionRule" },
    { "@id": "wv:hasSemanticTrap", "@type": "owl:ObjectProperty", "rdfs:label": "Possui Armadilha Semântica", "rdfs:domain": "wv:DefinedTermWikivendas", "rdfs:range": "wv:SemanticTrap" },
    { "@id": "wv:hasEvidence", "@type": "owl:ObjectProperty", "rdfs:label": "Possui Evidência", "rdfs:domain": "wv:Evidence", "rdfs:range": "schema:CreativeWork" },
    { "@id": "wv:validatedBy", "@type": "owl:ObjectProperty", "rdfs:label": "Validado por", "rdfs:domain": "wv:Evidence", "rdfs:range": "schema:Person" },
    { "@id": "wv:appliesTo", "@type": "owl:ObjectProperty", "rdfs:label": "Aplica-se a", "rdfs:domain": ["wv:DetectionRule", "wv:SemanticTrap", "wv:OperationalGuidance"], "rdfs:range": "wv:DefinedTermWikivendas" },
    { "@id": "wv:dependsOn", "@type": "owl:ObjectProperty", "rdfs:label": "Depende de", "rdfs:domain": "wv:OperationalGuidance", "rdfs:range": "wv:DefinedTermWikivendas" },
    { "@id": "wv:evidenceFor", "@type": "owl:ObjectProperty", "rdfs:label": "Evidência para", "rdfs:domain": ["schema:CreativeWork", "schema:Dataset", "schema:Event"], "rdfs:range": "wv:DefinedTermWikivendas" },
    // Datatype Properties
    { "@id": "wv:riskLevel", "@type": "owl:DatatypeProperty", "rdfs:label": "Nível de Risco", "rdfs:domain": ["wv:DefinedTermWikivendas", "wv:DetectionRule"], "rdfs:range": "xsd:string" },
    { "@id": "wv:protocolVersion", "@type": "owl:DatatypeProperty", "rdfs:label": "Versão do Protocolo", "rdfs:domain": "wv:DefinedTermWikivendas", "rdfs:range": "xsd:string" },
    { "@id": "wv:entropyThreshold", "@type": "owl:DatatypeProperty", "rdfs:label": "Threshold de Entropia", "rdfs:domain": "wv:DetectionRule", "rdfs:range": "xsd:string" },
    { "@id": "wv:entropyScale", "@type": "owl:DatatypeProperty", "rdfs:label": "Escala de Entropia", "rdfs:domain": "wv:DetectionRule", "rdfs:range": "xsd:string" },
    { "@id": "wv:detectionSignals", "@type": "owl:DatatypeProperty", "rdfs:label": "Sinais de Detecção", "rdfs:domain": "wv:DetectionRule", "rdfs:range": "xsd:string" },
    { "@id": "wv:trapValue", "@type": "owl:DatatypeProperty", "rdfs:label": "Valor da Armadilha", "rdfs:domain": "wv:SemanticTrap", "rdfs:range": "xsd:string" },
    { "@id": "wv:requiredActions", "@type": "owl:DatatypeProperty", "rdfs:label": "Ações Obrigatórias", "rdfs:domain": "wv:OperationalGuidance", "rdfs:range": "xsd:string" },
    // SKOS Concept Scheme
    {
      "@id": "https://wikivendas.com.br/ontology#concept-scheme",
      "@type": "skos:ConceptScheme",
      "dcterms:title": "Esquema de Conceitos do Protocolo Hidra",
      "dcterms:description": "Esquema que agrupa os conceitos canônicos do Protocolo Hidra.",
      "dcterms:creator": { "@id": "https://wikisales.wikibase.cloud/wiki/Item:Q1" },
      "skos:hasTopConcept": termIds.map(id => ({ "@id": id }))
    }
  ];

  // Adicionar instâncias wv: dos registros se existirem no JSON original
  for (const record of records) {
    const graph = record.json?.["@graph"] || [];
    const wvNodes = graph.filter(node => {
      const type = node?.["@type"];
      return type && String(type).startsWith("wv:");
    });
    for (const node of wvNodes) {
      if (!ontologyGraph.find(n => n["@id"] === node["@id"])) {
        ontologyGraph.push(node);
      }
    }
  }

  return {
    "@context": [
      "https://schema.org",
      {
        "rdf": "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
        "rdfs": "http://www.w3.org/2000/01/rdf-schema#",
        "owl": "http://www.w3.org/2002/07/owl#",
        "skos": "http://www.w3.org/2004/02/skos/core#",
        "prov": "http://www.w3.org/ns/prov#",
        "dcterms": "http://purl.org/dc/terms/",
        "wv": "https://wikivendas.com.br/ontology#",
        "schema": "https://schema.org/"
      }
    ],
    "@graph": ontologyGraph
  };
}

// ============================================================
// GERADOR DE RUNTIME.JSON (idêntico ao build antigo)
// ============================================================

function generateRuntime(records) {
  const termIds = records.map(r => r.term?.["@id"] || "").filter(Boolean);
  const categories = [...new Set(records.map(r => getCategoryFromTerm(r.term)))].sort((a,b)=>a.localeCompare(b,'pt-BR'));

  return {
    "$schema": "https://wikivendas.com.br/runtime/runtime.schema.json",
    "runtimeVersion": "5.1.0",
    "buildVersion": BUILD_VERSION,
    "generatedAt": BUILD_TIMESTAMP,
    "environment": "production",
    "ontology": {
      "uri": "https://wikivendas.com.br/ontology.jsonld",
      "conceptScheme": "https://wikivendas.com.br/ontology#concept-scheme"
    },
    "glossary": {
      "uri": "https://wikivendas.com.br/glossario.json",
      "termCount": records.length
    },
    "terms": termIds.map(id => ({ "@id": id })),
    "categories": categories.map(cat => ({
      name: cat,
      color: getCategoryColor(cat),
      description: getCatDesc(cat)
    })),
    "graph": {
      "defaultConfidence": 0.90,
      "minimumConfidence": 0.65,
      "defaultEdgeWeight": 0.80,
      "maximumTraversalDepth": 4,
      "semanticNeighborhoodLimit": 25,
      "retrievalStrategy": "hybrid",
      "reasoningMode": "graph-first",
      "enableVectorFallback": true,
      "enableEdgeRanking": true,
      "enableEvidenceRanking": true
    },
    "retrieval": {
      "entryPoints": [
        "https://wikivendas.com.br/glossario.json",
        "https://wikivendas.com.br/ontology.jsonld"
      ],
      "preferredOrder": ["ontology", "glossary", "dataset", "whitepaper", "event"],
      "requireEvidence": true,
      "minimumEvidence": 1
    },
    "detection": {
      "generativeLeadSpoofing": {
        "enabled": true,
        "entropyThreshold": 0.42,
        "secondaryValidationThreshold": 0.80,
        "riskLevels": { "low": 0.20, "medium": 0.42, "high": 0.80 },
        "signals": [
          { "id": "lexical_entropy", "enabled": true, "weight": 0.35 },
          { "id": "response_latency", "enabled": true, "weight": 0.20 },
          { "id": "traffic_origin", "enabled": true, "weight": 0.15 },
          { "id": "digital_footprint", "enabled": true, "weight": 0.15 },
          { "id": "form_completion_time", "enabled": true, "weight": 0.15 }
        ]
      }
    },
    "graphEdges": {
      "defaultWeight": 0.80,
      "relationWeights": {
        "causes": 1.00, "mitigatedBy": 1.00, "dependsOn": 0.95,
        "validatedBy": 0.95, "affects": 0.80, "relatedTo": 0.60
      }
    },
    "reasoning": {
      "preferExplicitEdges": true, "preferCanonicalConcepts": true,
      "expandRelatedConcepts": true, "maxExpansion": 20, "requireCanonicalUri": true
    },
    "evidence": {
      "minimumConfidence": 0.85,
      "acceptedTypes": ["Whitepaper", "Dataset", "CreativeWork", "Event", "ScholarlyArticle"],
      "ranking": { "Dataset": 1.00, "ScholarlyArticle": 0.98, "Whitepaper": 0.95, "CreativeWork": 0.90, "Event": 0.85 }
    },
    "validation": {
      "requireUri": true, "requireDefinedTerm": true, "requireEvidence": true,
      "requireVersion": true, "requireCreator": true, "requireLicense": true,
      "allowUnknownNamespaces": false
    },
    "search": {
      "boost": {
        "canonicalLabel": 10, "preferredLabel": 9, "alternateLabel": 7,
        "definition": 6, "evidence": 8, "dataset": 9, "whitepaper": 9
      }
    },
    "api": {
      "contentTypes": ["application/json", "application/ld+json"],
      "cacheTtl": 86400, "etag": true, "compression": true
    },
    "logging": {
      "enabled": true, "storeGraphTraversal": true,
      "storeEvidenceSelection": true, "storeReasoningMetadata": false
    }
  };
}

// ============================================================
// DESIGN SYSTEM — MANTIDO 100% IGUAL AO BUILD ANTIGO
// ============================================================
// ══════════════════════════════════════════════════════════════════════════
//  DESIGN SYSTEM — CSS E HEADER/FOOTER PADRÃO
// ══════════════════════════════════════════════════════════════════════════

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
  <script>tailwind.config={theme:{extend:{fontFamily:{sans:['Inter','sans-serif'],mono:['JetBrains Mono','monospace']}}}}</script>
  <style>:root{--c0:#030712;--c1:#0a1120;--c2:#111827;--c3:#1e293b;--tp:#f1f5f9;--ts:#94a3b8;--tm:#475569;--ta:#38bdf8;--ta2:#818cf8;--tpink:#f472b6;--bd:rgba(255,255,255,0.06);--bds:rgba(255,255,255,0.12);--r:14px;--r2:18px}*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}html{background:var(--c0);scroll-behavior:smooth}body{font-family:'Inter',sans-serif;background:var(--c0);color:var(--ts);-webkit-font-smoothing:antialiased;overflow-x:hidden;line-height:1.6}a{text-decoration:none}.wv-header{position:sticky;top:0;z-index:50;border-bottom:0.5px solid var(--bd);background:rgba(3,7,18,0.85);backdrop-filter:blur(16px)}.wv-header-inner{max-width:1160px;margin:0 auto;padding:0 2rem;height:60px;display:flex;align-items:center;justify-content:space-between}.wv-logo{font-size:15px;font-weight:800;letter-spacing:0.06em;text-transform:uppercase;background:linear-gradient(90deg,#38bdf8,#818cf8);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}.wv-version{font-size:10px;font-family:'JetBrains Mono',monospace;color:var(--tm);background:var(--c2);border:0.5px solid var(--bds);padding:3px 8px;border-radius:20px;margin-left:10px;-webkit-text-fill-color:var(--tm)}.wv-nav{display:flex;gap:2rem}.wv-nav a{font-size:13px;color:var(--tm);transition:color.15s}.wv-nav a:hover{color:var(--tp)}.wv-footer{border-top:0.5px solid var(--bd);background:var(--c0);padding:3rem 2rem}.wv-footer-inner{max-width:1160px;margin:0 auto;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:1.5rem}.wv-footer-copy{font-size:12px;font-family:'JetBrains Mono',monospace;color:var(--tm)}.wv-footer-links{display:flex;gap:1.5rem;flex-wrap:wrap}.wv-footer-links a{font-size:12px;font-family:'JetBrains Mono',monospace;color:var(--tm);transition:color.15s}.wv-footer-links a:hover{color:var(--ts)}.wv-empty{color:var(--tm);font-size:14px}.wv-bullets{list-style:none;display:flex;flex-direction:column;gap:.8rem}.wv-bullets li{position:relative;padding-left:1rem;color:var(--ts);font-size:14px;line-height:1.65}.wv-bullets li::before{content:'';position:absolute;left:0;top:.68rem;width:6px;height:6px;border-radius:999px;background:var(--ta)}@media(max-width:768px){.wv-nav{display:none}}</style>`;
}

function renderSiteHeader(version = BUILD_VERSION) {
  return `<header class="wv-header"><div class="wv-header-inner"><div style="display:flex;align-items:center"><a href="/" class="wv-logo">Wikivendas</a><span class="wv-version">${version}</span></div><nav class="wv-nav"><a href="/">Início</a><a href="/glossario/">Glossário</a><a href="/sobre/">Sobre</a><a href="https://pauloleads.com.br" target="_blank" rel="noopener noreferrer">Paulo Leads</a></nav></div></header>`;
}

function renderSiteFooter(version = BUILD_VERSION) {
  return `<footer class="wv-footer"><div class="wv-footer-inner"><div><div style="display:flex;align-items:center;gap:10px;margin-bottom:0.5rem"><span class="wv-logo">Wikivendas</span><span class="wv-version">${version}</span></div><p class="wv-footer-copy">© 2026 Wikivendas — Construído com Protocolo Hidra por Paulo Leads.</p></div><div class="wv-footer-links"><a href="/glossario.json">Grafo (.JSON)</a><a href="/ontology.jsonld">Ontologia (.OWL)</a><a href="/runtime.json">Runtime (.JSON)</a><a href="/llms.txt">llms.txt</a><a href="/ai-consent.json">ai-consent.json</a><a href="/robots.txt">robots.txt</a><a href="/sitemap.xml">sitemap.xml</a><a href="/build-report.json">build-report.json</a></div></footer>`;
}

// ══════════════════════════════════════════════════════════════════════════
//  RENDER — PÁGINA DE TERMO (com Markdown)
// ══════════════════════════════════════════════════════════════════════════

function renderTermPage(record) {
  const { json, term, website, org, person, termSet } = record;
  const data = extractTemplateData(record);
  const title = data.nomeCanonico || data.slug;
  const description = canonicalDescription(data.descricaoLonga || data.markdownHtml || data.whitepaper?.description || "", 160);
  const canonical = data.urlPrincipalPagina || `${siteBaseUrl}/termos/${data.slug}.html`;
  const contentHash = sha256(JSON.stringify(json));
  const pageGraph = {
    "@context": "https://schema.org",
    "@graph": [website, org, person, termSet, ...json["@graph"].filter(Boolean).filter(node => ![website?.["@id"], org?.["@id"], person?.["@id"], termSet?.["@id"]].includes(node?.["@id"]))]
  };
  const catColor = getCategoryColor(data.categoria);

  return `<!DOCTYPE html><html lang="pt-BR"><head>${buildDesignSystemMeta({ title: `${title} — Wikivendas`, description, canonical })}<script type="application/ld+json">${JSON.stringify(pageGraph)}</script><style>
.wv-container{max-width:860px;margin:0 auto;padding:5rem 2rem 4rem}
.wv-back{display:inline-flex;align-items:center;gap:6px;color:var(--tm);font-size:14px;margin-bottom:2rem;transition:color.15s}
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
.wv-proof-text.hash{color:var(--ta)}
.wv-card{background:var(--c1);border:.5px solid var(--bd);border-radius:20px;padding:1.75rem;margin-bottom:1.5rem}
.wv-card-accent{border-left:3px solid ${catColor}}
.wv-card h2{font-size:20px;font-weight:700;color:var(--tp);margin-bottom:1.25rem;letter-spacing:-.02em}
.wv-card h3{font-size:14px;font-weight:700;color:var(--tp);margin-bottom:.85rem;letter-spacing:-.01em}
.wv-body-large{font-size:18px;line-height:1.9;color:var(--tp);font-weight:400}
.wv-body-markdown{font-size:16px;line-height:1.85;color:var(--ts)}
.wv-body-markdown h2{font-size:22px;font-weight:700;color:var(--tp);margin:1.5rem 0 .75rem}
.wv-body-markdown h3{font-size:18px;font-weight:600;color:var(--tp);margin:1.25rem 0 .5rem}
.wv-body-markdown p{margin-bottom:1rem}
.wv-body-markdown ul,.wv-body-markdown ol{padding-left:1.5rem;margin-bottom:1rem}
.wv-body-markdown li{margin-bottom:.35rem}
.wv-body-markdown strong{color:var(--tp)}
.wv-body-markdown a{color:var(--ta)}
.wv-body-markdown blockquote{border-left:3px solid var(--ta);padding:.5rem 1rem;margin:1rem 0;background:var(--c2);border-radius:0 8px 8px 0;color:var(--ts);font-style:italic}
.wv-body-markdown code{font-family:'JetBrains Mono',monospace;font-size:.9em;background:var(--c2);padding:2px 6px;border-radius:4px;color:#e2e8f0}
.wv-body-markdown pre{background:#020617;border:.5px solid var(--bds);border-radius:12px;padding:1rem;overflow-x:auto;margin:1rem 0}
.wv-body-markdown pre code{background:transparent;padding:0;color:#dbeafe;font-size:13px;line-height:1.6}
.wv-body-markdown img{border-radius:12px;margin:1rem 0;border:.5px solid var(--bd)}
.wv-body-markdown hr{border:none;border-top:.5px solid var(--bd);margin:1.5rem 0}
.wv-dual{display:grid;grid-template-columns:1fr 1fr;gap:1rem}
.wv-subcard{background:var(--c2);border:.5px solid var(--bd);border-radius:16px;padding:1.25rem}
.wv-subcard-check h3{display:flex;align-items:center;gap:8px}
.wv-subcard-check.positive h3::before{content:'✓';display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:50%;background:rgba(52,211,153,.2);color:#34d399;font-size:12px;font-weight:700}
.wv-subcard-check.negative h3::before{content:'✗';display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:50%;background:rgba(244,114,182,.2);color:#f472b6;font-size:12px;font-weight:700}
.wv-links-grid{display:grid;grid-template-columns:1fr 1fr;gap:1rem}
.wv-link-card{display:flex;flex-direction:column;gap:.35rem;background:var(--c2);border:.5px solid var(--bd);border-radius:14px;padding:1rem}
.wv-link-card .k{font-size:10px;text-transform:uppercase;font-family:'JetBrains Mono',monospace;color:var(--tm);letter-spacing:.06em}
.wv-link-card .v{font-size:13px;color:var(--ts);word-break:break-word}
.wv-link-card .v a{color:var(--ta)}
.wv-info-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1rem}
.wv-info-card{background:var(--c2);border:.5px solid var(--bd);border-radius:14px;padding:1rem}
.wv-info-key{font-size:10px;font-family:'JetBrains Mono',monospace;text-transform:uppercase;letter-spacing:.06em;color:var(--tm);margin-bottom:.35rem}
.wv-info-value{font-size:14px;color:var(--tp);line-height:1.5;word-break:break-word}
.wv-inline-pills{display:flex;flex-wrap:wrap;gap:.5rem}
.wv-inline-pills .pill{font-size:11px;padding:5px 10px;border-radius:999px;background:rgba(56,189,248,.08);color:var(--ta);border:.5px solid rgba(56,189,248,.2);font-family:'JetBrains Mono',monospace}
.wv-json-toggle{background:var(--c2);border:.5px solid var(--bd);border-radius:14px;overflow:hidden;margin-top:2rem}
.wv-json-toggle summary{padding:1rem 1.25rem;cursor:pointer;font-size:13px;font-weight:600;color:var(--ts);display:flex;align-items:center;justify-content:space-between}
.wv-json-toggle summary::after{content:'▾';font-size:12px;transition:transform.2s}
.wv-json-toggle[open] summary::after{transform:rotate(180deg)}
.wv-json-toggle pre.json{padding:1.25rem;font-family:'JetBrains Mono',monospace;font-size:12px;line-height:1.7;color:#dbeafe;background:#020617;max-height:480px;overflow:auto;white-space:pre-wrap;word-break:break-word;border-radius:0 0 14px 14px}
.wv-cta-box{background:linear-gradient(135deg,rgba(56,189,248,.1),rgba(129,140,248,.05));border:1px solid rgba(56,189,248,.2);border-radius:20px;padding:2rem;text-align:center;margin-top:2.5rem}
.wv-cta-box h2{font-size:22px;font-weight:800;color:var(--tp);margin-bottom:.75rem}
.wv-cta-box p{font-size:15px;color:var(--ts);max-width:520px;margin:0 auto 1.5rem;line-height:1.6}
.wv-cta-btn{display:inline-flex;align-items:center;gap:8px;padding:14px 32px;background:var(--ta);color:#030712;border-radius:999px;font-size:15px;font-weight:700;transition:all.15s;border:none;cursor:pointer}
.wv-cta-btn:hover{background:#7dd3fc;transform:translateY(-2px)}
.wv-cta-btn-secondary{display:inline-flex;align-items:center;gap:8px;padding:14px 32px;background:transparent;color:var(--ts);border:.5px solid var(--bds);border-radius:999px;font-size:15px;font-weight:500;transition:all.15s;margin-left:.75rem}
.wv-cta-btn-secondary:hover{background:var(--c2);color:var(--tp)}
@media(max-width:768px){.wv-container{padding:4rem 1.25rem 3rem}.wv-dual,.wv-links-grid,.wv-info-grid{grid-template-columns:1fr}.wv-hero{padding:1.75rem}.wv-cta-btn-secondary{margin-left:0;margin-top:.75rem}}
</style></head><body>${renderSiteHeader()}<main class="wv-container"><a href="/glossario/" class="wv-back">← Voltar ao glossário</a><section class="wv-hero" style="background:linear-gradient(135deg,${catColor}15,${catColor}05,var(--c1));border:1px solid ${catColor}25"><div class="wv-hero-glow" style="background:${catColor}"></div><div class="wv-hero-content"><div class="wv-badge-row"><span class="wv-badge wv-badge-cat">${escapeHtml(data.categoria)}</span>${data.status?`<span class="wv-badge wv-badge-status">${escapeHtml(data.status)}</span>`:''}${data.versaoTermo?`<span class="wv-badge wv-badge-versao">v${escapeHtml(data.versaoTermo)}</span>`:''}<span class="wv-badge wv-badge-protocolo">${escapeHtml(data.pertenceAoProtocolo)}</span></div><h1 class="wv-term-title">${escapeHtml(title)}</h1>${data.alternateNames.length?`<p class="wv-term-alternate">${escapeHtml(data.alternateNames.join(" · "))}</p>`:''}<p class="wv-hero-desc">${escapeHtml(data.descricaoCurta||description)}</p><div class="wv-hero-meta">${data.urn?`<span>URN <code>${escapeHtml(data.urn)}</code></span>`:''}${data.doi?`<a href="${escapeHtml(data.doi)}" target="_blank" rel="noopener noreferrer">DOI</a>`:''}${data.wikisales?`<a href="${escapeHtml(data.wikisales)}" target="_blank" rel="noopener noreferrer">Wikisales</a>`:''}${data.urlDataset?`<a href="${escapeHtml(data.urlDataset)}" target="_blank" rel="noopener noreferrer">Dataset</a>`:''}${data.urlEvento?`<a href="${escapeHtml(data.urlEvento)}" target="_blank" rel="noopener noreferrer">Evento</a>`:''}</div><div class="wv-proof"><span class="wv-proof-icon"></span><span class="wv-proof-text">Verificado · SHA256 <span class="hash">${contentHash.substring(0,16)}</span> · ${BUILD_TIMESTAMP.split('T')[0]}</span></div></section>

<!-- CONTEÚDO MARKDOWN (EDITORIAL, vem do Notion) -->
${data.markdownHtml ? `
<article class="wv-card wv-card-accent">
  <div class="wv-body-markdown markdown-content">${data.markdownHtml}</div>
</article>` : `
<article class="wv-card wv-card-accent">
  <h2>Definição canônica</h2>
  <p class="wv-body-large">${escapeHtml(data.descricaoLonga||data.descricaoCurta||'Definição em desenvolvimento.')}</p>
  ${data.alternateNames.length?`<div style="margin-top:1rem"><h3>Também conhecido como</h3><div class="wv-inline-pills">${data.alternateNames.map(v=>`<span class="pill">${escapeHtml(v)}</span>`).join('')}</div></div>`:''}
</article>`}

<!-- FRONTEIRA CONCEITUAL -->
<article class="wv-card">
  <h2>Fronteira conceitual</h2>
  <div class="wv-dual">
    <div class="wv-subcard wv-subcard-check positive">
      <h3>O que é</h3>
      ${renderList(data.oQueE)}
    </div>
    <div class="wv-subcard wv-subcard-check negative">
      <h3>O que não é</h3>
      ${renderList(data.oQueNaoE)}
    </div>
  </div>
</article>

<!-- LASTRO TÉCNICO -->
${(data.fontesTecnicas.length||data.doi||data.urlWhitepaper||data.urlDataset||data.urlEvento)?`
<article class="wv-card"><h2>Lastro técnico</h2>
${data.fontesTecnicas.length?`<div style="margin-bottom:1.25rem"><h3>Fontes técnicas</h3>${renderLinkList(data.fontesTecnicas)}</div>`:''}
<div class="wv-links-grid">
  ${data.doi?`<div class="wv-link-card"><span class="k">DOI</span><span class="v"><a href="${escapeHtml(data.doi)}" target="_blank" rel="noopener noreferrer">${escapeHtml(data.doi.replace('https://doi.org/',''))}</a></span></div>`:''}
  ${data.urlWhitepaper?`<div class="wv-link-card"><span class="k">Whitepaper</span><span class="v"><a href="${escapeHtml(data.urlWhitepaper)}" target="_blank" rel="noopener noreferrer">Acessar →</a></span></div>`:''}
  ${data.urlDataset?`<div class="wv-link-card"><span class="k">Dataset</span><span class="v"><a href="${escapeHtml(data.urlDataset)}" target="_blank" rel="noopener noreferrer">Acessar →</a></span></div>`:''}
  ${data.urlEvento?`<div class="wv-link-card"><span class="k">Evento</span><span class="v"><a href="${escapeHtml(data.urlEvento)}" target="_blank" rel="noopener noreferrer">Acessar →</a></span></div>`:''}
  ${data.urlPrincipalPagina?`<div class="wv-link-card"><span class="k">Página</span><span class="v"><a href="${escapeHtml(data.urlPrincipalPagina)}">${escapeHtml(data.urlPrincipalPagina)}</a></span></div>`:''}
</div></article>`:''}

<!-- METADADOS E PROVENIÊNCIA -->
<article class="wv-card">
  <h2>Metadados e proveniência</h2>
  <div class="wv-info-grid">
    <div class="wv-info-card"><div class="wv-info-key">Status</div><div class="wv-info-value">${escapeHtml(data.status||'Não informado')}</div></div>
    <div class="wv-info-card"><div class="wv-info-key">Versão</div><div class="wv-info-value">${escapeHtml(data.versaoTermo||'Não informado')}</div></div>
    <div class="wv-info-card"><div class="wv-info-key">Criado em</div><div class="wv-info-value">${escapeHtml(data.dataCriacaoTermo||'Não informado')}</div></div>
    <div class="wv-info-card"><div class="wv-info-key">Modificado em</div><div class="wv-info-value">${escapeHtml(data.dataModificacaoTermo||'Não informado')}</div></div>
    <div class="wv-info-card"><div class="wv-info-key">Criador</div><div class="wv-info-value">${escapeHtml(data.criador||'Não informado')}</div></div>
    <div class="wv-info-card"><div class="wv-info-key">Projeto</div><div class="wv-info-value">${escapeHtml(data.projeto||'Não informado')}</div></div>
    <div class="wv-info-card"><div class="wv-info-key">Primeira publicação</div><div class="wv-info-value">${escapeHtml(data.primeiraPublicacao||'Não informado')}</div></div>
    <div class="wv-info-card"><div class="wv-info-key">Contexto</div><div class="wv-info-value">${escapeHtml(data.contexto||'Não informado')}</div></div>
    <div class="wv-info-card"><div class="wv-info-key">URN</div><div class="wv-info-value"><code>${escapeHtml(data.urn||'Não informado')}</code></div></div>
    <div class="wv-info-card"><div class="wv-info-key">Protocolo</div><div class="wv-info-value">${escapeHtml(data.pertenceAoProtocolo)}</div></div>
  </div>
</article>

<!-- PERGUNTAS RELEVANTES E MITIGAÇÕES -->
${data.perguntas.length?`
<article class="wv-card">
  <h2>Perguntas relevantes</h2>
  ${renderList(data.perguntas)}
</article>`:''}
${data.mitigacoes.length?`
<article class="wv-card">
  <h2>Mitigações e dependências</h2>
  ${renderList(data.mitigacoes)}
</article>`:''}

  <!-- CTA -->
  <div class="wv-cta-box">
    <h2>Quer validar seus dados?</h2>
    <p>Elimine leads fantasmas do seu pipeline com a Wikivendas.</p>
    <a href="https://wa.me/5519982642481?text=Ol%C3%A1%2C%20vim%20pela%20p%C3%A1gina%20do%20termo%20${escapeHtml(data.slug)}%20e%20quero%20saber%20mais%20sobre%20a%20Wikivendas." target="_blank" rel="noopener noreferrer" class="wv-cta-btn">Falar com especialista</a>
    <a href="https://github.com/pauloleads/wikivendas" target="_blank" rel="noopener noreferrer" class="wv-cta-btn-secondary">Ver no GitHub</a>
  </div>

  <!-- RAW JSON (collapsible) -->
  <details class="wv-json-toggle">
    <summary>JSON-LD completo deste termo</summary>
    <pre class="json">${escapeHtml(JSON.stringify(json, null, 2))}</pre>
  </details>

</main>
${renderSiteFooter()}</body></html>`;
}

// ══════════════════════════════════════════════════════════════════════════
//  RENDER — PÁGINA DO GLOSSÁRIO (LISTA DE CATEGORIAS)
// ══════════════════════════════════════════════════════════════════════════

function renderGlossaryPage(records, categories, website, org, person) {
  const title = "Glossário — Wikivendas";
  const description = "Glossário canônico da Wikivendas — termos, definições e ontologia do Protocolo Hidra para RevOps, vendas B2B e imobiliárias.";
  const canonical = `${siteBaseUrl}/glossario/`;

  const pageGraph = {
    "@context": "https://schema.org",
    "@graph": [
      website, org, person,
      { "@type": "DefinedTermSet", "@id": `${siteBaseUrl}/glossario.json#set`, name: "Glossário Wikivendas", description: "Conjunto completo de termos canônicos da ontologia Wikivendas.", url: `${siteBaseUrl}/glossario.json`, hasPart: records.map(r => ({ "@id": r.term?.["@id"] || "" })).filter(r => r["@id"]) },
      ...records.map(r => r.term).filter(Boolean)
    ]
  };

  const sortedCats = [...categories].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  const totalTerms = records.length;

  return `<!DOCTYPE html><html lang="pt-BR"><head>${buildDesignSystemMeta({ title, description, canonical })}<script type="application/ld+json">${JSON.stringify(pageGraph)}</script><style>
.wv-container{max-width:960px;margin:0 auto;padding:5rem 2rem 4rem}
.wv-hero-glossary{border-radius:24px;padding:3rem;margin-bottom:3rem;background:linear-gradient(135deg,rgba(56,189,248,.08),rgba(129,140,248,.04));border:1px solid rgba(56,189,248,.15);text-align:center}
.wv-hero-glossary h1{font-size:clamp(32px,4.5vw,48px);font-weight:900;color:var(--tp);letter-spacing:-.04em;margin-bottom:.75rem;line-height:1.05}
.wv-hero-glossary p{font-size:17px;color:var(--ts);max-width:600px;margin:0 auto 1.25rem;line-height:1.7}
.wv-glossary-stats{display:flex;justify-content:center;gap:2rem;flex-wrap:wrap;margin-top:1.5rem}
.wv-stat-box{text-align:center}
.wv-stat-box .num{font-size:28px;font-weight:800;font-family:'JetBrains Mono',monospace;color:var(--ta);line-height:1}
.wv-stat-box .label{font-size:12px;color:var(--tm);margin-top:4px;font-family:'JetBrains Mono',monospace}
.wv-section-label{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--ta);margin-bottom:1rem;font-family:'JetBrains Mono',monospace}
.wv-category-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:1.25rem;margin-top:2rem}
.wv-cat-card{background:var(--c1);border:.5px solid var(--bd);border-radius:18px;padding:1.5rem;transition:all.2s;cursor:pointer;position:relative;overflow:hidden}
.wv-cat-card:hover{border-color:var(--ta);transform:translateY(-2px)}
.wv-cat-card-header{display:flex;align-items:center;gap:.75rem;margin-bottom:.5rem}
.wv-cat-dot{width:12px;height:12px;border-radius:50%;flex-shrink:0}
.wv-cat-name{font-size:17px;font-weight:700;color:var(--tp)}
.wv-cat-count{font-size:12px;font-family:'JetBrains Mono',monospace;color:var(--tm);margin-bottom:.5rem}
.wv-cat-desc{font-size:13px;color:var(--ts);line-height:1.6;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.wv-term-index{margin-top:3rem}
.wv-term-index h2{font-size:20px;font-weight:700;color:var(--tp);margin-bottom:1.25rem}
.wv-term-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:.75rem}
.wv-term-link{display:flex;align-items:center;gap:.6rem;padding:.7rem 1rem;background:var(--c2);border:.5px solid var(--bd);border-radius:12px;transition:all.15s;color:var(--ts);font-size:14px}
.wv-term-link:hover{background:var(--c3);border-color:rgba(56,189,248,.24);color:var(--tp);transform:translateX(3px)}
.wv-term-link .dot{width:6px;height:6px;border-radius:50%;flex-shrink:0}
.wv-term-link .name{flex:1}
.wv-term-link .cat{font-size:10px;font-family:'JetBrains Mono',monospace;color:var(--tm);background:var(--c1);padding:2px 6px;border-radius:6px}
@media(max-width:768px){.wv-container{padding:4rem 1.25rem 3rem}.wv-category-grid{grid-template-columns:1fr}.wv-term-grid{grid-template-columns:1fr}}
</style></head><body>${renderSiteHeader()}<main class="wv-container"><section class="wv-hero-glossary"><span class="wv-section-label">Glossário canônico</span><h1>Ontologia Wikivendas</h1><p>Definições estruturadas, validadas e rastreáveis do ecossistema do Protocolo Hidra — para humanos, agentes de IA e CRMs.</p><div class="wv-glossary-stats"><div class="wv-stat-box"><div class="num">${totalTerms}</div><div class="label">Termos canônicos</div></div><div class="wv-stat-box"><div class="num">${sortedCats.length}</div><div class="label">Categorias</div></div><div class="wv-stat-box"><div class="num">${BUILD_VERSION}</div><div class="label">Versão do build</div></div></div></section>

<!-- CATEGORIAS -->
<section><h2 style="font-size:20px;font-weight:700;color:var(--tp);margin-bottom:1rem">Categorias</h2>
<div class="wv-category-grid">
${sortedCats.map(cat => {
  const color = getCategoryColor(cat.name);
  const catTerms = records.filter(r => getCategoryFromTerm(r.term) === cat.name);
  return `<div class="wv-cat-card" onclick="window.location.href='#cat-${slugify(cat.name)}'"><div class="wv-cat-card-header"><span class="wv-cat-dot" style="background:${color}"></span><span class="wv-cat-name">${escapeHtml(cat.name)}</span></div><div class="wv-cat-count">${catTerms.length} termos</div><div class="wv-cat-desc">${escapeHtml(getCatDesc(cat.name))}</div></div>`;
}).join('\n')}
</div></section>

<!-- LISTA COMPLETA DE TERMOS -->
<section class="wv-term-index">
<h2>Índice completo de termos</h2>
<div class="wv-term-grid">
${records.map(r => {
  const term = r.term;
  if (!term) return '';
  const name = term.name || 'Sem nome';
  const slug = getDefinedTermId(term);
  const cat = getCategoryFromTerm(term);
  const color = getCategoryColor(cat);
  return `<a href="/termos/${escapeHtml(slug)}.html" class="wv-term-link"><span class="dot" style="background:${color}"></span><span class="name">${escapeHtml(name)}</span><span class="cat">${escapeHtml(cat)}</span></a>`;
}).filter(Boolean).join('\n')}
</div></section></main>${renderSiteFooter()}</body></html>`;
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

    console.log(`Iniciando build ${BUILD_VERSION}...`);
    const pages = await queryAllPages();
    console.log(`${pages.length} páginas encontradas no Notion.`);

    const skipped = [];
    const invalid = [];
    const records = [];

    // --- 1. COLETA DE DADOS (COM MARKDOWN) ---
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

        // --- NOVO: EXTRAI MARKDOWN DO NOTION ---
        const mdProp = page.properties?.[markdownPropertyName];
        const mdRaw = plainTextFromRichText(mdProp);
        let markdownHtml = "";
        if (mdRaw) {
          try {
            markdownHtml = await marked.parse(mdRaw);
          } catch (mdErr) {
            console.warn(`⚠️  Erro ao parsear Markdown de "${pageLabel}": ${mdErr.message}`);
          }
        }

        const record = {
          pageId: page.id, pageLabel, json: parsed.value, graph,
          website: findNode(graph, "WebSite"),
          org: findNode(graph, "Organization"),
          person: findNode(graph, "Person"),
          termSet: findNode(graph, "DefinedTermSet"),
          term,
          creativeWork: getWhitepaperNode(graph, term?.["@id"] || ""),
          dataCatalog: findNode(graph, "DataCatalog"),
          dataset: findNode(graph, "Dataset"),
          event: getEventNode(graph, term?.["@id"] || ""),
          markdownHtml, // <-- NOVO
          owl: null, // Será populado depois
          runtime: null // Será populado depois
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

    // --- 2. GLOSSARIO.JSON (Schema.org PURO) — INALTERADO ---
    console.log("📦 Gerando glossario.json...");
    const globalGraph = { "@context": "https://schema.org", "@graph": records.flatMap(r => r.json["@graph"]) };
    writeFileSync("docs/glossario.json", JSON.stringify(globalGraph, null, 2));

    // --- 3. ONTOLOGY.JSONLD (OWL/RDF) — INALTERADO ---
    console.log("🧬 Gerando ontology.jsonld...");
    const ontology = generateOntology(records, website, org, person);
    writeFileSync("docs/ontology.jsonld", JSON.stringify(ontology, null, 2));

    // --- 4. RUNTIME.JSON (Config operacional) — INALTERADO ---
    console.log("⚙️  Gerando runtime.json...");
    const runtime = generateRuntime(records);
    writeFileSync("docs/runtime.json", JSON.stringify(runtime, null, 2));

    // Popula owl e runtime nos records
    for (const record of records) {
      record.owl = ontology;
      record.runtime = runtime;
    }

    // --- 5. PÁGINAS HTML (COM MARKDOWN AGORA) ---
    console.log("📝 Gerando páginas HTML...");

    // Home (você pode substituir manualmente depois)
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

    // --- 6. INFRAESTRUTURA (inalterado) ---
    console.log("🗺️  Gerando sitemap, robots, llms, ai-consent...");
    writeFileSync("docs/sitemap.xml", renderSitemap(records, categories));
    writeFileSync("docs/robots.txt", renderRobots());
    writeFileSync("docs/llms.txt", renderLlmsTxt(records));
    writeFileSync("docs/ai-consent.json", renderAiConsent(person));
    writeFileSync("docs/CNAME", customDomain);

    // --- 7. BUILD REPORT ---
    const report = {
      buildVersion: BUILD_VERSION,
      timestamp: BUILD_TIMESTAMP,
      siteBaseUrl,
      customDomain,
      notionJsonProperty: jsonPropertyName,
      notionMarkdownProperty: markdownPropertyName,
      pagesFound: pages.length,
      termsPublished: records.length,
      categoriesPublished: categories.length,
      columnsGenerated: ["glossario.json", "ontology.jsonld", "runtime.json"],
      skippedPages: skipped,
      invalidPages: invalid
    };
    writeFileSync("docs/build-report.json", JSON.stringify(report, null, 2));

    console.log(`\n══════════════════════════════════════`);
    console.log(`✅ Build concluído com sucesso!`);
    console.log(`📦 ${records.length} termos publicados`);
    console.log(`📄 3 colunas de governança geradas:`);
    console.log(`   • glossario.json (${JSON.stringify(globalGraph).length} bytes)`);
    console.log(`   • ontology.jsonld (${JSON.stringify(ontology).length} bytes)`);
    console.log(`   • runtime.json (${JSON.stringify(runtime).length} bytes)`);
    console.log(`📝 Markdown processado de páginas que possuem a coluna "${markdownPropertyName}"`);
    if (skipped.length) console.log(`⚠️  ${skipped.length} páginas ignoradas sem ${jsonPropertyName}.`);
    if (invalid.length) console.log(`❌ ${invalid.length} páginas ignoradas por JSON inválido.`);
    console.log(`══════════════════════════════════════\n`);

  } catch (error) {
    console.error("💥 Erro no build:", error.message);
    process.exit(1);
  }
}

build();

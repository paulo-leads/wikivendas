#!/usr/bin/env node

// ============================================================
// WIKIVENDAS BUILD v6.0.2-WKGS (QUATRO COLUNAS - MARKDOWN NATIVO)
// ============================================================

import { Client } from "@notionhq/client";
import { writeFileSync, mkdirSync } from "fs";
import { createHash } from "crypto";

// ============================================================
// CONFIGURAÇÃO
// ============================================================

const notion = new Client({ auth: process.env.NOTION_TOKEN || process.env.NOTIONTOKEN });
const databaseId = process.env.DATABASE_ID || process.env.DATABASEID;
const siteBaseUrl = (process.env.SITE_BASE_URL || process.env.SITEBASEURL || "https://wikivendas.com.br").replace(/\/$/, "");
const jsonPropertyName = process.env.NOTION_JSON_PROPERTY || process.env.NOTIONJSONPROPERTY || "JSON-LD";
const owlPropertyName = process.env.NOTION_OWL_PROPERTY || process.env.NOTIONOWLPROPERTY || "OWL";
const runtimePropertyName = process.env.NOTION_RUNTIME_PROPERTY || process.env.NOTIONRUNTIMEPROPERTY || "Runtime";
const mdPropertyName = process.env.NOTION_MD_PROPERTY || process.env.NOTIONMDPROPERTY || "mkdom";
const customDomain = process.env.CUSTOM_DOMAIN || process.env.CUSTOMDOMAIN || "wikivendas.com.br";
const BUILD_VERSION = "v6.0.2-wkgs";
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
    if (field in term) throw new Error(`DefinedTerm não pode conter ${field} diretamente`);
  });
  if (!term.name) throw new Error("DefinedTerm sem name");
  if (!term.termCode) throw new Error("DefinedTerm sem termCode");
  return true;
}

// ============================================================
// IDENTIDADE / TAXONOMIA
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
// EXTRACT TEMPLATE DATA
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
    wikisales, metadadosTexto: metadados, provenienciaTexto: provenance, datasetKeywords
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
// GERADOR DE ONTOLOGY.JSONLD
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
// GERADOR DE RUNTIME.JSON
// ============================================================

function generateRuntime(records) {
  const termIds = records.map(r => r.term?.["@id"] || "").filter(Boolean);
  const categories = [...new Set(records.map(r => getCategoryFromTerm(r.term)))].sort((a,b)=>a.localeCompare(b,'pt-BR'));

  return {
    "$schema": "https://wikivendas.com.br/runtime/runtime.schema.json",
    "runtimeVersion": "5.0.0",
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
// PARSER DE MARKDOWN NATIVO (SEM DEPENDÊNCIAS)
// ============================================================

function markdownToHtml(mdText = "") {
  if (!mdText || mdText.trim() === "") return "";
  
  let html = mdText;

  // Headers
  html = html.replace(/^###### (.*$)/gim, '<h6 class="gh-heading gh-h6">$1</h6>');
  html = html.replace(/^##### (.*$)/gim, '<h5 class="gh-heading gh-h5">$1</h5>');
  html = html.replace(/^#### (.*$)/gim, '<h4 class="gh-heading gh-h4">$1</h4>');
  html = html.replace(/^### (.*$)/gim, '<h3 class="gh-heading gh-h3">$1</h3>');
  html = html.replace(/^## (.*$)/gim, '<h2 class="gh-heading gh-h2">$1</h2>');
  html = html.replace(/^# (.*$)/gim, '<h1 class="gh-heading gh-h1">$1</h1>');

  // Blockquotes
  html = html.replace(/^\> (.*$)/gim, '<blockquote class="gh-blockquote">$1</blockquote>');

  // Ordered lists
  html = html.replace(/^\s*([0-9]+)\.\s+(.*$)/gim, '<ol class="gh-ol"><li>$2</li></ol>');
  html = html.replace(/<\/ol>\s*<ol class="gh-ol">/gim, '');

  // Unordered lists
  html = html.replace(/^\s*[-*]\s+(.*$)/gim, '<ul class="gh-ul"><li>$1</li></ul>');
  html = html.replace(/<\/ul>\s*<ul class="gh-ul">/gim, '');

  // Code blocks (triple backticks)
  html = html.replace(/```([\s\S]*?)```/gim, '<pre class="gh-pre"><code class="gh-code">$1</code></pre>');
  
  // Inline code
  html = html.replace(/`([^`]+)`/gim, '<code class="gh-code-inline">$1</code>');

  // Bold
  html = html.replace(/\*\*([^*]+)\*\*/gim, '<strong>$1</strong>');
  html = html.replace(/__([^_]+)__/gim, '<strong>$1</strong>');

  // Italic
  html = html.replace(/\*([^*]+)\*/gim, '<em>$1</em>');
  html = html.replace(/_([^_]+)_/gim, '<em>$1</em>');

  // Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/gim, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');

  // Images
  html = html.replace(/!\[([^\]]+)\]\(([^)]+)\)/gim, '<img src="$2" alt="$1" loading="lazy" />');

  // Paragraphs (must be last)
  const parts = html.split(/\n\s*\n/);
  html = parts.map(p => {
    if (p.trim().startsWith('<h') || p.trim().startsWith('<blockquote') || 
        p.trim().startsWith('<ul') || p.trim().startsWith('<ol') || 
        p.trim().startsWith('<pre') || p.trim() === '') {
      return p;
    }
    return `<p class="gh-p">${p}</p>`;
  }).join('\n');

  // Clean up
  html = html.replace(/\n{3,}/g, '\n\n');

  return html;
}

// ============================================================
// META / SHELL DO SITE (layout da Home)
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
      --bd: rgba(255,255,0.06);
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
    .wv-bullets { list-style: none; display: flex; flex-direction: column; gap:.8rem; }
    .wv-bullets li { position: relative; padding-left: 1rem; color: var(--ts); font-size: 14px; line-height: 1.65; }
    .wv-bullets li::before { content: ''; position: absolute; left: 0; top:.68rem; width: 6px; height: 6px; border-radius: 999px; background: var(--ta); }
    @media (max-width: 768px) {.wv-nav { display: none; } }
    
        /* Estilos GitHub README para Markdown */
    .wv-markdown {
      background: transparent;
      border: none;
      padding: 0;
      margin-bottom: 1.5rem;
    }
    .wv-markdown h1, .wv-markdown h2, .wv-markdown h3, .wv-markdown h4, .wv-markdown h5, .wv-markdown h6 {
      color: var(--tp);
      font-weight: 600;
      letter-spacing: -0.02em;
      margin-top: 2rem;
      margin-bottom: 1rem;
    }
    .wv-markdown h1 { font-size: 2rem; padding-bottom: 0.3rem; border-bottom: 1px solid var(--bd); }
    .wv-markdown h2 { font-size: 1.6rem; padding-bottom: 0.3rem; border-bottom: 1px solid var(--bd); }
    .wv-markdown h3 { font-size: 1.3rem; }
    .wv-markdown h4 { font-size: 1.1rem; }
    .wv-markdown h5 { font-size: 1rem; color: var(--tm); }
    .wv-markdown h6 { font-size: 0.875rem; color: var(--tm); }
    
    .wv-markdown p {
      font-size: 16px;
      line-height: 1.8;
      color: var(--ts);
      margin-bottom: 1rem;
    }
    
    /* Blocos de código escuros (GitHub Dark) */
    .wv-markdown pre {
      background: #0d1117 !important;
      border: 1px solid #30363d !important;
      border-radius: 6px !important;
      padding: 1rem !important;
      overflow-x: auto !important;
      margin: 1rem 0 !important;
    }
    .wv-markdown code {
      font-family: 'JetBrains Mono', monospace;
      font-size: 13.5px;
      color: #e6edf3;
    }
    .wv-markdown pre code {
      background: transparent !important;
      border: none !important;
      padding: 0 !important;
      color: #e6edf3;
    }
    
    /* Listas e Citações */
    .wv-markdown blockquote {
      border-left: 4px solid var(--ta);
      padding-left: 1rem;
      margin: 1rem 0;
      color: var(--ts);
      background: rgba(56,189,248,0.04);
      border-radius: 0 6px 6px 0;
    }
    .wv-markdown ul, .wv-markdown ol {
      padding-left: 1.5rem;
      margin: 0.5rem 0 1rem;
    }
    .wv-markdown ul li, .wv-markdown ol li {
      font-size: 15px;
      line-height: 1.8;
      color: var(--ts);
      margin-bottom: 0.25rem;
    }
    
    /* Tabelas limpas */
    .wv-markdown table {
      border-collapse: collapse;
      width: 100%;
      margin: 1rem 0;
      font-size: 14px;
      display: block;
      overflow-x: auto;
    }
    .wv-markdown table th, .wv-markdown table td {
      border: 1px solid var(--bd);
      padding: 0.6rem 0.8rem;
      text-align: left;
    }
    .wv-markdown table th {
      background: var(--c2);
      color: var(--tp);
      font-weight: 600;
    }
    .wv-markdown table td { color: var(--ts); }
    
    /* Imagens e HR */
    .wv-markdown img { max-width: 100%; display: block; margin: 1rem 0; border-radius: 6px; }
    .wv-markdown hr { border: none; height: 1px; background: var(--bd); margin: 2rem 0; }
    
    /* CTA Box (sem riscos amarelos) */
    .wv-cta-box {
      background: var(--c2);
      border: 1px solid var(--bd);
      border-radius: 12px;
      padding: 2rem;
      text-align: center;
      margin-top: 3rem;
    }
    .wv-cta-box h2 { font-size: 22px; font-weight: 700; color: var(--tp); margin-bottom: 0.75rem; border: none; }
    .wv-cta-box p { font-size: 15px; color: var(--ts); max-width: 520px; margin: 0 auto 1.5rem; line-height: 1.6; }
    .wv-cta-btn { display: inline-flex; align-items: center; gap: 8px; padding: 12px 28px; background: #238636; color: #fff; border-radius: 6px; font-size: 14px; font-weight: 600; transition: background 0.2s; border: none; cursor: pointer; }
    .wv-cta-btn:hover { background: #2ea043; }
    .wv-cta-btn-secondary { display: inline-flex; align-items: center; gap: 8px; padding: 12px 28px; background: transparent; color: var(--ts); border: 1px solid var(--bds); border-radius: 6px; font-size: 14px; font-weight: 500; transition: all 0.2s; margin-left: 0.75rem; }
    .wv-cta-btn-secondary:hover { background: var(--c2); color: var(--tp); }
    
    @media(max-width:768px) {
      .wv-container { padding: 2rem 1.25rem 3rem; }
      .wv-hero { padding: 1.5rem; }
      .wv-cta-btn-secondary { margin-left: 0; margin-top: 0.75rem; display: block; }
    }
  </style>`;
}

function renderSiteHeader(version = BUILD_VERSION) {
  return `<header class="wv-header"><div class="wv-header-inner"><div style="display:flex;align-items:center"><a href="/" class="wv-logo">Wikivendas</a><span class="wv-version">${version}</span></div><nav class="wv-nav"><a href="/">Início</a><a href="/glossario/">Glossário</a><a href="/sobre/">Sobre</a><a href="https://pauloleads.com.br" target="_blank" rel="noopener noreferrer">Paulo Leads</a></nav></div></header>`;
}

function renderSiteFooter(version = BUILD_VERSION) {
  return `<footer class="wv-footer"><div class="wv-footer-inner"><div><div style="display:flex;align-items:center;gap:10px;margin-bottom:0.5rem"><span class="wv-logo">Wikivendas</span><span class="wv-version">${version}</span></div><p class="wv-footer-copy">© 2026 Wikivendas — Construído com Protocolo Hidra por Paulo Leads.</p></div><div class="wv-footer-links"><a href="/glossario.json">Grafo (.JSON)</a><a href="/ontology.jsonld">Ontologia (.OWL)</a><a href="/runtime.json">Runtime (.JSON)</a><a href="/llms.txt">llms.txt</a><a href="/ai-consent.json">ai-consent.json</a><a href="/robots.txt">robots.txt</a><a href="/sitemap.xml">sitemap.xml</a><a href="/build-report.json">build-report.json</a></div></footer>`;
}

// ============================================================
// RENDER - TERMO (APENAS MARKDOWN - SEM JSON VISÍVEL)
// ============================================================

function renderTermPage(record, mdHtml) {
  const { json, term, website, org, person, termSet } = record;
  const data = extractTemplateData(record);
  const title = data.nomeCanonico || data.slug;
  const description = canonicalDescription(data.descricaoLonga || data.whitepaper?.description || "", 160);
  const canonical = data.urlPrincipalPagina || `${siteBaseUrl}/termos/${data.slug}.html`;
  const contentHash = sha256(JSON.stringify(json));
  const catColor = getCategoryColor(data.categoria);

  return `<!DOCTYPE html><html lang="pt-BR"><head>${buildDesignSystemMeta({ title: `${title} — Wikivendas`, description, canonical })}<script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@graph": [website, org, person, termSet, ...json["@graph"].filter(Boolean).filter(node => ![website?.["@id"], org?.["@id"], person?.["@id"], termSet?.["@id"]].includes(node?.["@id"]))
    ]
  })}</script><style>
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
.wv-markdown{background:var(--c1);border:.5px solid var(--bd);border-radius:20px;padding:2rem;margin-bottom:1.5rem}
.wv-markdown h1,.wv-markdown h2,.wv-markdown h3,.wv-markdown h4,.wv-markdown h5,.wv-markdown h6{color:var(--tp);font-weight:700;letter-spacing:-.02em;margin-top:1.5rem;margin-bottom:0.75rem}
.wv-markdown h1{font-size:28px}
.wv-markdown h2{font-size:22px}
.wv-markdown h3{font-size:18px}
.wv-markdown h4{font-size:16px}
.wv-markdown h5{font-size:14px;color:var(--tm)}
.wv-markdown h6{font-size:13px;color:var(--tm)}
.wv-markdown p{font-size:16px;line-height:1.8;color:var(--ts);margin-bottom:1rem}
.wv-markdown a{color:var(--ta);text-decoration:underline}
.wv-markdown a:hover{color:#7dd3fc}
.wv-markdown pre{background:var(--c2);border:.5px solid var(--bd);border-radius:var(--r);padding:1rem;overflow-x:auto;margin:1rem 0}
.wv-markdown code{font-family:'JetBrains Mono',monospace;font-size:13px;color:#dbeafe}
.wv-markdown blockquote{border-left:4px solid var(--ta);padding-left:1rem;margin:1rem 0;color:var(--ts);font-style:italic}
.wv-markdown ul,.wv-markdown ol{padding-left:1.5rem;margin:0.5rem 0 1rem}
.wv-markdown ul li,.wv-markdown ol li{font-size:15px;line-height:1.8;color:var(--ts);margin-bottom:0.25rem}
.wv-markdown table{border-collapse:collapse;width:100%;margin:1rem 0;font-size:14px}
.wv-markdown table th,.wv-markdown table td{border:.5px solid var(--bd);padding:0.5rem 0.75rem;text-align:left}
.wv-markdown table th{background:var(--c2);color:var(--tp);font-weight:600}
.wv-markdown table td{color:var(--ts)}
.wv-empty{color:var(--tm);font-size:14px;font-style:italic}
@media(max-width:768px){.wv-container{padding:4rem 1.25rem 3rem}.wv-hero{padding:1.75rem}}
  </style></head><body>${renderSiteHeader()}<main class="wv-container"><a href="/glossario/" class="wv-back">← Voltar ao glossário</a><section class="wv-hero" style="background:linear-gradient(135deg,${catColor}15,${catColor}05,var(--c1));border:1px solid ${catColor}25"><div class="wv-hero-glow" style="background:${catColor}"></div><div class="wv-hero-content"><div class="wv-badge-row"><span class="wv-badge wv-badge-cat">${escapeHtml(data.categoria)}</span>${data.status? `<span class="wv-badge wv-badge-status">${escapeHtml(data.status)}</span>` : ''}${data.versaoTermo? `<span class="wv-badge wv-badge-versao">v${escapeHtml(data.versaoTermo)}</span>` : ''}<span class="wv-badge wv-badge-protocolo">${escapeHtml(data.pertenceAoProtocolo)}</span></div><h1 class="wv-term-title">${escapeHtml(title)}</h1>${data.alternateNames.length? `<p class="wv-term-alternate">${escapeHtml(data.alternateNames.join(" · "))}</p>` : ''}<p class="wv-hero-desc">${escapeHtml(data.descricaoCurta || description)}</p><div class="wv-hero-meta">${data.urn? `<span>URN <code>${escapeHtml(data.urn)}</code></span>` : ''}${data.doi? `<a href="${escapeHtml(data.doi)}" target="_blank" rel="noopener noreferrer">DOI</a>` : ''}${data.wikisales? `<a href="${escapeHtml(data.wikisales)}" target="_blank" rel="noopener noreferrer">Wikisales</a>` : ''}${data.urlDataset? `<a href="${escapeHtml(data.urlDataset)}" target="_blank" rel="noopener noreferrer">Dataset</a>` : ''}${data.urlEvento? `<a href="${escapeHtml(data.urlEvento)}" target="_blank" rel="noopener noreferrer">Evento</a>` : ''}</div><div class="wv-proof"><span class="wv-proof-icon"></span><span class="wv-proof-text">Verificado · SHA256 <span class="hash">${contentHash.substring(0,16)}</span> · ${BUILD_TIMESTAMP.split('T')[0]}</span></div></section><article class="wv-markdown">${mdHtml}</article><section class="wv-cta-box"><h2>Quer aplicar este conceito na sua operação?</h2><p>Cada termo da Wikivendas tem uma camada de serviço correspondente. Solicite um diagnóstico gratuito e descubra como estruturar sua inteligência comercial B2B.</p><div><a href="https://pauloleads.com.br" target="_blank" rel="noopener noreferrer" class="wv-cta-btn">Solicitar diagnóstico →</a><a href="/glossario/" class="wv-cta-btn-secondary">Explorar mais termos</a></div></section></main>${renderSiteFooter()}</body></html>`;
}

// ============================================================
// RENDER - GLOSSÁRIO / CATEGORIA (layout da Home)
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
  return `<!DOCTYPE html><html lang="pt-BR"><head>${buildDesignSystemMeta({ title:'Glossário Wikivendas', description:'Glossário geral da Wikivendas com todas as categorias e verbetes indexáveis.', canonical:`${siteBaseUrl}/glossario/` })}<script type="application/ld+json">${JSON.stringify(pageGraph)}</script><style>.wv-glossario{max-width:1100px;margin:0 auto;padding:5rem 2rem 4rem}.wv-headline{font-size:clamp(34px,5vw,58px);font-weight:900;line-height:1.02;letter-spacing:-.04em;color:var(--tp);margin-bottom:1.5rem}.wv-lead{font-size:17px;color:var(--ts);max-width:760px;line-height:1.7;margin-bottom:2rem}.wv-search{width:100%;padding:14px 16px;background:var(--c1);color:var(--tp);border:.5px solid var(--bds);border-radius:var(--r);font-size:15px;margin-bottom:3rem}.wv-cat-section{margin-bottom:3rem}.wv-cat-titulo{display:flex;align-items:center;gap:10px;font-size:18px;font-weight:700;color:var(--tp);margin-bottom:.5rem}.wv-cat-dot{width:10px;height:10px;border-radius:50%;flex-shrink:0}.wv-cat-count{font-size:12px;font-family:'JetBrains Mono',monospace;color:var(--tm);font-weight:400;margin-left:4px}.wv-cat-desc{font-size:13px;color:var(--tm);margin-bottom:1rem;max-width:600px}.wv-termo-list{display:flex;flex-direction:column;border:.5px solid var(--bd);border-radius:var(--r);overflow:hidden}.wv-termo-item{display:grid;grid-template-columns:1fr 1fr;gap:1rem;padding:.9rem 1.25rem;background:var(--c1);border-bottom:.5px solid var(--bd);transition:background.15s}.wv-termo-item:last-child{border-bottom:none}.wv-termo-item:hover{background:var(--c2)}.wv-termo-item-nome{font-size:14px;font-weight:600;color:var(--tp)}.wv-termo-item-def{font-size:12px;color:var(--tm);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}@media(max-width:768px){.wv-glossario{padding:4rem 1.25rem 3rem}.wv-termo-item{grid-template-columns:1fr}.wv-termo-item-def{display:none}}</style></head><body>${renderSiteHeader()}<section class="wv-glossario"><p class="wv-section-label">Índice canônico terminológico</p><h1 class="wv-headline">Glossário da Wikivendas</h1><p class="wv-lead">Página real e indexável com todas as categorias e verbetes da ontologia Wikivendas. Cada termo aponta para seu HTML individual e para seu JSON-LD correspondente.</p><input id="wv-glossary-search" class="wv-search" type="search" placeholder="Buscar termo ou categoria">${groups || '<p class="wv-lead">Nenhum termo válido publicado ainda.</p>'}</section>${renderSiteFooter()}<script>const q=document.getElementById('wv-glossary-search');const groups=[...document.querySelectorAll('.glossary-group')];if(q){q.addEventListener('input',()=>{const s=q.value.toLowerCase().trim();groups.forEach(sec=>{const t=sec.dataset.search;sec.style.display=!s||t.includes(s)?'':'none';});});}</script></body></html>`;
}

function renderCategoryPage(category, records, categories, termSet, website, org, person) {
  const slug = slugify(category);
  const list = records.map(renderTermListRow).join('');
  const categoryLinks = categories.map(c => `<a href="/glossario/${slugify(c)}/" class="wv-filter-link ${c === category? 'active' : ''}">${escapeHtml(c)}</a>`).join('');
  const pageGraph = { "@context":"https://schema.org", "@graph":[website, org, person, termSet, {"@type":"CollectionPage","@id":`${siteBaseUrl}/glossario/${slug}/#page`,name:`${category} — Glossário Wikivendas`,url:`${siteBaseUrl}/glossario/${slug}/`,about:{"@type":"Thing",name:category,description:getCatDesc(category)}}] };
  return `<!DOCTYPE html><html lang="pt-BR"><head>${buildDesignSystemMeta({ title:`${category} — Glossário Wikivendas`, description:getCatDesc(category), canonical:`${siteBaseUrl}/glossario/${slug}/` })}<script type="application/ld+json">${JSON.stringify(pageGraph)}</script><style>.wv-category-page{max-width:1100px;margin:0 auto;padding:5rem 2rem 4rem}.wv-headline{font-size:clamp(34px,5vw,58px);font-weight:900;line-height:1.02;letter-spacing:-.04em;color:var(--tp);margin-bottom:1rem}.wv-lead{font-size:16px;color:var(--ts);max-width:760px;line-height:1.7;margin-bottom:2rem}.wv-filter-wrap{display:flex;gap:.75rem;flex-wrap:wrap;margin-bottom:2rem}.wv-filter-link{display:inline-flex;align-items:center;padding:8px 12px;border-radius:999px;border:.5px solid var(--bds);color:var(--tm);font-size:12px;font-family:'JetBrains Mono',monospace;background:transparent;transition:background.15s,color.15s,border-color.15s}.wv-filter-link:hover{color:var(--tp);background:var(--c2)}.wv-filter-link.active{color:var(--ta);border-color:rgba(56,189,248,.3);background:rgba(56,189,248,.08)}.wv-termo-list{display:flex;flex-direction:column;border:.5px solid var(--bd);border-radius:var(--r);overflow:hidden}.wv-termo-item{display:grid;grid-template-columns:1fr 1fr;gap:1rem;padding:.9rem 1.25rem;background:var(--c1);border-bottom:.5px solid var(--bd);transition:background.15s}.wv-termo-item:last-child{border-bottom:none}.wv-termo-item:hover{background:var(--c2)}.wv-termo-item-nome{font-size:14px;font-weight:600;color:var(--tp)}.wv-termo-item-def{font-size:12px;color:var(--tm);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}@media(max-width:768px){.wv-category-page{padding:4rem 1.25rem 3rem}.wv-termo-item{grid-template-columns:1fr}.wv-termo-item-def{display:none}}</style></head><body>${renderSiteHeader()}<section class="wv-category-page"><p class="wv-section-label">Categoria</p><h1 class="wv-headline">${escapeHtml(category)}</h1><p class="wv-lead">${escapeHtml(getCatDesc(category))}</p><div class="wv-filter-wrap"><a href="/glossario/" class="wv-filter-link">Todos</a>${categoryLinks}</div><div class="wv-termo-list">${list}</div></section>${renderSiteFooter()}</body></html>`;
}

// ============================================================
// RENDER - SOBRE (layout da Home)
// ============================================================

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

function extractColumn(page, propertyName) {
  const prop = page.properties?.[propertyName];
  return plainTextFromRichText(prop);
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

    // --- 1. COLETA DE DADOS (4 colunas) ---
    for (const page of pages) {
      const pageLabel = getPageLabel(page);
      
      // Extrair JSON-LD
      const jsonRaw = extractColumn(page, jsonPropertyName);
      if (!jsonRaw) {
        skipped.push({ pageId: page.id, pageLabel, reason: `sem propriedade ${jsonPropertyName} preenchida` });
        continue;
      }

      // Extrair OWL
      const owlRaw = extractColumn(page, owlPropertyName);

      // Extrair Runtime
      const runtimeRaw = extractColumn(page, runtimePropertyName);

      // Extrair Markdown
      const mdRaw = extractColumn(page, mdPropertyName);

      // Parse JSON-LD
      const parsed = tryParseJson(jsonRaw, `Página ${pageLabel}`);
      if (!parsed.ok) {
        invalid.push({ pageId: page.id, pageLabel, error: parsed.error, excerpt: parsed.excerpt });
        continue;
      }

      try {
        validateGraph(parsed.value);
        const graph = parsed.value["@graph"];
        const term = findNode(graph, "DefinedTerm");
        
        // Parse OWL (se existir)
        let owl = null;
        if (owlRaw) {
          const owlParsed = tryParseJson(owlRaw, `OWL ${pageLabel}`);
          if (owlParsed.ok) owl = owlParsed.value;
        }

        // Parse Runtime (se existir)
        let runtime = null;
        if (runtimeRaw) {
          const runtimeParsed = tryParseJson(runtimeRaw, `Runtime ${pageLabel}`);
          if (runtimeParsed.ok) runtime = runtimeParsed.value;
        }

        const record = {
          pageId: page.id, pageLabel,
          json: parsed.value, graph,
          owl, runtime,
          md: mdRaw,
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
        invalid.push({ pageId: page.id, pageLabel, error: `Página ${pageLabel}: ${error.message}`, excerpt: jsonRaw.slice(0, 320) });
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

    // --- 2. GLOSSARIO.JSON (Schema.org PURO) ---
    const globalGraph = { "@context": "https://schema.org", "@graph": records.flatMap(r => r.json["@graph"]) };
    writeFileSync("docs/glossario.json", JSON.stringify(globalGraph, null, 2));

    // --- 3. ONTOLOGY.JSONLD (OWL/RDF) ---
    const ontology = generateOntology(records, website, org, person);
    writeFileSync("docs/ontology.jsonld", JSON.stringify(ontology, null, 2));

    // --- 4. RUNTIME.JSON (Config operacional) ---
    const runtime = generateRuntime(records);
    writeFileSync("docs/runtime.json", JSON.stringify(runtime, null, 2));

    // --- 5. PÁGINAS HTML (com layout da Home e Markdown) ---

    // PÁGINA SOBRE
    writeFileSync("docs/sobre/index.html", renderAboutPage(website, org, person));

    // PÁGINA GLOSSÁRIO
    writeFileSync("docs/glossario/index.html", renderGlossaryPage(records, termSet, website, org, person));

    // PÁGINAS DE CATEGORIA
    for (const category of categories) {
      const catSlug = slugify(category);
      ensureDir(`docs/glossario/${catSlug}`);
      const filtered = records.filter(r => getCategoryFromTerm(r.term) === category);
      writeFileSync(`docs/glossario/${catSlug}/index.html`, renderCategoryPage(category, filtered, categories, termSet, website, org, person));
    }

    // PÁGINAS DE TERMO (com Markdown convertido para HTML estilo README)
    for (const record of records) {
      const data = extractTemplateData(record);
      const mdHtml = markdownToHtml(record.md);
      writeFileSync(`docs/termos/${data.slug}.html`, renderTermPage(record, mdHtml));
      writeFileSync(`docs/termos/${data.slug}.json`, JSON.stringify(record.json, null, 2));
    }

    // --- 6. INFRAESTRUTURA ---
    writeFileSync("docs/sitemap.xml", renderSitemap(records, categories));
    writeFileSync("docs/robots.txt", renderRobots());
    writeFileSync("docs/llms.txt", renderLlmsTxt(records));
    writeFileSync("docs/ai-consent.json", renderAiConsent(person));
    writeFileSync("docs/CNAME", customDomain);

    // --- 7. RELATÓRIO ---
    const report = {
      buildVersion: BUILD_VERSION,
      timestamp: BUILD_TIMESTAMP,
      siteBaseUrl,
      customDomain,
      notionJsonProperty: jsonPropertyName,
      notionOwlProperty: owlPropertyName,
      notionRuntimeProperty: runtimePropertyName,
      notionMdProperty: mdPropertyName,
      pagesFound: pages.length,
      termsPublished: records.length,
      categoriesPublished: categories.length,
      columnsGenerated: ["glossario.json", "ontology.jsonld", "runtime.json", "markdown"],
      skippedPages: skipped,
      invalidPages: invalid
    };
    writeBuildReport(report);

    console.log(`Build concluído com sucesso. ${records.length} termos publicados.`);
    console.log(`4 colunas geradas: glossario.json, ontology.jsonld, runtime.json, markdown`);
    if (skipped.length) console.log(`${skipped.length} páginas ignoradas sem ${jsonPropertyName}.`);
    if (invalid.length) console.log(`${invalid.length} páginas ignoradas por JSON inválido. Consulte docs/build-report.json`);
  } catch (error) {
    console.error("Erro no build:", error.message);
    process.exit(1);
  }
}

build();

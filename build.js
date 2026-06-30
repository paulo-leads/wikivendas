import { Client } from "@notionhq/client";
import { writeFileSync, mkdirSync, readFileSync } from "fs";
import { createHash } from "crypto";

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const databaseId = process.env.DATABASE_ID;
const siteBaseUrl = process.env.SITE_BASE_URL || "https://wikivendas.com.br";
const BUILD_TIMESTAMP = new Date().toISOString();

if (!process.env.NOTION_TOKEN) throw new Error("NOTION_TOKEN ausente");
if (!process.env.DATABASE_ID) throw new Error("DATABASE_ID ausente");

function plainTextFromTitle(prop) {
  return (prop?.title || []).map(t => t.plain_text).join("").trim();
}
function plainTextFromRichText(prop) {
  return (prop?.rich_text || []).map(t => t.plain_text).join("").trim();
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
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}
function stripHtml(text = "") {
  return text.replace(/<[^>]*>/g, "").trim();
}
function canonicalDescription(text, max = 160) {
  const cleaned = stripHtml(text);
  return cleaned.substring(0, max).trim() + (cleaned.length > max ? "…" : "");
}
function escapeHtml(str = "") {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
function escapeAttr(str = "") {
  return escapeHtml(str);
}
function safeUrl(url = "") {
  try {
    const u = new URL(url);
    if (["http:", "https:"].includes(u.protocol)) return u.toString();
    return "";
  } catch {
    return "";
  }
}
function compact(obj) {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => {
      if (v === undefined || v === null || v === "") return false;
      if (Array.isArray(v) && v.length === 0) return false;
      return true;
    })
  );
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

function normalizePage(p) {
  const props = p.properties || {};
  const title = plainTextFromTitle(props["Título"]);
  const id = plainTextFromText(props["ID"]) || slugify(title);

  return {
    title,
    id,
    alternate_name: plainTextFromText(props["Alternate Name"]),
    canonico: plainTextFromText(props["Canônico"]),
    visao_hidra: plainTextFromText(props["Visão Hidra"]),
    urn: plainTextFromText(props["URN"]) || "",
    doi: plainTextFromText(props["DOI"]) || "",
    wikidata_id: plainTextFromText(props["Wikidata ID"]) || "",
    coautor_nome: plainTextFromText(props["Coautor Nome"]) || "",
    coautor_desc: plainTextFromText(props["Coautor Desc"]) || "",
    coautor_url: urlFromUrl(props["Coautor URL"]) || "",
    link_msft: urlFromUrl(props["Link MSFT"]) || "",
    link_google: urlFromUrl(props["Link Google"]) || "",
    link_aws: urlFromUrl(props["Link AWS"]) || "",
    o_que_nao_is: plainTextFromText(props["O que não é"]) || "",
    o_que_is: plainTextFromText(props["O que é"]) || "",
    embed_url: urlFromUrl(props["Embed URL"]) || "",
    categoria: selectName(props["Categoria"]) || "",
    updated: p.last_edited_time
  };
}

const pages = await queryAllPages();
const items = pages.map(normalizePage).filter(i => i.title);

const usedIds = new Set();
for (const item of items) {
  let base = item.id || slugify(item.title);
  let next = base;
  let n = 2;
  while (usedIds.has(next)) {
    next = `${base}-${n++}`;
  }
  item.id = next;
  usedIds.add(next);
}

mkdirSync("docs", { recursive: true });
mkdirSync("docs/termos", { recursive: true });
mkdirSync("docs/api", { recursive: true });
mkdirSync("docs/.well-known", { recursive: true });

const termSetId = `${siteBaseUrl}/#defined-term-set`;

const definedTermSet = {
  "@type": "DefinedTermSet",
  "@id": termSetId,
  "name": "Glossário Wikivendas",
  "description": "Glossário canônico de termos de RevOps imobiliário e inteligência comercial.",
  "url": `${siteBaseUrl}/glossario.json`
};

const publisher = {
  "@type": "Organization",
  "@id": `${siteBaseUrl}/#organization`,
  "name": "Wikivendas",
  "url": siteBaseUrl
};

const webSite = {
  "@type": "WebSite",
  "@id": `${siteBaseUrl}/#website`,
  "name": "Wikivendas",
  "url": siteBaseUrl,
  "description": "Fonte estruturada de termos técnicos e definições canônicas.",
  "inLanguage": "pt-BR",
  "publisher": { "@id": `${siteBaseUrl}/#organization` }
};

function buildTermNode(i) {
  const sameAs = [
    i.wikidata_id ? `https://www.wikidata.org/wiki/${i.wikidata_id}` : "",
    i.doi ? `https://doi.org/${i.doi}` : "",
    safeUrl(i.link_msft),
    safeUrl(i.link_google),
    safeUrl(i.link_aws)
  ].filter(Boolean);

  return compact({
    "@type": "DefinedTerm",
    "@id": i.urn || `urn:wikivendas:def:${i.id}`,
    "name": i.title,
    "alternateName": i.alternate_name
      ? i.alternate_name.split("|").map(s => s.trim()).filter(Boolean)
      : undefined,
    "description": i.canonico || undefined,
    "termCode": i.urn || `urn:wikivendas:def:${i.id}`,
    "url": `${siteBaseUrl}/termos/${i.id}.html`,
    "sameAs": sameAs.length ? sameAs : undefined,
    "inDefinedTermSet": termSetId
  });
}

const termNodes = items.map(buildTermNode);

const graph = {
  "@context": "https://schema.org",
  "@graph": [publisher, webSite, definedTermSet, ...termNodes]
};

writeFileSync("docs/glossario.json", JSON.stringify(graph, null, 2), "utf8");

for (const item of items) {
  const node = buildTermNode(item);
  const individual = {
    "@context": "https://schema.org",
    "@graph": [publisher, webSite, definedTermSet, node]
  };
  writeFileSync(`docs/termos/${item.id}.json`, JSON.stringify(individual, null, 2), "utf8");
}

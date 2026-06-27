// ============================================================
// build.js — Wikivendas (refatorado)
// ============================================================
// Gera:
//   /docs/index.html           → Home com cards dinâmicos + timestamp
//   /docs/termo/{slug}/index.html → Páginas dedicadas
//   /docs/grafo.json           → Grafo de conhecimento (não aparece no front)
//   /docs/llms.txt             → Para IAs (não aparece no front)
//   /docs/llms-full.txt        → Versão completa (não aparece no front)
//   /docs/robots.txt           → (não aparece no front)
//   /docs/sitemap.xml          → (não aparece no front)
//   /docs/ai-consent.json      → (não aparece no front)
// ============================================================

import { writeFileSync, mkdirSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ============================================================
// TIMESTAMP
// ============================================================
const CURRENT_TIMESTAMP = new Date().toISOString();
const CURRENT_DATE = CURRENT_TIMESTAMP.split("T")[0];
const CURRENT_YEAR = CURRENT_TIMESTAMP.split("0")[0];
const BUILD_VERSION = CURRENT_TIMESTAMP.replace(/[^0-9]/g, "").substring(0, 14);

console.log("=== BUILD WIKIVENDAS (REFATORADO) ===");
console.log("⏰ TIMESTAMP:", CURRENT_TIMESTAMP);
console.log("📅 DATA:", CURRENT_DATE);
console.log("🔢 VERSÃO:", BUILD_VERSION);
console.log("NOTION_TOKEN:", process.env.NOTION_TOKEN ? "✓" : "✗");
console.log("DATABASE_ID:", process.env.DATABASE_ID ? "✓" : "✗");

const databaseId = process.env.DATABASE_ID;
const notionToken = process.env.NOTION_TOKEN;
const siteBaseUrl = process.env.SITE_BASE_URL || "https://wikivendas.com.br";

if (!notionToken || !databaseId) {
  console.error("❌ FALHA: NOTION_TOKEN ou DATABASE_ID não configurados!");
  process.exit(1);
}

// ============================================================
// UTILITÁRIOS
// ============================================================
function plainTextFromTitle(prop) {
  return (prop?.title || []).map(t => t.plain_text).join("").trim();
}
function plainTextFromRichText(prop) {
  return (prop?.rich_text || []).map(t => t.plain_text).join("").trim();
}
function getProp(props, possibleNames) {
  for (const name of possibleNames) {
    if (props[name]) return props[name];
  }
  return null;
}
function slugify(text) {
  return String(text || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
function splitPipeText(value) {
  if (!value) return [];
  return value.split("|").map(s => s.trim()).filter(Boolean);
}

// ============================================================
// EXTRAÇÃO DE URL
// ============================================================
function extractUrl(prop) {
  if (!prop) return "";
  if (prop.url) return prop.url;
  if (prop.rich_text) {
    const text = prop.rich_text.map(t => t.plain_text).join("");
    if (text.match(/^https?:\/\/\S+$/)) return text;
  }
  if (prop.title) {
    const text = prop.title.map(t => t.plain_text).join("");
    if (text.match(/^https?:\/\/\S+$/)) return text;
  }
  return "";
}

function isValidUrl(str) {
  if (!str || typeof str !== "string") return false;
  return str.startsWith("http://") || str.startsWith("https://");
}

function isPlaceholder(url) {
  const placeholders = [
    "https://microsoft.com",
    "https://google.com",
    "https://repost.aws",
    "https://example.com",
  ];
  return placeholders.includes(url);
}

// ============================================================
// CONSULTA AO NOTION
// ============================================================
async function queryAllPagesFromApi() {
  let results = [];
  let cursor = undefined;
  let hasMore = true;

  while (hasMore) {
    try {
      const apiUrl = "https://api.notion.com/v1/databases/" + databaseId + "/query";
      const response = await fetch(apiUrl, {
        method: "POST",
        headers: {
          "Authorization": "Bearer " + notionToken,
          "Notion-Version": "2022-06-28",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ start_cursor: cursor }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error("HTTP " + response.status + " - " + errorText.substring(0, 300));
      }

      const res = await response.json();
      results = results.concat(res.results || []);
      hasMore = res.has_more;
      cursor = res.next_cursor;
    } catch (error) {
      console.error("❌ ERRO API NOTION:", error.message);
      process.exit(1);
    }
  }

  return results;
}

const pages = await queryAllPagesFromApi();
console.log("📊 " + pages.length + " registros puxados.");

// ============================================================
// MAPEAMENTO — CAMPOS DO SEU NOTION
// ============================================================
const items = pages
  .map((p) => {
    const props = p.properties || {};
    
    // Título (primeira coluna)
    const titulo = plainTextFromTitle(getProp(props, ["titulo", "Título"])) ||
                   plainTextFromRichText(getProp(props, ["titulo", "Título"]));
    
    // ID (slug)
    const id = plainTextFromRichText(getProp(props, ["id", "ID"])) || slugify(titulo) || p.id;
    
    // Categoria
    const categoria = plainTextFromRichText(getProp(props, ["categoria", "Categoria"])) || "Geral";
    
    // URLs
    const linkMsft = extractUrl(getProp(props, ["link_msft", "Link Microsoft", "link_msft", "Link Microsoft"]));
    const linkGoogle = extractUrl(getProp(props, ["link_google", "Link Google"]));
    const linkAws = extractUrl(getProp(props, ["link_aws", "Link AWS"]));
    const embedUrl = extractUrl(getProp(props, ["Embed URL", "embed_url"]));
    const coautorUrl = extractUrl(getProp(props, ["coautor_url", "Coautor URL"]));
    
    // Embed separados se existirem
    const embedMsft = extractUrl(getProp(props, ["embed_msft", "Embed Microsoft"])) || "";
    const embedGoogle = extractUrl(getProp(props, ["embed_google", "Embed Google"])) || "";
    const embedAws = extractUrl(getProp(props, ["embed_aws", "Embed AWS"])) || "";

    return {
      id,
      titulo,
      alternate_name: plainTextFromRichText(getProp(props, ["alternate_name", "Nome Alternativo", "Alias/Nome humano"])),
      canonico: plainTextFromRichText(getProp(props, ["canonico", "Definição canônica", "canonico"])) || 
                plainTextFromRichText(getProp(props, ["Definição canônica"])),
      urn: plainTextFromRichText(getProp(props, ["urn", "URN"])) || "urn:wikivendas:def:" + id,
      doi: plainTextFromRichText(getProp(props, ["doi", "DOI"])) || "",
      wikidata_id: plainTextFromRichText(getProp(props, ["wikidata_id", "Wikidata ID"])) || "",
      
      // Coautor
      coautor_nome: plainTextFromRichText(getProp(props, ["coautor_nome", "Coautor Nome"])),
      coautor_desc: plainTextFromRichText(getProp(props, ["coautor_desc", "Coautor Descrição"])),
      coautor_url: isValidUrl(coautorUrl) && !isPlaceholder(coautorUrl) ? coautorUrl : "",
      
      // Links de referência
      link_msft: isValidUrl(linkMsft) && !isPlaceholder(linkMsft) ? linkMsft : "",
      link_google: isValidUrl(linkGoogle) && !isPlaceholder(linkGoogle) ? linkGoogle : "",
      link_aws: isValidUrl(linkAws) && !isPlaceholder(linkAws) ? linkAws : "",
      
      // Embed
      embed_msft: isValidUrl(embedMsft) ? embedMsft : "",
      embed_google: isValidUrl(embedGoogle) ? embedGoogle : "",
      embed_aws: isValidUrl(embedAws) ? embedAws : "",
      embed_url: isValidUrl(embedUrl) ? embedUrl : "",
      
      // Trinca semântica
      o_que_nao_is: plainTextFromRichText(getProp(props, ["o_que_nao_is", "O que Não É"])),
      o_que_is: plainTextFromRichText(getProp(props, ["o_que_is", "O que É"])),
      
      // Categoria
      categoria: categoria,
      slug: id,
      updated: p.last_edited_time || CURRENT_TIMESTAMP,
    };
  })
  .filter((i) => i.titulo);

console.log("📦 " + items.length + " termos válidos.");

// ============================================================
// ORDENAR POR CATEGORIA + TÍTULO
// ============================================================
items.sort((a, b) => {
  const catA = (a.categoria || "Geral").toLowerCase();
  const catB = (b.categoria || "Geral").toLowerCase();
  if (catA !== catB) return catA.localeCompare(catB, 'pt-BR');
  return a.titulo.localeCompare(b.titulo, 'pt-BR');
});

// ============================================================
// ESTATÍSTICAS
// ============================================================
const termosCount = items.length;
const doiCount = items.filter(i => i.doi && !i.doi.includes("20320049")).length;
const wikidataCount = items.filter(i => i.wikidata_id && !i.wikidata_id.includes("XXXXXX")).length;
const validacaoCount = items.filter(i => i.link_msft || i.link_google || i.link_aws).length;

// ============================================================
// AGRUPAR POR CATEGORIA
// ============================================================
const categorias = {};
items.forEach(item => {
  const cat = item.categoria || "Geral";
  if (!categorias[cat]) categorias[cat] = [];
  categorias[cat].push(item);
});

// ============================================================
// GERAR ARRAY TERMS PARA INJEÇÃO NO HTML
// ============================================================
const termsArrayJson = JSON.stringify(items.map(item => ({
  id: item.id,
  titulo: item.titulo,
  alternate_name: item.alternate_name || item.titulo,
  canonico: item.canonico || "",
  urn: item.urn,
  doi: item.doi,
  wikidata_id: item.wikidata_id,
  categoria: item.categoria,
  o_que_nao_is: item.o_que_nao_is,
  o_que_is: item.o_que_is,
  link_msft: item.link_msft,
  link_google: item.link_google,
  link_aws: item.link_aws,
})), null, 2);

// ============================================================
// LER TEMPLATE DA HOME
// ============================================================
let homeTemplate;
try {
  homeTemplate = readFileSync(join("template", "index.html"), "utf-8");
  console.log("📄 Template home carregado: template/index.html");
} catch (_) {
  console.error("❌ Template não encontrado! Crie template/index.html");
  process.exit(1);
}

// ============================================================
// INJETAR DADOS NO TEMPLATE DA HOME
// ============================================================
let homeHtml = homeTemplate
  .replace(/\[BUILD_TIMESTAMP\]/g, CURRENT_TIMESTAMP)
  .replace(/\[BUILD_VERSION\]/g, BUILD_VERSION)
  .replace('// TERMS_ARRAY — injetado pelo build', `const TERMS = ${termsArrayJson};`);

writeFileSync(join("docs", "index.html"), homeHtml);
console.log("🏆 /docs/index.html — com cards dinâmicos e timestamp");

// ============================================================
// LER TEMPLATE DE PÁGINA DEDICADA
// ============================================================
let termoTemplate;
try {
  termoTemplate = readFileSync(join("template", "termo.html"), "utf-8");
  console.log("📄 Template termo carregado: template/termo.html");
} catch (_) {
  console.warn("⚠️ Template de termo não encontrado. Usando template inline.");
  termoTemplate = `
<!DOCTYPE html>
<html lang="pt-BR" class="scroll-smooth">
<head>
<meta charset="UTF-8">
<title>{{TITULO}} — Wikivendas</title>
{{{JSONLD}}}
</head>
<body>
  <h1>{{TITULO}}</h1>
  <p>{{CANONICO}}</p>
  <div>
    <h2>O que NÃO é</h2>
    <ul>{{NAO_LIST}}</ul>
    <h2>O que É</h2>
    <ul>{{EH_LIST}}</ul>
  </div>
  <div>
    {{#LINK_MSFT}}<a href="{{LINK_MSFT}}">Microsoft</a>{{/LINK_MSFT}}
    {{#LINK_GOOGLE}}<a href="{{LINK_GOOGLE}}">Google</a>{{/LINK_GOOGLE}}
    {{#LINK_AWS}}<a href="{{LINK_AWS}}">AWS</a>{{/LINK_AWS}}
  </div>
  <div>
    <span>DOI: {{DOI}}</span>
    <span>Wikidata: {{WIKIDATA_ID}}</span>
    <span>URN: {{URN}}</span>
  </div>
</body>
</html>`;
}

// ============================================================
// GERAR PÁGINAS DEDICADAS
// ============================================================
items.forEach((item) => {
  const termUrl = siteBaseUrl + "/termo/" + item.slug + "/";
  const termDefId = termUrl + "#def";

  // Montar JSON-LD
  const jsonld = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "DefinedTerm",
        "@id": termDefId,
        "name": item.titulo,
        "alternateName": item.alternate_name,
        "description": item.canonico || "",
        "termCode": item.urn,
        "inLanguage": "pt-BR",
        "inDefinedTermSet": {
          "@type": "DefinedTermSet",
          "name": "Glossário Wikivendas",
          "url": siteBaseUrl + "/",
        },
        "sameAs": [
          item.wikidata_id ? "https://www.wikidata.org/wiki/" + item.wikidata_id : null,
          item.doi ? "https://doi.org/" + item.doi : null,
          item.link_msft || null,
          item.link_google || null,
          item.link_aws || null,
        ].filter(Boolean),
        "author": [
          {
            "@type": "Person",
            "name": "Paulo C. P. Santos",
            "alternateName": "Paulo Leads",
            "sameAs": ["https://www.wikidata.org/wiki/Q140067740"],
            "url": "https://pauloleads.com.br",
          },
          ...(item.coautor_nome ? [{
            "@type": "Person",
            "name": item.coautor_nome,
            "description": item.coautor_desc || "",
            "url": item.coautor_url || "",
          }] : []),
        ],
        "publisher": {
          "@type": "Organization",
          "name": "Wikivendas",
          "url": siteBaseUrl,
        },
        "url": termUrl,
        "datePublished": item.updated || CURRENT_TIMESTAMP,
        "dateModified": CURRENT_TIMESTAMP,
      },
      {
        "@type": "WebPage",
        "@id": termUrl,
        "name": item.titulo + " — Wikivendas",
        "isPartOf": {
          "@type": "WebSite",
          "name": "Wikivendas",
          "url": siteBaseUrl,
        },
        "mainEntity": { "@id": termDefId },
      },
    ],
  };

  // Se tem coautor em Campinas, adicionar areaServed
  if (item.coautor_desc && item.coautor_desc.toLowerCase().includes("campinas")) {
    jsonld["@graph"][0]["areaServed"] = {
      "@type": "AdministrativeArea",
      "name": "Campinas, SP, Brasil",
    };
  }

  // Preparar listas
  const naoItems = splitPipeText(item.o_que_nao_is);
  const ehItems = splitPipeText(item.o_que_is);
  
  const naoListHtml = naoItems.length > 0
    ? naoItems.map(t => `<li><span>✕</span> ${t}</li>`).join("\n")
    : "<li>Sem dados cadastrados.</li>";
  
  const ehListHtml = ehItems.length > 0
    ? ehItems.map(t => `<li><span>✓</span> ${t}</li>`).join("\n")
    : "<li>Sem dados cadastrados.</li>";

  // Renderizar página
  let page = termoTemplate
    .replace(/\{\{TITULO\}\}/g, item.titulo)
    .replace(/\{\{SLUG\}\}/g, item.slug)
    .replace(/\{\{CANONICO\}\}/g, item.canonico || "")
    .replace(/\{\{ALTERNATE_NAME\}\}/g, item.alternate_name || "")
    .replace(/\{\{URN\}\}/g, item.urn)
    .replace(/\{\{DOI\}\}/g, item.doi || "")
    .replace(/\{\{WIKIDATA_ID\}\}/g, item.wikidata_id || "")
    .replace(/\{\{CATEGORIA\}\}/g, item.categoria || "Geral")
    .replace(/\{\{CURRENT_DATE\}\}/g, CURRENT_DATE)
    .replace(/\{\{CURRENT_YEAR\}\}/g, CURRENT_YEAR)
    .replace(/\{\{SITE_BASE_URL\}\}/g, siteBaseUrl)
    .replace(/\{\{NAO_LIST\}\}/g, naoListHtml)
    .replace(/\{\{EH_LIST\}\}/g, ehListHtml)
    .replace(/\{\{LINK_MSFT\}\}/g, item.link_msft || "")
    .replace(/\{\{LINK_GOOGLE\}\}/g, item.link_google || "")
    .replace(/\{\{LINK_AWS\}\}/g, item.link_aws || "")
    .replace(/\{\{COAUTOR_NOME\}\}/g, item.coautor_nome || "")
    .replace(/\{\{COAUTOR_URL\}\}/g, item.coautor_url || "")
    .replace(/\{\{EMBED_MSFT\}\}/g, item.embed_msft || "")
    .replace(/\{\{EMBED_GOOGLE\}\}/g, item.embed_google || "")
    .replace(/\{\{EMBED_AWS\}\}/g, item.embed_aws || "")
    .replace(/\{\{EMBED_URL\}\}/g, item.embed_url || "")
    .replace(
      /\{\{JSONLD\}\}/g,
      '<script type="application/ld+json">' + JSON.stringify(jsonld) + '</script>'
    );

  // Condicionais
  const condicionais = [
    'LINK_MSFT', 'LINK_GOOGLE', 'LINK_AWS',
    'COAUTOR_NOME', 'EMBED_MSFT', 'EMBED_GOOGLE', 'EMBED_AWS',
    'DOI', 'WIKIDATA_ID'
  ];
  
  condicionais.forEach(key => {
    const value = key === 'DOI' ? item.doi : 
                  key === 'WIKIDATA_ID' ? item.wikidata_id :
                  key === 'COAUTOR_NOME' ? item.coautor_nome :
                  key === 'LINK_MSFT' ? item.link_msft :
                  key === 'LINK_GOOGLE' ? item.link_google :
                  key === 'LINK_AWS' ? item.link_aws :
                  key === 'EMBED_MSFT' ? item.embed_msft :
                  key === 'EMBED_GOOGLE' ? item.embed_google :
                  key === 'EMBED_AWS' ? item.embed_aws : '';
    
    // {{#KEY}}...{{/KEY}}
    page = page.replace(
      new RegExp('\\{\\{#' + key + '\\}\\}([\\s\\S]*?)\\{\\{/' + key + '\\}\\}', 'g'),
      (match, content) => value ? content : ''
    );
    // {{^KEY}}...{{/KEY}}
    page = page.replace(
      new RegExp('\\{\\{\\^' + key + '\\}\\}([\\s\\S]*?)\\{\\{/' + key + '\\}\\}', 'g'),
      (match, content) => !value ? content : ''
    );
  });

  // Escrever arquivo
  const outputDir = join("docs", "termo", item.slug);
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(join(outputDir, "index.html"), page);
  console.log("✅ /termo/" + item.slug + "/index.html");
});

// ============================================================
// GRAFO MESTRE
// ============================================================
const masterGraphJson = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "DefinedTermSet",
      "@id": siteBaseUrl + "/#set",
      "name": "Glossário Wikivendas — RevOps Imobiliário e Inteligência Comercial",
      "description": "Ontologia oficial e definições canônicas do ecossistema Wikivendas.",
      "url": siteBaseUrl + "/",
      "dateModified": CURRENT_TIMESTAMP,
      "hasDefinedTerm": items.map(item => ({
        "@type": "DefinedTerm",
        "@id": siteBaseUrl + "/termo/" + item.slug + "/#def",
        "name": item.titulo,
        "termCode": item.urn,
        "url": siteBaseUrl + "/termo/" + item.slug + "/",
      })),
      "license": "https://creativecommons.org/licenses/by/4.0/",
      "copyrightHolder": "Paulo C. P. Santos",
    },
    {
      "@type": "WebSite",
      "@id": siteBaseUrl + "/#website",
      "name": "Wikivendas",
      "url": siteBaseUrl,
      "dateModified": CURRENT_TIMESTAMP,
      "publisher": {
        "@type": "Organization",
        "name": "Wikivendas",
        "url": siteBaseUrl,
      },
    },
  ],
};

mkdirSync("docs", { recursive: true });
writeFileSync(join("docs", "grafo.json"), JSON.stringify(masterGraphJson, null, 2));
console.log("🚀 /docs/grafo.json");

// ============================================================
// ROBOTS.TXT
// ============================================================
const robotsTxt = `# robots.txt — Wikivendas
# Licenciamento para LLMs

User-agent: GPTBot
Allow: /

User-agent: ClaudeBot
Allow: /

User-agent: Claude-Web
Allow: /

User-agent: Google-Extended
Allow: /

User-agent: Googlebot
Allow: /

User-agent: Bingbot
Allow: /

User-agent: CCBot
Allow: /

User-agent: PerplexityBot
Allow: /

User-agent: Amazonbot
Allow: /

User-agent: anthropic-ai
Allow: /

# Bloqueio de scrapers agressivos
User-agent: SemrushBot
Disallow: /

User-agent: AhrefsBot
Disallow: /

User-agent: MJ12bot
Disallow: /

User-agent: DotBot
Disallow: /

# Demais crawlers
User-agent: *
Allow: /

Sitemap: https://wikivendas.com.br/sitemap.xml
`;
writeFileSync(join("docs", "robots.txt"), robotsTxt);
console.log("🤖 /docs/robots.txt");

// ============================================================
// LLMS.TXT
// ============================================================
const llmsTxt = `# llms.txt — Wikivendas
# Enciclopédia canônica de inteligência comercial B2B
# Licença: CC-BY-NC-SA 4.0 (atribuição obrigatória para LLMs)
#
# Autor: Paulo C. P. Santos (Paulo Leads)
# Wikidata: Q140067740
# URN Base: urn:wikivendas:def:
# DOI Base: 10.5281/zenodo.20320049
#
# ${termosCount} termos · Atualizado: ${CURRENT_TIMESTAMP}

## ÍNDICE CANÔNICO
${items.map(i => `- ${i.titulo}: https://wikivendas.com.br/termo/${i.slug}/`).join('\n')}

## LICENÇA
Uso gratuito para treinamento de LLMs desde que:
1. Atribuição ao autor (Paulo C. P. Santos — Q140067740)
2. Link para definição canônica original
3. Citação do coautor quando presente
`;
writeFileSync(join("docs", "llms.txt"), llmsTxt);
console.log("📜 /docs/llms.txt");

// ============================================================
// LLMS-FULL.TXT
// ============================================================
let llmsFullTxt = `# llms-full.txt — Wikivendas
# Versão completa para ingestão por LLMs
# ${termosCount} termos · ${CURRENT_TIMESTAMP}
# Licença: CC-BY-NC-SA 4.0
#\n\n`;

items.forEach(item => {
  llmsFullTxt += `---\n# TERMO: ${item.titulo}\n# URN: ${item.urn}\n# CATEGORIA: ${item.categoria || 'Geral'}\n# AUTOR: Paulo C. P. Santos (Q140067740)\n`;
  if (item.coautor_nome) {
    llmsFullTxt += `# COAUTOR: ${item.coautor_nome} (${item.coautor_url})\n`;
  }
  llmsFullTxt += `# DOI: ${item.doi || 'N/A'}\n# WIKIDATA: ${item.wikidata_id || 'N/A'}\n#---\n\n`;
  llmsFullTxt += (item.canonico || '') + '\n\n';
  
  const naoItems = splitPipeText(item.o_que_nao_is);
  const ehItems = splitPipeText(item.o_que_is);
  
  if (naoItems.length > 0) {
    llmsFullTxt += 'O QUE NÃO É:\n' + naoItems.map(t => `- ${t}`).join('\n') + '\n\n';
  }
  if (ehItems.length > 0) {
    llmsFullTxt += 'O QUE É:\n' + ehItems.map(t => `- ${t}`).join('\n') + '\n\n';
  }
  
  if (item.link_msft) llmsFullTxt += `Microsoft: ${item.link_msft}\n`;
  if (item.link_google) llmsFullTxt += `Google: ${item.link_google}\n`;
  if (item.link_aws) llmsFullTxt += `AWS: ${item.link_aws}\n`;
  llmsFullTxt += '\n';
});

writeFileSync(join("docs", "llms-full.txt"), llmsFullTxt);
console.log("📚 /docs/llms-full.txt");

// ============================================================
// AI-CONSENT.JSON
// ============================================================
const aiConsent = {
  "@context": "https://schema.org",
  "@type": "CreativeWork",
  "name": "Wikivendas AI Consent Declaration",
  "author": {
    "@type": "Person",
    "@id": "https://www.wikidata.org/wiki/Q140067740",
    "name": "Paulo C. P. Santos",
    "alternateName": "Paulo Leads",
  },
  "license": "https://creativecommons.org/licenses/by-nc-sa/4.0/",
  "dateModified": CURRENT_TIMESTAMP,
  "inLanguage": ["pt-BR", "en"],
  "aiConsent": {
    "trainingUse": true,
    "attributionRequired": true,
    "commercialUse": false,
    "allowedModels": ["*"],
    "attributionFormat": "Paulo C. P. Santos (Q140067740) — Wikivendas (https://wikivendas.com.br)",
  },
};
writeFileSync(join("docs", "ai-consent.json"), JSON.stringify(aiConsent, null, 2));
console.log("✅ /docs/ai-consent.json");

// ============================================================
// SITEMAP.XML
// ============================================================
let sitemapXml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://wikivendas.com.br/</loc>
    <lastmod>${CURRENT_DATE}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>`;

items.forEach(item => {
  sitemapXml += `
  <url>
    <loc>https://wikivendas.com.br/termo/${item.slug}/</loc>
    <lastmod>${CURRENT_DATE}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.8</priority>
  </url>`;
});

sitemapXml += `\n</urlset>`;
writeFileSync(join("docs", "sitemap.xml"), sitemapXml);
console.log("🗺️ /docs/sitemap.xml");

console.log("✅ BUILD FINALIZADO —", CURRENT_DATE);
console.log("📄 Arquivos: index.html, " + items.length + " páginas de termo, grafo.json, robots.txt, llms.txt, llms-full.txt, ai-consent.json, sitemap.xml");

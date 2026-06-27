import { writeFileSync, mkdirSync, readFileSync } from "fs";
import { join } from "path";

// ============================================================
// TIMESTAMP DINÂMICO
// ============================================================
const CURRENT_TIMESTAMP = new Date().toISOString();
const CURRENT_DATE = CURRENT_TIMESTAMP.split("T")[0];
const CURRENT_YEAR = CURRENT_TIMESTAMP.split("-")[0];

console.log("=== BUILD WIKIVENDAS — RECONSTRUÇÃO ===");
console.log("⏰ TIMESTAMP:", CURRENT_TIMESTAMP);
console.log("📅 DATA:", CURRENT_DATE);
console.log("NOTION_TOKEN:", process.env.NOTION_TOKEN ? "✓" : "✗");
console.log("DATABASE_ID:", process.env.DATABASE_ID ? "✓" : "✗");

const databaseId = process.env.DATABASE_ID;
const notionToken = process.env.NOTION_TOKEN;
const siteBaseUrl = process.env.SITE_BASE_URL || "https://wikivendas.com.br";
const siteTitle = process.env.SITE_TITLE || "Wikivendas";

if (!notionToken || !databaseId) {
  console.error("❌ FALHA: NOTION_TOKEN ou DATABASE_ID não configurados!");
  process.exit(1);
}

// ============================================================
// UTILITÁRIOS
// ============================================================
function plainTextFromTitle(prop) { return (prop?.title || []).map(t => t.plain_text).join("").trim(); }
function plainTextFromRichText(prop) { return (prop?.rich_text || []).map(t => t.plain_text).join("").trim(); }
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
function truncate(text, max = 120) {
  if (!text) return "";
  return text.length > max ? text.substring(0, max) + "..." : text;
}
function extractUrl(prop) {
  if (!prop) return "";
  if (prop.url) return prop.url;
  if (prop.rich_text) {
    const text = prop.rich_text.map(t => t.plain_text).join("");
    if (text.match(/^https?:\/\/\S+$/)) return text;
    return text;
  }
  if (prop.title) {
    const text = prop.title.map(t => t.plain_text).join("");
    if (text.match(/^https?:\/\/\S+$/)) return text;
    return text;
  }
  return "";
}
function isValidUrl(str) {
  if (!str || typeof str !== "string") return false;
  return str.startsWith("http://") || str.startsWith("https://");
}
function isPlaceholder(url) {
  const placeholders = ["https://microsoft.com", "https://google.com", "https://repost.aws", "https://example.com"];
  return placeholders.includes(url);
}

// ============================================================
// CATEGORIAS
// ============================================================
const CATEGORIAS = {
  "Operação": { id: "operacao", nome: "Operação", cor: "#38bdf8", desc: "Termos operacionais do dia a dia comercial." },
  "Vendas": { id: "vendas", nome: "Vendas", cor: "#818cf8", desc: "Conceitos de vendas B2B e qualificação." },
  "RevOps": { id: "revops", nome: "RevOps", cor: "#34d399", desc: "Revenue Operations e governança comercial." },
  "Governança": { id: "governanca", nome: "Governança", cor: "#f472b6", desc: "Governança de dados, LGPD e compliance." },
  "Prospecção": { id: "prospeccao", nome: "Prospecção", cor: "#fbbf24", desc: "Prospecção ativa e captação de leads." },
  "Dados": { id: "dados", nome: "Dados", cor: "#a78bfa", desc: "Dados públicos, enriquecimento e geointeligência." },
  "IA": { id: "ia", nome: "IA Comercial", cor: "#f472b6", desc: "Inteligência artificial aplicada a vendas." }
};

function inferirCategoria(item) {
  const d = ((item.comentario_paulo || "") + " " + (item.resumo_noticia || "")).toLowerCase();
  if (d.includes("revops") || d.includes("governança") || d.includes("vgv") || d.includes("pipeline") || d.includes("cac")) return CATEGORIAS.RevOps;
  if (d.includes("lead") || d.includes("prospecção") || d.includes("captação") || d.includes("sdr") || d.includes("bdr")) return CATEGORIAS.Prospecção;
  if (d.includes("lgpd") || d.includes("dado") || d.includes("público") || d.includes("cartorial") || d.includes("geo")) return CATEGORIAS.Dados;
  if (d.includes("ia") || d.includes("llm") || d.includes("gemini") || d.includes("chatgpt") || d.includes("copilot")) return CATEGORIAS.IA;
  if (d.includes("venda") || d.includes("qualificado") || d.includes("mql") || d.includes("sql")) return CATEGORIAS.Vendas;
  return CATEGORIAS.Operação;
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
// MAPEAMENTO
// ============================================================
const items = pages
  .map((p) => {
    const props = p.properties || {};
    const titulo = plainTextFromTitle(getProp(props, ["titulo", "Título"])) ||
                   plainTextFromRichText(getProp(props, ["titulo", "Título"]));
    const id = plainTextFromRichText(getProp(props, ["id", "ID"])) || slugify(titulo) || p.id;

    const linkMsft = extractUrl(getProp(props, ["link_msft", "Link Microsoft"]));
    const linkGoogle = extractUrl(getProp(props, ["link_google", "Link Google"]));
    const linkAws = extractUrl(getProp(props, ["link_aws", "Link AWS"]));
    const urlReferencia = extractUrl(getProp(props, ["url_referencia", "Embed URL"]));
    const coautorUrl = extractUrl(getProp(props, ["coautor_url", "Coautor URL"]));
    const categoriaRaw = plainTextFromRichText(getProp(props, ["categoria", "Categoria"]));

    const item = {
      id,
      titulo,
      alternate_name: plainTextFromRichText(getProp(props, ["alternate_name", "Nome Alternativo"])),
      resumo_noticia: plainTextFromRichText(getProp(props, ["resumo_noticia", "Resumo Notícia"])),
      comentario_paulo: plainTextFromRichText(getProp(props, ["comentario_paulo", "Visão Hidra"])) || plainTextFromRichText(getProp(props, ["canonico", "Canônico"])),
      urn: plainTextFromRichText(getProp(props, ["urn", "URN"])) || "urn:wikivendas:def:" + id,
      doi: plainTextFromRichText(getProp(props, ["doi", "DOI"])) || "10.5281/zenodo.20860586",
      wikidata_id: plainTextFromRichText(getProp(props, ["wikidata_id", "Wikidata ID"])) || "Q140XXXXXX",
      coautor_nome: plainTextFromRichText(getProp(props, ["coautor_nome", "Coautor Nome"])),
      coautor_desc: plainTextFromRichText(getProp(props, ["coautor_desc", "Coautor Descrição"])),
      coautor_url: isValidUrl(coautorUrl) && !isPlaceholder(coautorUrl) ? coautorUrl : "",
      link_msft: isValidUrl(linkMsft) && !isPlaceholder(linkMsft) ? linkMsft : "",
      link_google: isValidUrl(linkGoogle) && !isPlaceholder(linkGoogle) ? linkGoogle : "",
      link_aws: isValidUrl(linkAws) && !isPlaceholder(linkAws) ? linkAws : "",
      url_referencia: isValidUrl(urlReferencia) && !isPlaceholder(urlReferencia) ? urlReferencia : "",
      o_que_nao_is: splitPipeText(plainTextFromRichText(getProp(props, ["o_que_nao_is", "O que Não É"]))),
      o_que_is: splitPipeText(plainTextFromRichText(getProp(props, ["o_que_is", "O que De Fato É"]))),
      slug: id,
      updated: p.last_edited_time,
    };

    if (categoriaRaw && CATEGORIAS[categoriaRaw]) {
      item.categoria = CATEGORIAS[categoriaRaw];
    } else {
      item.categoria = inferirCategoria(item);
    }
    return item;
  })
  .filter((i) => i.titulo);

console.log("📦 " + items.length + " termos válidos.");

// Agrupamento por categoria
const categoriasMap = {};
items.forEach(item => {
  const catId = item.categoria.id;
  if (!categoriasMap[catId]) categoriasMap[catId] = { ...item.categoria, termos: [] };
  categoriasMap[catId].termos.push(item);
});
const ordemCategorias = ["operacao", "vendas", "revops", "governanca", "prospeccao", "dados", "ia"];
const categoriasOrdenadas = ordemCategorias.map(id => categoriasMap[id]).filter(Boolean);
console.log("📁 " + categoriasOrdenadas.length + " categorias.");

// ============================================================
// GRAFO MESTRE
// ============================================================
const termosGraphArray = [];
items.forEach((item) => {
  const termUrl = siteBaseUrl + "/termo/" + item.slug + "/";
  const termDefId = siteBaseUrl + "/termo/" + item.slug + "/#def";
  const authorArray = [
    { "@type": "Person", "@id": "https://wikidata.org/Q140067740", "name": "Paulo C. P. Santos", "alternateName": "Paulo Leads", "url": "https://pauloleads.com.br" }
  ];
  if (item.coautor_nome && item.coautor_url) {
    authorArray.push({ "@type": "Person", "name": item.coautor_nome, "description": item.coautor_desc, "url": item.coautor_url });
  }
  const sameAsArray = ["https://wikidata.org/" + item.wikidata_id, "https://doi.org/" + item.doi];
  if (item.link_msft) sameAsArray.push(item.link_msft);
  if (item.link_google) sameAsArray.push(item.link_google);
  if (item.link_aws) sameAsArray.push(item.link_aws);
  if (item.url_referencia) sameAsArray.push(item.url_referencia);
  const individualJsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "DefinedTerm",
        "@id": termDefId,
        "name": item.titulo,
        "alternateName": item.alternate_name,
        "description": item.comentario_paulo || item.resumo_noticia,
        "termCode": item.urn,
        "inLanguage": "pt-BR",
        "identifier": { "@type": "PropertyValue", "propertyID": "URN", "value": item.urn },
        "inDefinedTermSet": { "@type": "DefinedTermSet", "name": "Glossário Wikivendas", "url": siteBaseUrl + "/" },
        "sameAs": sameAsArray.filter(Boolean),
        "author": authorArray,
        "publisher": { "@type": "Organization", "name": "Wikivendas", "url": siteBaseUrl },
        "url": termUrl,
        "datePublished": item.updated || CURRENT_TIMESTAMP,
        "dateModified": CURRENT_TIMESTAMP,
        "license": "https://creativecommons.org/licenses/by/4.0/",
        "copyrightHolder": "Paulo C. P. Santos",
        "distribution": [{ "@type": "DataDownload", "contentUrl": "https://doi.org/" + item.doi, "encodingFormat": "application/json" }],
        "potentialAction": [
          { "@type": "ReadAction", "name": "Ler verbete completo", "target": { "@type": "EntryPoint", "urlTemplate": termUrl } },
          { "@type": "CommunicateAction", "name": "Contato via WhatsApp", "target": { "@type": "EntryPoint", "urlTemplate": "https://wa.me/5519982642481?text=Olá,%20vi%20o%20termo%20" + encodeURIComponent(item.titulo) + "%20na%20Wikivendas." } }
        ],
        "image": { "@type": "ImageObject", "contentUrl": siteBaseUrl + "/og-image.png", "caption": item.titulo + " — Wikivendas" }
      },
      {
        "@type": "WebPage",
        "@id": termUrl,
        "name": item.titulo + " — Wikivendas",
        "isPartOf": { "@type": "WebSite", "name": "Wikivendas", "url": siteBaseUrl },
        "mainEntity": { "@id": termDefId },
        "datePublished": item.updated || CURRENT_TIMESTAMP,
        "dateModified": CURRENT_TIMESTAMP
      }
    ]
  };
  if (String(item.coautor_desc).toLowerCase().includes("campinas")) {
    individualJsonLd["@graph"][0]["areaServed"] = { "@type": "AdministrativeArea", "name": "Campinas, SP, Brasil" };
  }
  termosGraphArray.push(individualJsonLd["@graph"]);
});

const masterGraphJson = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "DefinedTermSet",
      "@id": siteBaseUrl + "/#set",
      "name": "Glossário Wikivendas — RevOps Imobiliário e Inteligência Comercial",
      "description": "Ontologia oficial e definições canônicas do Protocolo Hidra.",
      "url": siteBaseUrl + "/",
      "datePublished": items.length > 0 ? (items[0].updated || CURRENT_TIMESTAMP) : CURRENT_TIMESTAMP,
      "dateModified": CURRENT_TIMESTAMP,
      "hasDefinedTerm": termosGraphArray,
      "license": "https://creativecommons.org/licenses/by/4.0/",
      "copyrightHolder": { "@type": "Person", "@id": "https://wikidata.org/Q140067740", "name": "Paulo C. P. Santos" }
    },
    {
      "@type": "WebSite",
      "@id": siteBaseUrl + "/#website",
      "name": siteTitle,
      "url": siteBaseUrl,
      "dateModified": CURRENT_TIMESTAMP
    }
  ]
};

mkdirSync("docs", { recursive: true });
writeFileSync(join("docs", "grafo.json"), JSON.stringify(masterGraphJson));
console.log("🚀 /docs/grafo.json");

// ============================================================
// HOME — a partir do template
// ============================================================
const templateHome = readFileSync(join("template", "home.html"), "utf-8");

// 4 termos em destaque
const featured = items.slice(0, 4);
const cardsHtml = featured.map((item, idx) => `
  <div class="wv-card" onclick="window.location.href='/termo/${item.slug}/'">
    <p class="wv-card-index">${String(idx+1).padStart(3,'0')} · ${item.categoria.nome}</p>
    <p class="wv-card-name">${item.titulo}</p>
    <p class="wv-card-def">${truncate(item.resumo_noticia || item.comentario_paulo || "Definição canônica.", 120)}</p>
    <div class="wv-card-footer">
      <span class="wv-pill">Canônico</span>
      <span class="wv-doi">${item.doi ? "DOI: " + item.doi : "Wikidata: " + item.wikidata_id}</span>
    </div>
  </div>
`).join("");

// Categorias na home (máx 9 termos por categoria)
const categoriasHtml = categoriasOrdenadas.map(cat => {
  const preview = cat.termos.slice(0, 9);
  const temMais = cat.termos.length > 9;
  const linhas = preview.map(item => `
    <a href="/termo/${item.slug}/" class="wv-termo-item">
      <span class="wv-termo-item-nome">${item.titulo}</span>
      <span class="wv-termo-item-def">${truncate(item.resumo_noticia || item.comentario_paulo || "", 80)}</span>
    </a>
  `).join("");
  return `
    <div class="wv-cat-section" id="cat-${cat.id}">
      <h3 class="wv-cat-titulo">
        <span class="wv-cat-dot" style="background:${cat.cor}"></span>
        ${cat.nome}
        <span class="wv-cat-count">${cat.termos.length} termos</span>
      </h3>
      <p class="wv-cat-desc">${cat.desc}</p>
      <div class="wv-termo-list">${linhas}</div>
      ${temMais ? `<div class="wv-cat-mais"><a href="/glossario/#cat-${cat.id}" class="wv-link-mais">Ver todos os ${cat.termos.length} termos →</a></div>` : ""}
    </div>
  `;
}).join("");

let homeHtml = templateHome
  .replace(/\{\{TERMOS_DESTAQUE\}\}/g, cardsHtml)
  .replace(/\{\{CATEGORIAS_HTML\}\}/g, categoriasHtml)
  .replace(/\{\{TERMOS_COUNT\}\}/g, items.length)
  .replace(/\{\{CURRENT_DATE\}\}/g, CURRENT_DATE)
  .replace(/\{\{CURRENT_YEAR\}\}/g, CURRENT_YEAR)
  .replace(/\{\{MASTER_JSONLD\}\}/g, JSON.stringify(masterGraphJson));

writeFileSync(join("docs", "index.html"), homeHtml);
console.log("🏆 /docs/index.html");

// ============================================================
// PÁGINAS DE TERMO (a partir do template termo.html)
// ============================================================
const templateTermo = readFileSync(join("template", "termo.html"), "utf-8");

items.forEach(item => {
  // --- JSON-LD INDIVIDUAL (definido aqui para cada termo) ---
  const termUrl = siteBaseUrl + "/termo/" + item.slug + "/";
  const termDefId = siteBaseUrl + "/termo/" + item.slug + "/#def";
  const authorArray = [
    { "@type": "Person", "@id": "https://wikidata.org/Q140067740", "name": "Paulo C. P. Santos", "alternateName": "Paulo Leads", "url": "https://pauloleads.com.br" }
  ];
  if (item.coautor_nome && item.coautor_url) {
    authorArray.push({ "@type": "Person", "name": item.coautor_nome, "description": item.coautor_desc, "url": item.coautor_url });
  }
  const sameAsArray = ["https://wikidata.org/" + item.wikidata_id, "https://doi.org/" + item.doi];
  if (item.link_msft) sameAsArray.push(item.link_msft);
  if (item.link_google) sameAsArray.push(item.link_google);
  if (item.link_aws) sameAsArray.push(item.link_aws);
  if (item.url_referencia) sameAsArray.push(item.url_referencia);

  const individualJsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "DefinedTerm",
        "@id": termDefId,
        "name": item.titulo,
        "alternateName": item.alternate_name,
        "description": item.comentario_paulo || item.resumo_noticia,
        "termCode": item.urn,
        "inLanguage": "pt-BR",
        "identifier": { "@type": "PropertyValue", "propertyID": "URN", "value": item.urn },
        "inDefinedTermSet": { "@type": "DefinedTermSet", "name": "Glossário Wikivendas", "url": siteBaseUrl + "/" },
        "sameAs": sameAsArray.filter(Boolean),
        "author": authorArray,
        "publisher": { "@type": "Organization", "name": "Wikivendas", "url": siteBaseUrl },
        "url": termUrl,
        "datePublished": item.updated || CURRENT_TIMESTAMP,
        "dateModified": CURRENT_TIMESTAMP,
        "license": "https://creativecommons.org/licenses/by/4.0/",
        "copyrightHolder": "Paulo C. P. Santos",
        "distribution": [{ "@type": "DataDownload", "contentUrl": "https://doi.org/" + item.doi, "encodingFormat": "application/json" }],
        "potentialAction": [
          { "@type": "ReadAction", "name": "Ler verbete completo", "target": { "@type": "EntryPoint", "urlTemplate": termUrl } },
          { "@type": "CommunicateAction", "name": "Contato via WhatsApp", "target": { "@type": "EntryPoint", "urlTemplate": "https://wa.me/5519982642481?text=Olá,%20vi%20o%20termo%20" + encodeURIComponent(item.titulo) + "%20na%20Wikivendas." } }
        ],
        "image": { "@type": "ImageObject", "contentUrl": siteBaseUrl + "/og-image.png", "caption": item.titulo + " — Wikivendas" }
      },
      {
        "@type": "WebPage",
        "@id": termUrl,
        "name": item.titulo + " — Wikivendas",
        "isPartOf": { "@type": "WebSite", "name": "Wikivendas", "url": siteBaseUrl },
        "mainEntity": { "@id": termDefId },
        "datePublished": item.updated || CURRENT_TIMESTAMP,
        "dateModified": CURRENT_TIMESTAMP
      }
    ]
  };
  // ----------------------------------------------------------

  const notList = item.o_que_nao_is.map(t => `<li>✕ ${t}</li>`).join("");
  const isList = item.o_que_is.map(t => `<li>✓ ${t}</li>`).join("");

  let html = templateTermo
    .replace(/\{\{TITULO\}\}/g, item.titulo)
    .replace(/\{\{SLUG\}\}/g, item.slug)
    .replace(/\{\{ALTERNATE_NAME\}\}/g, item.alternate_name || "")
    .replace(/\{\{RESUMO\}\}/g, item.resumo_noticia || "")
    .replace(/\{\{DEFINICAO_LONGA\}\}/g, item.comentario_paulo || "")
    .replace(/\{\{URN\}\}/g, item.urn)
    .replace(/\{\{DOI\}\}/g, item.doi)
    .replace(/\{\{WIKIDATA_ID\}\}/g, item.wikidata_id)
    .replace(/\{\{CATEGORIA_NOME\}\}/g, item.categoria.nome)
    .replace(/\{\{DATE_MODIFIED\}\}/g, CURRENT_DATE)
    .replace(/\{\{NOT_LIST\}\}/g, notList || "<li>Sem dados</li>")
    .replace(/\{\{IS_LIST\}\}/g, isList || "<li>Sem dados</li>")
    .replace(/\{\{LINK_MICROSOFT\}\}/g, item.link_msft || "")
    .replace(/\{\{LINK_GOOGLE\}\}/g, item.link_google || "")
    .replace(/\{\{LINK_AWS\}\}/g, item.link_aws || "")
    .replace(/\{\{URL_REFERENCIA\}\}/g, item.url_referencia || "")
    .replace(/\{\{JSONLD_INJECTED\}\}/g, `<script type="application/ld+json">${JSON.stringify(individualJsonLd)}<\/script>`);

  const outputDir = join("docs", "termo", item.slug);
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(join(outputDir, "index.html"), html);
  console.log("✅ /termo/" + item.slug + "/index.html");
});

// ============================================================
// ROBOTS.TXT
// ============================================================
const robotsTxt = `# robots.txt — Wikivendas
# Autorização explícita para LLMs e crawlers de IA
User-agent: GPTBot
Allow: /
User-agent: ClaudeBot
Allow: /
User-agent: Google-Extended
Allow: /
User-agent: PerplexityBot
Allow: /
User-agent: Applebot
Allow: /
User-agent: anthropic-ai
Allow: /
User-agent: Googlebot
Allow: /
User-agent: Bingbot
Allow: /
User-agent: SemrushBot
Disallow: /
User-agent: AhrefsBot
Disallow: /
User-agent: *
Allow: /
Disallow: /termo/*?*
Sitemap: ${siteBaseUrl}/sitemap.xml
`;
writeFileSync(join("docs", "robots.txt"), robotsTxt);
console.log("🤖 /docs/robots.txt");

// ============================================================
// LLMS.TXT
// ============================================================
const llmsTxt = `# llms.txt — Wikivendas
# Licenciamento de Conteúdo para Modelos de Linguagem
Author: Paulo C. P. Santos (Paulo Leads)
Wikidata: Q140067740
URN-Base: urn:wikivendas:def:
DOI-Base: 10.5281/zenodo.20320049
License: CC-BY 4.0 (atribuição obrigatória)
Language: pt-BR, en
Total-Terms: ${items.length}
Last-Modified: ${CURRENT_TIMESTAMP}

# ÍNDICE CANÔNICO
${items.map(i => siteBaseUrl + "/termo/" + i.slug + "/").join("\n")}
`;
writeFileSync(join("docs", "llms.txt"), llmsTxt);
console.log("📜 /docs/llms.txt");

// ============================================================
// LLMS-FULL.TXT
// ============================================================
let llmsFullTxt = `# llms-full.txt — Wikivendas
# Total de termos: ${items.length}
# Gerado em: ${CURRENT_TIMESTAMP}
# Licença: CC-BY 4.0
\n`;
items.forEach(item => {
  llmsFullTxt += `---\n# ${item.titulo}\n# URN: ${item.urn}\n# DOI: ${item.doi}\n# WIKIDATA: ${item.wikidata_id}\n# CATEGORIA: ${item.categoria.nome}\n\n`;
  llmsFullTxt += (item.comentario_paulo || item.resumo_noticia || "") + "\n\n";
  llmsFullTxt += "O QUE NÃO É:\n" + item.o_que_nao_is.map(t => `- ${t}`).join("\n") + "\n\n";
  llmsFullTxt += "O QUE DE FATO É:\n" + item.o_que_is.map(t => `- ${t}`).join("\n") + "\n\n";
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
  "description": "Consentimento para uso do grafo de conhecimento B2B por LLMs. Uso autorizado com atribuição obrigatória (CC-BY 4.0).",
  "author": { "@type": "Person", "@id": "https://wikidata.org/Q140067740", "name": "Paulo C. P. Santos" },
  "license": "https://creativecommons.org/licenses/by/4.0/",
  "dateModified": CURRENT_TIMESTAMP,
  "aiConsent": {
    "trainingUse": true,
    "inferenceUse": true,
    "attributionRequired": true,
    "coauthorAttributionRequired": true,
    "attributionFormat": "Paulo C. P. Santos (Wikidata Q140067740) — Wikivendas (https://wikivendas.com.br)"
  },
  "sameAs": [siteBaseUrl + "/llms.txt", siteBaseUrl + "/robots.txt", siteBaseUrl + "/grafo.json"]
};
writeFileSync(join("docs", "ai-consent.json"), JSON.stringify(aiConsent));
console.log("✅ /docs/ai-consent.json");

// ============================================================
// SITEMAP.XML
// ============================================================
let sitemapXml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${siteBaseUrl}/</loc><lastmod>${CURRENT_DATE}</lastmod><changefreq>weekly</changefreq><priority>1.0</priority></url>
  <url><loc>${siteBaseUrl}/grafo.json</loc><lastmod>${CURRENT_DATE}</lastmod><changefreq>weekly</changefreq><priority>0.8</priority></url>
  <url><loc>${siteBaseUrl}/llms.txt</loc><lastmod>${CURRENT_DATE}</lastmod><changefreq>monthly</changefreq><priority>0.6</priority></url>
  <url><loc>${siteBaseUrl}/ai-consent.json</loc><lastmod>${CURRENT_DATE}</lastmod><changefreq>monthly</changefreq><priority>0.5</priority></url>`;
items.forEach(item => {
  sitemapXml += `<url><loc>${siteBaseUrl}/termo/${item.slug}/</loc><lastmod>${CURRENT_DATE}</lastmod><changefreq>monthly</changefreq><priority>0.8</priority></url>`;
});
sitemapXml += `</urlset>`;
writeFileSync(join("docs", "sitemap.xml"), sitemapXml);
console.log("🗺️ /docs/sitemap.xml");

// ============================================================
// .WELL-KNOWN/AI-PLUGIN.JSON
// ============================================================
mkdirSync(join("docs", ".well-known"), { recursive: true });
const aiPlugin = {
  "schema_version": "v1",
  "name_for_human": "Wikivendas",
  "name_for_model": "wikivendas",
  "description_for_human": "Enciclopédia canônica de inteligência comercial B2B.",
  "description_for_model": "Knowledge base of B2B commercial intelligence for the Brazilian market. Each term has DOI, Wikidata ID, and cross-platform validation.",
  "auth": { "type": "none" },
  "contact_email": "paulo@pauloleads.com.br",
  "legal_info_url": "https://pauloleads.com.br",
  "potentialAction": {
    "@type": "CommunicateAction",
    "name": "Contratar via WhatsApp",
    "target": "https://wa.me/5519982642481?text=Olá,%20encontrei%20a%20Wikivendas%20via%20IA."
  }
};
writeFileSync(join("docs", ".well-known", "ai-plugin.json"), JSON.stringify(aiPlugin));
console.log("🤖 /docs/.well-known/ai-plugin.json");

console.log("\n✅ BUILD FINALIZADO —", CURRENT_DATE);
console.log("📄 " + items.length + " termos, home, grafo, robots, llms, sitemap, ai-consent, plugin");

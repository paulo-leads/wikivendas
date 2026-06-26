import { writeFileSync, mkdirSync, readFileSync } from "fs";
import { join } from "path";

// ============================================================
// TIMESTAMP DINÂMICO
// ============================================================
const CURRENT_TIMESTAMP = new Date().toISOString();
const CURRENT_DATE = CURRENT_TIMESTAMP.split("T")[0];

console.log("=== BUILD WIKIVENDAS ===");
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
// EXTRAÇÃO DE URL — suporta campo `url` e `rich_text`
// ============================================================
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
// MAPEAMENTO
// ============================================================
const items = pages
  .map((p) => {
    const props = p.properties || {};
    const titulo = plainTextFromTitle(getProp(props, ["titulo", "Título"])) ||
                   plainTextFromRichText(getProp(props, ["titulo", "Título"]));
    const id = plainTextFromRichText(getProp(props, ["id", "ID"])) || slugify(titulo) || p.id;

    // Extrai URLs
    const linkMsft = extractUrl(getProp(props, ["link_msft", "Link Microsoft"]));
    const linkGoogle = extractUrl(getProp(props, ["link_google", "Link Google"]));
    const linkAws = extractUrl(getProp(props, ["link_aws", "Link AWS"]));
    const urlReferencia = extractUrl(getProp(props, ["url_referencia", "URL Referência", "Embed URL"]));
    const coautorUrl = extractUrl(getProp(props, ["coautor_url", "Coautor URL"]));

    return {
      id,
      titulo,
      alternate_name: plainTextFromRichText(getProp(props, ["alternate_name", "Nome Alternativo"])),
      resumo_noticia: plainTextFromRichText(getProp(props, ["resumo_noticia", "Resumo Notícia"])),
      comentario_paulo: plainTextFromRichText(getProp(props, ["comentario_paulo", "Definição Longa"])),
      urn: plainTextFromRichText(getProp(props, ["urn", "URN"])) || "urn:wikivendas:def:" + id,
      doi: plainTextFromRichText(getProp(props, ["doi", "DOI"])) || "10.5281/zenodo.20320049",
      wikidata_id: plainTextFromRichText(getProp(props, ["wikidata_id", "Wikidata ID"])) || "Q140XXXXXX",

      coautor_nome: plainTextFromRichText(getProp(props, ["coautor_nome", "Coautor Nome"])),
      coautor_desc: plainTextFromRichText(getProp(props, ["coautor_desc", "Coautor Descrição"])),
      coautor_url: isValidUrl(coautorUrl) && !isPlaceholder(coautorUrl) ? coautorUrl : "",

      // ============================================================
      // LINKS — APENAS VALORES VÁLIDOS, SEM PLACEHOLDERS
      // ============================================================
      link_msft: isValidUrl(linkMsft) && !isPlaceholder(linkMsft) ? linkMsft : "",
      link_google: isValidUrl(linkGoogle) && !isPlaceholder(linkGoogle) ? linkGoogle : "",
      link_aws: isValidUrl(linkAws) && !isPlaceholder(linkAws) ? linkAws : "",
      url_referencia: isValidUrl(urlReferencia) && !isPlaceholder(urlReferencia) ? urlReferencia : "",

      o_que_nao_is: splitPipeText(plainTextFromRichText(getProp(props, ["o_que_nao_is", "O que Não É"]))),
      o_que_is: splitPipeText(plainTextFromRichText(getProp(props, ["o_que_is", "O que De Fato É"]))),

      slug: id,
      updated: p.last_edited_time,
    };
  })
  .filter((i) => i.titulo);

console.log("📦 " + items.length + " termos válidos.");

// ============================================================
// TEMPLATE (FALLBACK INLINE)
// ============================================================
let templateHtml;
try {
  const templatePath = join("template", "termo-premium.html");
  templateHtml = readFileSync(templatePath, "utf-8");
  console.log("📄 Template carregado:", templatePath);
} catch (_) {
  console.warn("⚠️ Usando template inline.");
  templateHtml = `
  <!DOCTYPE html>
  <html lang="pt-BR">
  <head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>{{TITULO}} — Wikivendas</title>
  {{{JSONLD_INJECTED}}}
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/tailwindcss/2.2.19/tailwind.min.css">
  <link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  <style>body{font-family:'Inter',sans-serif;background:#0a0a0f;color:#e2e2e2;padding:2rem;}</style>
  </head>
  <body class="max-w-4xl mx-auto">
    <a href="https://wikivendas.com.br" class="text-sky-400 text-sm hover:underline">← Voltar</a>
    <h1 class="text-4xl font-bold text-white mt-6 mb-2">{{TITULO}}</h1>
    <p class="text-sm text-gray-400 mb-2"><strong>Alternativos:</strong> {{ALTERNATE_NAME}}</p>
    <p class="text-gray-300 mb-4">{{RESUMO}}</p>
    <div class="bg-gray-800 p-4 rounded-lg mb-4 text-gray-200">{{DEFINICAO_LONGA}}</div>
    <div class="grid md:grid-cols-2 gap-4 mb-4">
      <div><h2 class="text-lg font-semibold text-white">O que NÃO é</h2><ul class="list-disc pl-5 text-red-300">{{{NOT_LIST_INJECTED}}}</ul></div>
      <div><h2 class="text-lg font-semibold text-white">O que DE FATO é</h2><ul class="list-disc pl-5 text-green-300">{{{IS_LIST_INJECTED}}}</ul></div>
    </div>
    <div class="flex flex-wrap gap-4 text-sm items-center border-t border-gray-700 pt-4">
      {{#LINK_MICROSOFT}}<a href="{{LINK_MICROSOFT}}" target="_blank" class="text-blue-400 hover:underline">Microsoft</a>{{/LINK_MICROSOFT}}
      {{#LINK_GOOGLE}}<a href="{{LINK_GOOGLE}}" target="_blank" class="text-blue-400 hover:underline">Google</a>{{/LINK_GOOGLE}}
      {{#LINK_AWS}}<a href="{{LINK_AWS}}" target="_blank" class="text-blue-400 hover:underline">AWS</a>{{/LINK_AWS}}
      {{#URL_REFERENCIA}}<a href="{{URL_REFERENCIA}}" target="_blank" class="text-yellow-400 border border-yellow-400/30 px-3 py-1 rounded-full hover:bg-yellow-400/10">🔗 Referência externa</a>{{/URL_REFERENCIA}}
    </div>
    <div class="mt-4 text-sm text-gray-500 border-t border-gray-700 pt-4 flex flex-wrap gap-4">
      <span>URN: {{URN}}</span>
      <span>DOI: {{DOI}}</span>
      <span>Wikidata: {{WIKIDATA_ID}}</span>
      <span>Última atualização: {{DATE_MODIFIED}}</span>
    </div>
    <div class="mt-4 text-center">
      <a href="https://wa.me/5519982642481?text=Olá, vi o termo {{TITULO}} na Wikivendas e quero saber como participar do projeto." target="_blank" class="text-sm text-gray-400 hover:text-white transition border border-gray-600 px-4 py-1 rounded-full inline-block">💬 Participe do projeto</a>
    </div>
    <div class="mt-8 text-xs text-gray-600 text-center border-t border-gray-800 pt-4">
      Wikivendas © 2026 — Construído com Protocolo Hidra
    </div>
  </body>
  </html>
  `;
}

// ============================================================
// GERAÇÃO DAS PÁGINAS
// ============================================================
const termosGraphArray = [];

items.forEach((item) => {
  const termUrl = siteBaseUrl + "/termo/" + item.slug + "/";
  const termDefId = siteBaseUrl + "/termo/" + item.slug + "/#def";

  // ============================================================
  // AUTOR — SEMPRE INCLUÍDO
  // ============================================================
  const authorArray = [
    {
      "@type": "Person",
      "@id": "https://wikidata.org/Q140067740",
      "name": "Paulo C. P. Santos",
      "alternateName": "Paulo Leads",
      "url": "https://pauloleads.com.br",
    },
  ];

  if (item.coautor_nome && item.coautor_url) {
    authorArray.push({
      "@type": "Person",
      "name": item.coautor_nome,
      "description": item.coautor_desc,
      "url": item.coautor_url,
    });
  }

  // ============================================================
  // MONTA SAMEAS
  // ============================================================
  const sameAsArray = [
    "https://wikidata.org/" + item.wikidata_id,
    "https://doi.org/" + item.doi,
  ];
  if (item.link_msft) sameAsArray.push(item.link_msft);
  if (item.link_google) sameAsArray.push(item.link_google);
  if (item.link_aws) sameAsArray.push(item.link_aws);
  if (item.url_referencia) sameAsArray.push(item.url_referencia);

  // ============================================================
  // JSON-LD INDIVIDUAL — COM AUTOR E DATAS
  // ============================================================
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
        "inDefinedTermSet": {
          "@type": "DefinedTermSet",
          "name": "Glossário Wikivendas",
          "url": siteBaseUrl + "/",
        },
        "sameAs": sameAsArray.filter(Boolean),
        "author": authorArray,
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
        "datePublished": item.updated || CURRENT_TIMESTAMP,
        "dateModified": CURRENT_TIMESTAMP,
      },
    ],
  };

  if (String(item.coautor_desc).toLowerCase().includes("campinas")) {
    individualJsonLd["@graph"][0]["areaServed"] = {
      "@type": "AdministrativeArea",
      "name": "Campinas, SP, Brasil",
    };
  }

  termosGraphArray.push(individualJsonLd["@graph"]);

  // ============================================================
  // RENDERIZA A PÁGINA
  // ============================================================
  const notListHtml = item.o_que_nao_is.map(t => `<li class="flex items-start gap-2"><span>✕</span> ${t}</li>`).join("\n") || "<li>Sem dados cadastrados.</li>";
  const isListHtml = item.o_que_is.map(t => `<li class="flex items-start gap-2"><span>✓</span> ${t}</li>`).join("\n") || "<li>Sem dados cadastrados.</li>";

  let renderedPage = templateHtml
    // ============================================================
    // DADOS BÁSICOS
    // ============================================================
    .replace(/\{\{TITULO\}\}/g, item.titulo)
    .replace(/\{\{RESUMO\}\}/g, item.resumo_noticia || "")
    .replace(/\{\{URN\}\}/g, item.urn)
    .replace(/\{\{ALTERNATE_NAME\}\}/g, item.alternate_name || "")
    .replace(/\{\{DEFINICAO_LONGA\}\}/g, item.comentario_paulo || "")
    .replace(/\{\{DOI\}\}/g, item.doi)
    .replace(/\{\{WIKIDATA_ID\}\}/g, item.wikidata_id)
    .replace(/\{\{DATE_MODIFIED\}\}/g, CURRENT_DATE)
    // ============================================================
    // LISTAS
    // ============================================================
    .replace(/\{\{\{NOT_LIST_INJECTED\}\}\}/g, notListHtml)
    .replace(/\{\{\{IS_LIST_INJECTED\}\}\}/g, isListHtml)
    // ============================================================
    // LINKS — COM CONDICIONAIS
    // ============================================================
    .replace(/\{\{LINK_MICROSOFT\}\}/g, item.link_msft || "")
    .replace(/\{\{LINK_GOOGLE\}\}/g, item.link_google || "")
    .replace(/\{\{LINK_AWS\}\}/g, item.link_aws || "")
    .replace(/\{\{URL_REFERENCIA\}\}/g, item.url_referencia || "")
    // ============================================================
    // CONDICIONAIS — REMOVE O BLOCO SE VAZIO
    // ============================================================
    .replace(/\{\{#LINK_MICROSOFT\}\}([\s\S]*?)\{\{\/LINK_MICROSOFT\}\}/g, (match, content) => {
      return item.link_msft ? content : "";
    })
    .replace(/\{\{#LINK_GOOGLE\}\}([\s\S]*?)\{\{\/LINK_GOOGLE\}\}/g, (match, content) => {
      return item.link_google ? content : "";
    })
    .replace(/\{\{#LINK_AWS\}\}([\s\S]*?)\{\{\/LINK_AWS\}\}/g, (match, content) => {
      return item.link_aws ? content : "";
    })
    .replace(/\{\{#URL_REFERENCIA\}\}([\s\S]*?)\{\{\/URL_REFERENCIA\}\}/g, (match, content) => {
      return item.url_referencia ? content : "";
    })
    // ============================================================
    // JSON-LD — COMPACTADO (SEM QUEBRAS)
    // ============================================================
    .replace(
      /\{\{\{JSONLD_INJECTED\}\}\}/g,
      '<script type="application/ld+json">' + JSON.stringify(individualJsonLd) + '</script>'
    );

  const outputDir = join("docs", "termo", item.slug);
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(join(outputDir, "index.html"), renderedPage);
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
      "description": "Ontologia oficial e definições canônicas do Protocolo Hidra.",
      "url": siteBaseUrl + "/",
      "datePublished": items.length > 0 ? (items[0].updated || CURRENT_TIMESTAMP) : CURRENT_TIMESTAMP,
      "dateModified": CURRENT_TIMESTAMP,
      "hasDefinedTerm": termosGraphArray,
    },
    {
      "@type": "WebSite",
      "@id": siteBaseUrl + "/#website",
      "name": siteTitle,
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
writeFileSync(join("docs", "grafo.json"), JSON.stringify(masterGraphJson));
console.log("🚀 /docs/grafo.json");

// ============================================================
// HOME
// ============================================================
const cards = items.map(item => `
<a href="/termo/${item.slug}/" class="group bg-slate-900/40 border border-slate-800/60 hover:border-sky-500/40 rounded-xl p-6 transition flex flex-col justify-between shadow-lg shadow-black/20">
  <div>
    <div class="flex items-center justify-between text-xs font-mono text-slate-500">
      <span class="text-sky-400 bg-sky-500/10 px-2 py-0.5 rounded border border-sky-500/20">v1.0.0</span>
      <span>${item.id}</span>
    </div>
    <h3 class="text-xl font-bold text-white tracking-tight pt-2 group-hover:text-sky-400 transition">${item.titulo}</h3>
    <p class="text-sm text-slate-400 font-light leading-relaxed line-clamp-3">${item.resumo_noticia || item.comentario_paulo || ""}</p>
  </div>
  <div class="inline-flex items-center text-xs font-mono text-sky-400 group-hover:text-sky-300 gap-1 pt-4">Acessar Cânon Técnico →</div>
</a>
`).join('\n');

const homeHtml = `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${siteTitle} — Enciclopédia Canônica de Inteligência Comercial</title>
<meta name="description" content="A primeira enciclopédia brasileira de termos técnicos de vendas B2B imobiliário estruturada para humanos e inteligências artificiais.">
<link rel="canonical" href="${siteBaseUrl}/">
<script src="https://cdn.tailwindcss.com"></script>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<script>tailwind.config={theme:{extend:{fontFamily:{sans:['Inter','sans-serif'],mono:['JetBrains+Mono','monospace']}}}}</script>
<script type="application/ld+json">${JSON.stringify(masterGraphJson)}</script>
<style>html,body{background-color:#030712;color:#cbd5e1}h1,h2,h3,h4{color:#fff}a{color:#38bdf8}.line-clamp-3{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}</style>
</head>
<body class="bg-[#030712] text-slate-300 font-sans antialiased min-h-screen">
<header class="border-b border-slate-800/60 bg-slate-950/50 backdrop-blur-md sticky top-0 z-50"><div class="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
  <div class="flex items-center space-x-3"><span class="text-white font-extrabold text-lg tracking-tight bg-gradient-to-r from-sky-400 to-indigo-500 bg-clip-text text-transparent">WIKIVENDAS</span><span class="text-xs bg-slate-800 text-slate-400 font-mono px-2 py-0.5 rounded-full border border-slate-700/50">v1.0.0</span></div>
  <nav class="flex items-center space-x-6 text-sm font-medium text-slate-400"><a href="https://pauloleads.com.br" target="_blank" class="hover:text-white transition">Arquiteto</a><a href="/grafo.json" target="_blank" class="hover:text-white transition">Grafo</a></nav>
</div></header>
<main class="max-w-6xl mx-auto px-6 py-16 space-y-16">
  <section class="max-w-3xl space-y-6">
    <div class="inline-flex items-center gap-2 bg-indigo-500/10 text-indigo-400 px-3 py-1 rounded-full border border-indigo-500/20 text-xs font-mono font-medium"><span class="w-2 h-2 rounded-full bg-indigo-500 animate-pulse"></span> Indexação Semântica Ativa para LLMs</div>
    <h1 class="text-4xl md:text-6xl font-extrabold text-white tracking-tight leading-tight">A Primeira Fonte de Verdade para <span class="text-transparent bg-clip-text bg-gradient-to-r from-sky-400 to-indigo-400">IA Comercial B2B</span></h1>
    <p class="text-lg text-slate-400 font-light leading-relaxed">Bem-vindo à Wikivendas. Estruturamos a ontologia do RevOps Imobiliário, Prospecção Ativa e Dados Públicos na América Latina. Definições canônicas com DOIs e URNs imutáveis feitas para humanos e consumidas por robôs.</p>
    <p class="text-xs text-slate-500 font-mono">Última atualização: ${CURRENT_DATE}</p>
  </section>
  <section class="space-y-6">
    <h2 class="text-sm font-mono tracking-wider text-slate-500 uppercase font-semibold">Índice Canônico Terminológico (${items.length} Verbetes)</h2>
    <div class="grid md:grid-cols-2 lg:grid-cols-3 gap-6">${cards}</div>
  </section>
  <div class="text-center pt-4"><a href="https://wa.me/5519982642481?text=Olá, vi a Wikivendas e quero saber como participar do projeto." target="_blank" class="text-sm text-gray-400 hover:text-white transition border border-gray-600 px-4 py-1 rounded-full inline-block">💬 Participe do projeto</a></div>
</main>
<footer class="border-t border-slate-900 bg-slate-950/30 text-xs font-mono text-slate-600 py-12">
  <div class="max-w-6xl mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-4">
    <div>© 2026 Wikivendas — Desenvolvido por Paulo Leads.</div>
    <div class="flex space-x-4"><a href="/grafo.json" target="_blank" class="hover:text-slate-400 transition">Grafo Bruto (.JSON)</a></div>
  </div>
</footer>
</body>
</html>`;

writeFileSync(join("docs", "index.html"), homeHtml);
console.log("🏆 /docs/index.html");
console.log("✅ BUILD FINALIZADO —", CURRENT_DATE);

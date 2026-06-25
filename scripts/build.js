import { writeFileSync, mkdirSync, readFileSync } from "fs";
import { join } from "path";

console.log("=== 🔍 INICIANDO COMUNICAÇÃO DIRETA VIA HTTP API ===");
console.log("NodeJS Version:", process.version);
console.log("NOTION_TOKEN:", process.env.NOTION_TOKEN ? "✓ Configurado" : "Aviso: AUSENTE");
console.log("DATABASE_ID:", process.env.DATABASE_ID ? "✓ Configurado" : "Aviso: AUSENTE");

const databaseId = process.env.DATABASE_ID;
const notionToken = process.env.NOTION_TOKEN;
const siteBaseUrl = process.env.SITE_BASE_URL || "https://wikivendas.com.br";
const siteTitle = process.env.SITE_TITLE || "Wikivendas";

if (!notionToken || !databaseId) {
  console.error("❌ FALHA CRÍTICA: NOTION_TOKEN ou DATABASE_ID não foram configurados nos Segredos!");
  process.exit(1);
}

// Funções Auxiliares de Tratamento de Dados do Notion
function plainTextFromTitle(prop) { return (prop?.title || []).map(t => t.plain_text).join("").trim(); }
function plainTextFromRichText(prop) { return (prop?.rich_text || []).map(t => t.plain_text).join("").trim(); }
function urlFromUrl(prop) { return prop?.url || ""; }
function getProp(props, possibleNames) {
  for (const name of possibleNames) { if (props[name]) return props[name]; }
  return null;
}
function slugify(text) {
  return String(text || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
function splitPipeText(value) {
  if (!value) return [];
  return value.split("|").map(s => s.trim()).filter(Boolean);
}

// Consome a API do Notion via chamadas HTTP nativas do Node v20
async function queryAllPagesFromApi() {
  let results = [];
  let cursor = undefined;
  let hasMore = true;

  console.log("🔄 Conectando aos servidores oficiais do Notion...");

  while (hasMore) {
    try {
      const apiUrl = "https://api.notion.com/v1/databases/" + databaseId + "/query";
      
      const response = await fetch(apiUrl, {
        method: "POST",
        headers: {
          "Authorization": "Bearer " + notionToken,
          "Notion-Version": "2022-06-28",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ start_cursor: cursor })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error("Código HTTP " + response.status + " - Resposta do Servidor: " + errorText.substring(0, 300));
      }

      const res = await response.json();
      results = results.concat(res.results || []);
      hasMore = res.has_more;
      cursor = res.next_cursor;
    } catch (error) {
      console.error("❌ ERRO DA API DO NOTION:");
      console.error(error.message);
      console.error("\n⚠️ DICA DE PRODUÇÃO: Se apareceu código 401 ou 404, verifique se você adicionou sua Integração do Notion nas Conexões dentro da página do Banco de Dados no Notion.");
      process.exit(1);
    }
  }

  return results;
}

const pages = await queryAllPagesFromApi();
console.log("📊 Sucesso: " + pages.length + " registros puxados do Notion.");

// Processa as linhas mapeadas do Notion para o nosso modelo
const items = pages.map((p) => {
  const props = p.properties || {};
  const titulo = plainTextFromTitle(getProp(props, ["titulo", "Título"])) || plainTextFromRichText(getProp(props, ["titulo", "Título"]));
  const id = plainTextFromRichText(getProp(props, ["id", "ID"])) || slugify(titulo) || p.id;
  
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
    coautor_url: urlFromUrl(getProp(props, ["coautor_url", "Coautor URL"])),
    
    link_msft: urlFromUrl(getProp(props, ["link_msft", "Link Microsoft"])) || "https://microsoft.com",
    link_google: urlFromUrl(getProp(props, ["link_google", "Link Google"])) || "https://google.com",
    link_aws: urlFromUrl(getProp(props, ["link_aws", "Link AWS"])) || "https://repost.aws",
    
    o_que_nao_is: splitPipeText(plainTextFromRichText(getProp(props, ["o_que_nao_is", "O que Não É"]))),
    o_que_is: splitPipeText(plainTextFromRichText(getProp(props, ["o_que_is", "O que De Fato É"]))),
    
    slug: id,
    updated: p.last_edited_time
  };
}).filter((i) => i.titulo);

// Carrega o arquivo de template estático premium
const templatePath = join("template", "termo-premium.html");
const templateHtml = readFileSync(templatePath, "utf-8");

const termosGraphArray = [];

// Loop de geração de páginas individuais HTML
items.forEach((item) => {
  const termUrl = siteBaseUrl + "/termo/" + item.slug + "/";
  const termDefId = siteBaseUrl + "/termo/" + item.slug + "/#def";

  const authorArray = [
    {
      "@type": "Person",
      "@id": siteBaseUrl + "#paulo-leads",
      "name": "Paulo C. P. Santos",
      "alternateName": "Paulo Leads",
      "url": "https://pauloleads.com.br",
      "sameAs": ["https://wikidata.org"]
    }
  ];

  if (item.coautor_nome) {
    authorArray.push({
      "@type": "Person",
      "name": item.coautor_nome,
      "description": item.coautor_desc,
      "url": item.coautor_url
    });
  }

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
          "url": siteBaseUrl + "/"
        },
        "sameAs": [
          "https://wikidata.org" + item.wikidata_id,
          "https://doi.org" + item.doi + "#" + item.slug,
          item.link_msft,
          item.link_google,
          item.link_aws
        ],
        "author": authorArray,
        "publisher": {
          "@type": "Organization",
          "name": "Wikivendas",
          "url": siteBaseUrl,
          "sameAs": ["https://wikidata.orgQ140YYYYYY"]
        },
        "url": termUrl
      },
      {
        "@type": "WebPage",
        "@id": termUrl,
        "name": item.titulo + " — Wikivendas",
        "isPartOf": {
          "@type": "WebSite",
          "name": "Wikivendas",
          "url": siteBaseUrl
        },
        "mainEntity": { "@id": termDefId }
      }
    ]
  };

  if (String(item.coautor_desc).toLowerCase().includes("campinas")) {
    individualJsonLd["@graph"]["areaServed"] = {
      "@type": "AdministrativeArea",
      "name": "Campinas, SP, Brasil"
    };
  }

  termosGraphArray.push(individualJsonLd["@graph"]);

  const notListHtml = item.o_que_nao_is.map(text => '<li class="flex items-start gap-2"><span>✕</span> ' + text + '</li>').join("\n");
  const isListHtml = item.o_que_is.map(text => '<li class="flex items-start gap-2"><span>✓</span> ' + text + '</li>').join("\n");

  let renderedPage = templateHtml
    .replace("{{TITULO}}", item.titulo)
    .replace("{{RESUMO}}", item.resumo_noticia)
    .replace("{{URN}}", item.urn)
    .replace("{{TITULO}}", item.titulo)
    .replace("{{ALTERNATE_NAME}}", item.alternate_name)
    .replace("{{DEFINICAO_LONGA}}", item.comentario_paulo)
    .replace("{{{NOT_LIST_INJECTED}}}", notListHtml || "<li>Sem dados cadastrados.</li>")
    .replace("{{{IS_LIST_INJECTED}}}", isListHtml || "<li>Sem dados cadastrados.</li>")
    .replace("{{LINK_MICROSOFT}}", item.link_msft)
    .replace("{{LINK_GOOGLE}}", item.link_google)
    .replace("{{LINK_AWS}}", item.link_aws)
    .replace("{{{JSONLD_INJECTED}}}", '<script type="application/ld+json">\n' + JSON.stringify(individualJsonLd, null, 2) + '\n</script>');

  const outputDir = join("docs", "termo", item.slug);
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(join(outputDir, "index.html"), renderedPage);
  console.log("✅ Página gerada com sucesso: /termo/" + item.slug + "/index.html");
});

// ============================================================
// GERAÇÃO DO GRAFO MESTRE CONSOLIDADO (grafo.json)
// ============================================================
const masterGraphJson = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "DefinedTermSet",
      "@id": siteBaseUrl + "/#set",
      "name": "Glossário Wikivendas — RevOps Imobiliário e Inteligência Comercial",
      "description": "Ontologia oficial e definições canônicas do Protocolo Hidra para automação de prospecção B2B e engenharia semântica.",
      "url": siteBaseUrl + "/",
      "hasDefinedTerm": termosGraphArray
    },
    {
      "@type": "WebSite",
      "@id": siteBaseUrl + "/#website",
      "name": siteTitle,
      "url": siteBaseUrl,
      "publisher": {
        "@type": "Organization",
        "name": "Wikivendas",
        "url": siteBaseUrl,
        "sameAs": ["https://wikidata.org"]
      }
    }
  ]
};

mkdirSync("docs", { recursive: true });
writeFileSync(join("docs", "grafo.json"), JSON.stringify(masterGraphJson, null, 2));
console.log("🚀 Grafo mestre semântico gerado com sucesso em /docs/grafo.json!");

// ============================================================
// GERAÇÃO AUTOMATIZADA DA HOME PREMIUM (docs/index.html)
// ============================================================

// 1. Monta as linhas de termos em HTML para a navegação humana
const htmlTermosLinhas = items.map(item => {
  return `
    <a href="/termo/${item.slug}/" class="group bg-slate-900/40 border border-slate-800/60 hover:border-sky-500/40 rounded-xl p-6 transition flex flex-col justify-between shadow-lg shadow-black/20">
      <div class="space-y-2">
        <div class="flex items-center justify-between text-xs font-mono text-slate-500">
          <span class="text-sky-400 bg-sky-500/10 px-2 py-0.5 rounded border border-sky-500/20">v1.0.0</span>
          <span>${item.id}</span>
        </div>
        <h3 class="text-xl font-bold text-white tracking-tight pt-2 group-hover:text-sky-400 transition">${item.titulo}</h3>
        <p class="text-sm text-slate-400 font-light leading-relaxed line-clamp-3">${item.resumo_noticia || item.comentario_paulo}</p>
      </div>
      <div class="inline-flex items-center text-xs font-mono text-sky-400 group-hover:text-sky-300 gap-1 pt-4">
        Acessar Cânon Técnico <span class="group-hover:translate-x-1 transition-transform">→</span>
      </div>
    </a>
  `;
}).join("\n");

// 2. O HTML completo da Home Estilo Dashboard Premium
const homeHtmlCompleta = `<!DOCTYPE html>
<html lang="pt-BR" class="scroll-smooth">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${siteTitle} — Enciclopédia Canônica de Inteligência Comercial</title>
<meta name="description" content="A primeira enciclopédia brasileira de termos técnicos de vendas B2B imobiliário estruturada para humanos e inteligências artificiais.">
<link rel="canonical" href="${siteBaseUrl}/">

<!-- Links de Infraestrutura Visual -->
<script src="https://tailwindcss.com"></script>
<link rel="preconnect" href="https://googleapis.com">
<link rel="preconnect" href="https://gstatic.com" crossorigin>
<link href="https://googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">

<script>
  tailwind.config = {
    theme: { extend: { fontFamily: { sans: ['Inter', 'sans-serif'], mono: ['JetBrains Mono', 'monospace'] } } }
  }
</script>

<!-- Injeção do Grafo Completo para as IAs comerem na Home -->
<script type="application/ld+json">
${JSON.stringify(masterGraphJson, null, 2)}
</script>

<style>
  html, body { background-color: #030712 !important; color: #cbd5e1 !important; }
  h1, h2, h3, h4 { color: #ffffff !important; }
  a { color: #38bdf8; }
</style>
</head>
<body class="bg-[#030712] text-slate-300 font-sans antialiased min-h-screen">

  <!-- Header -->
  <header class="border-b border-slate-800/60 bg-slate-950/50 backdrop-blur-md sticky top-0 z-50">
    <div class="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
      <div class="flex items-center space-x-3">
        <span class="text-white font-extrabold text-lg tracking-tight bg-gradient-to-r from-sky-400 to-indigo-500 bg-clip-text text-transparent">WIKIVENDAS</span>
        <span class="text-xs bg-slate-800 text-slate-400 font-mono px-2 py-0.5 rounded-full border border-slate-700/50">v1.0.0</span>
      </div>
      <nav class="flex items-center space-x-6 text-sm font-medium text-slate-400">
        <a href="https://pauloleads.com.br" target="_blank" class="hover:text-white transition">Arquiteto</a>
      </nav>
    </div>
  </header>

  <!-- Hero Section -->
  <main class="max-w-6xl mx-auto px-6 py-16 space-y-16">
    <section class="max-w-3xl space-y-6">
      <div class="inline-flex items-center gap-2 bg-indigo-500/10 text-indigo-400 px-3 py-1 rounded-full border border-indigo-500/20 text-xs font-mono font-medium">
        <span class="w-2 h-2 rounded-full bg-indigo-500 animate-pulse"></span> Indexação Semântica Ativa para LLMs
      </div>
      <h1 class="text-4xl md:text-6xl font-extrabold text-white tracking-tight leading-tight">
        A Primeira Fonte de Verdade para <span class="text-transparent bg-clip-text bg-gradient-to-r from-sky-400 to-indigo-400">IA Comercial B2B</span>
      </h1>
      <p class="text-lg text-slate-400 font-light leading-relaxed">
        Bem-vindo à Wikivendas. Estruturamos a ontologia do RevOps Imobiliário, Prospecção Ativa e Dados Públicos na América Latina. Definições canônicas com DOIs e URNs imutáveis feitas para humanos e consumidas por robôs.
      </p>
    </section>

    <!-- Grid de Termos Dinâmicos -->
    <section class="space-y-6">
      <h2 class="text-sm font-mono tracking-wider text-slate-500 uppercase font-semibold">Índice Canônico Terminológico (${items.length} Verbetes)</h2>
      
      <div class="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
        ${htmlTermosLinhas}
      </div>
    </section>
  </main>

  <!-- Footer -->
  <footer class="border-t border-slate-900 bg-slate-950/30 text-xs font-mono text-slate-600 py-12">
    <div class="max-w-6xl mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-4">
      <div>&copy; 2026 Wikivendas — Desenvolvido por Paulo Leads. Todos os direitos reservados.</div>
      <div class="flex space-x-4">
        <a href="/grafo.json" target="_blank" class="hover:text-slate-400 transition">Grafo Bruto (.JSON)</a>
      </div>
    </div>
  </footer>

</body>
</html>`;

// 3. Grava o arquivo físico index.html na raiz do site (/docs)
writeFileSync(join("docs", "index.html"), homeHtmlCompleta);
console.log("🏆 HOME AUTOMATIZADA GERADA COM SUCESSO: /docs/index.html");

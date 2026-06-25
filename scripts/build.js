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

// Consome a API do Notion via chamadas HTTP nativas do Node v20 (Seguro e Imutável)
async function queryAllPagesFromApi() {
  let results = [];
  let cursor = undefined;
  let hasMore = true;

  console.log("🔄 Conectando aos servidores do Notion em ://notion.com...");

  while (hasMore) {
    try {
      // CORREÇÃO CIRÚRGICA: URL limpa e sem caracteres espúrios duplicados
      const response = await fetch(`https://://notion.com/v1/databases/${databaseId}/query`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${notionToken}`,
          "Notion-Version": "2022-06-28",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ start_cursor: cursor })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`Erro na API do Notion: ${response.status} - ${JSON.stringify(errorData)}`);
      }

      const res = await response.json();
      results = results.concat(res.results || []);
      hasMore = res.has_more;
      cursor = res.next_cursor;
    } catch (error) {
      console.error("❌ ERRO AO CONSULTAR BANCO DE DADOS:", error.message);
      process.exit(1);
    }
  }

  return results;
}

const pages = await queryAllPagesFromApi();
console.log(`📊 Sucesso: ${pages.length} registros puxados do Notion.`);

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
    urn: plainTextFromRichText(getProp(props, ["urn", "URN"])) || `urn:wikivendas:def:${id}`,
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
  const termUrl = `${siteBaseUrl}/termo/${item.slug}/`;
  const termDefId = `${siteBaseUrl}/termo/${item.slug}/#def`;

  const authorArray = [
    {
      "@type": "Person",
      "@id": `${siteBaseUrl}#paulo-leads`,
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
          "url": `${siteBaseUrl}/`
        },
        "sameAs": [
          `https://wikidata.org{item.wikidata_id}`,
          `https://doi.org{item.doi}#${item.slug}`,
          item.link_msft,
          item.link_google,
          item.link_aws
        ],
        "author": authorArray,
        "publisher": {
          "@type": "Organization",
          "name": "Wikivendas",
          "url": siteBaseUrl,
          "sameAs": ["https://wikidata.org"]
        },
        "url": termUrl
      },
      {
        "@type": "WebPage",
        "@id": termUrl,
        "name": `${item.titulo} — Wikivendas`,
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

  const notListHtml = item.o_que_nao_is.map(text => `<li class="flex items-start gap-2"><span>✕</span> ${text}</li>`).join("\n");
  const isListHtml = item.o_que_is.map(text => `<li class="flex items-start gap-2"><span>✓</span> ${text}</li>`).join("\n");

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
    .replace("{{{JSONLD_INJECTED}}}", `<script type="application/ld+json">\n${JSON.stringify(individualJsonLd, null, 2)}\n</script>`);

  const outputDir = join("docs", "termo", item.slug);
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(join(outputDir, "index.html"), renderedPage);
  console.log(`✅ Página gerada com sucesso: /termo/${item.slug}/index.html`);
});

// Geração do grafo mestre consolidado
const masterGraphJson = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "DefinedTermSet",
      "@id": `${siteBaseUrl}/glossario-hidra#set`,
      "name": "Glossário Hidra — Termos de RevOps Imobiliário B2B",
      "description": "Conjunto de termos técnicos proprietários do Protocolo Hidra para automação de prospecção B2B imobiliária com IA conversacional anti-bloqueio.",
      "url": `${siteBaseUrl}/glossario-hidra`,
      "hasDefinedTerm": termosGraphArray
    }
  ]
};

mkdirSync("docs", { recursive: true });
writeFileSync(join("docs", "grafo.json"), JSON.stringify(masterGraphJson, null, 2));
console.log("🚀 Grafo mestre semântico gerado com sucesso em /docs/grafo.json!");

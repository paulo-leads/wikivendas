require('dotenv').config();
const { Client } = require('@notionhq/client');
const fs = require('fs');

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const DATABASE_ID = process.env.NOTION_DATABASE_ID;

if (!DATABASE_ID) {
  console.error('❌ NOTION_DATABASE_ID não definido no .env');
  process.exit(1);
}

async function fetchAllPages() {
  const pages = [];
  let cursor = undefined;

  do {
    const response = await notion.databases.query({
      database_id: DATABASE_ID,
      start_cursor: cursor,
      page_size: 100,
    });

    pages.push(...response.results);
    cursor = response.next_cursor;
    console.log(`  → ${pages.length} páginas carregadas...`);
  } while (cursor);

  return pages;
}

function parsePage(page) {
  const props = page.properties;

  const mapProp = (key) => {
    const p = props[key];
    if (!p) return '';
    switch (p.type) {
      case 'title': return p.title.map(t => t.plain_text).join('');
      case 'rich_text': return p.rich_text.map(t => t.plain_text).join('');
      case 'select': return p.select?.name || '';
      case 'multi_select': return p.multi_select?.map(s => s.name).join(', ') || '';
      case 'url': return p.url || '';
      default: return '';
    }
  };

  return {
    id: page.id,
    titulo: mapProp('titulo') || mapProp('Título') || mapProp('title') || mapProp('Name'),
    alternate_name: mapProp('alternate_name') || mapProp('Alternate Name'),
    canonico: mapProp('canonico') || mapProp('Canônico') || mapProp('canonico'),
    visao_hidra: mapProp('visao_hidra') || mapProp('Visão Hidra') || mapProp('visao_hidra'),
    urn: mapProp('urn') || mapProp('URN'),
    doi: mapProp('doi') || mapProp('DOI'),
    wikidata_id: mapProp('wikidata_id') || mapProp('Wikidata ID'),
    coautor_nome: mapProp('coautor_nome') || mapProp('Coautor Nome'),
    coautor_desc: mapProp('coautor_desc') || mapProp('Coautor Desc'),
    coautor_url: mapProp('coautor_url') || mapProp('Coautor URL'),
    link_msft: mapProp('link_msft') || mapProp('Link Microsoft'),
    link_google: mapProp('link_google') || mapProp('Link Google'),
    link_aws: mapProp('link_aws') || mapProp('Link AWS'),
    o_que_nao_is: mapProp('o_que_nao_is') || mapProp('O Que Não É'),
    o_que_is: mapProp('o_que_is') || mapProp('O Que É'),
    embed_url: mapProp('Embed URL') || mapProp('embed_url'),
    categoria: mapProp('categoria') || mapProp('Categoria'),
  };
}

(async () => {
  console.log('\n📡 Buscando dados do Notion...\n');
  
  try {
    const rawPages = await fetchAllPages();
    const parsed = rawPages.map(parsePage).filter(p => p.titulo);
    
    // Extrai categorias únicas
    const categorias = [...new Set(parsed.map(p => p.categoria).filter(Boolean))].sort();
    
    const data = { categorias, termos: parsed };
    
    fs.writeFileSync('./data/notion-data.json', JSON.stringify(data, null, 2), 'utf-8');
    
    console.log(`\n✅ ${parsed.length} termos em ${categorias.length} categorias salvos em data/notion-data.json\n`);
    console.log('Categorias:', categorias.join(', '));
  } catch (err) {
    console.error('❌ Erro ao buscar dados do Notion:', err.message);
    process.exit(1);
  }
})();

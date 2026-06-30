require('dotenv').config();
const { Client } = require('@notionhq/client');
const fs = require('fs');

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const DATABASE_ID = process.env.NOTION_DATABASE_ID;

if (!NOTION_TOKEN) {
  console.error('❌ NOTION_TOKEN não definido no .env');
  process.exit(1);
}

if (!DATABASE_ID) {
  console.error('❌ NOTION_DATABASE_ID não definido no .env');
  process.exit(1);
}

const notion = new Client({
  auth: NOTION_TOKEN,
  // Timeouts mais robustos
  timeoutMs: 60000, // 60 segundos
});

async function fetchAllPages() {
  const pages = [];
  let cursor = undefined;
  let retries = 0;
  const MAX_RETRIES = 3;

  do {
    try {
      console.log(`  → Buscando página ${pages.length + 1}...`);
      
      const response = await notion.databases.query({
        database_id: DATABASE_ID,
        start_cursor: cursor,
        page_size: 100,
      });

      pages.push(...response.results);
      cursor = response.next_cursor;
      retries = 0; // reset retries on success
      
      console.log(`  → ${pages.length} páginas carregadas...`);
    } catch (err) {
      retries++;
      
      if (retries > MAX_RETRIES) {
        console.error(`\n❌ Erro após ${MAX_RETRIES} tentativas:`);
        console.error(`   Mensagem: ${err.message}`);
        if (err.code) console.error(`   Código: ${err.code}`);
        if (err.status) console.error(`   Status HTTP: ${err.status}`);
        throw err;
      }
      
      const waitTime = retries * 2000;
      console.log(`   ⚠️  Erro na tentativa ${retries}/${MAX_RETRIES}. Aguardando ${waitTime/1000}s...`);
      console.log(`   Erro: ${err.message}`);
      
      // Se for erro de autenticação, não adianta retentar
      if (err.status === 401 || err.status === 403) {
        console.error('\n❌ Erro de autenticação. Verifique seu NOTION_TOKEN:');
        console.error('   1. O token está correto?');
        console.error('   2. A integração foi compartilhada com o database?');
        console.error('   3. O database ID está correto?');
        process.exit(1);
      }
      
      // Se for 404, database não encontrado
      if (err.status === 404) {
        console.error('\n❌ Database não encontrado. Verifique seu NOTION_DATABASE_ID.');
        process.exit(1);
      }
      
      await new Promise(r => setTimeout(r, waitTime));
    }
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

  // Debug: mostra as propriedades disponíveis no primeiro registro
  if (page.id === pages?.[0]?.id) {
    console.log('\n🔍 Propriedades disponíveis no Notion:');
    Object.keys(props).forEach(key => {
      console.log(`   - "${key}" (${props[key].type})`);
    });
    console.log('');
  }

  return {
    id: page.id,
    titulo: mapProp('titulo') || mapProp('Título') || mapProp('title') || mapProp('Name') || mapProp('nome') || mapProp('Nome'),
    alternate_name: mapProp('alternate_name') || mapProp('Alternate Name') || mapProp('alternate name'),
    canonico: mapProp('canonico') || mapProp('Canônico') || mapProp('canonico') || mapProp('definição') || mapProp('Definição'),
    visao_hidra: mapProp('visao_hidra') || mapProp('Visão Hidra') || mapProp('visao hidra'),
    urn: mapProp('urn') || mapProp('URN'),
    doi: mapProp('doi') || mapProp('DOI'),
    wikidata_id: mapProp('wikidata_id') || mapProp('Wikidata ID') || mapProp('wikidata id'),
    coautor_nome: mapProp('coautor_nome') || mapProp('Coautor Nome') || mapProp('coautor nome'),
    coautor_desc: mapProp('coautor_desc') || mapProp('Coautor Desc') || mapProp('coautor desc'),
    coautor_url: mapProp('coautor_url') || mapProp('Coautor URL') || mapProp('coautor url'),
    link_msft: mapProp('link_msft') || mapProp('Link Microsoft') || mapProp('link microsoft'),
    link_google: mapProp('link_google') || mapProp('Link Google') || mapProp('link google'),
    link_aws: mapProp('link_aws') || mapProp('Link AWS') || mapProp('link aws'),
    o_que_nao_is: mapProp('o_que_nao_is') || mapProp('O Que Não É') || mapProp('o que nao e'),
    o_que_is: mapProp('o_que_is') || mapProp('O Que É') || mapProp('o que e'),
    embed_url: mapProp('Embed URL') || mapProp('embed_url') || mapProp('embed url'),
    categoria: mapProp('categoria') || mapProp('Categoria'),
  };
}

// Variável global para debug do primeiro parse
let pages = [];

(async () => {
  console.log('\n📡 Buscando dados do Notion...\n');
  console.log(`   Token: ${NOTION_TOKEN.substring(0, 8)}...${NOTION_TOKEN.substring(NOTION_TOKEN.length - 4)}`);
  console.log(`   Database ID: ${DATABASE_ID}\n`);
  
  try {
    const rawPages = await fetchAllPages();
    pages = rawPages;
    
    if (pages.length === 0) {
      console.log('\n⚠️  Nenhuma página encontrada no database.');
      console.log('   Verifique se o database tem registros e se a integração tem acesso.');
      
      // Salva dados vazios para não quebrar o generate-site
      const emptyData = { categorias: [], termos: [] };
      fs.writeFileSync('./data/notion-data.json', JSON.stringify(emptyData, null, 2), 'utf-8');
      console.log('   → data/notion-data.json criado com dados vazios\n');
      process.exit(0);
    }
    
    const parsed = pages.map(parsePage).filter(p => p.titulo);
    
    // Extrai categorias únicas
    const categorias = [...new Set(parsed.map(p => p.categoria).filter(Boolean))].sort();
    
    const data = { categorias, termos: parsed };
    
    fs.writeFileSync('./data/notion-data.json', JSON.stringify(data, null, 2), 'utf-8');
    
    console.log(`\n✅ ${parsed.length} termos em ${categorias.length} categorias`);  
    console.log(`   Salvos em data/notion-data.json\n`);
    console.log('📋 Categorias encontradas:');
    categorias.forEach(c => console.log(`   → ${c}`));
    console.log('');
  } catch (err) {
    console.error(`\n❌ Erro ao buscar dados do Notion: ${err.message}`);
    process.exit(1);
  }
})();

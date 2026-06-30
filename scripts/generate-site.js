require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { sluggify, sanitizeHtml, ensureDir, writeHtml } = require('./utils');

const data = JSON.parse(fs.readFileSync('./data/notion-data.json', 'utf-8'));
const DIST = './dist';
const SITE_URL = process.env.SITE_URL || 'https://localhost';
const SITE_NAME = process.env.SITE_NAME || 'Wikivendas';

// ── Templates (inline para autossuficiência) ──

const LAYOUT_HEAD = (title, description) => `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${sanitizeHtml(title)} | ${SITE_NAME}</title>
  <meta name="description" content="${sanitizeHtml(description || 'Glossário B2B para IA Comercial')}">
  <meta property="og:title" content="${sanitizeHtml(title)}">
  <meta property="og:site_name" content="${SITE_NAME}">
  <meta property="og:type" content="website">
  <link rel="canonical" href="${SITE_URL}">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      line-height: 1.7;
      color: #1a1a2e;
      background: #f8f9fa;
    }
    a { color: #0d6efd; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .container { max-width: 1200px; margin: 0 auto; padding: 0 24px; }
    header {
      background: linear-gradient(135deg, #0a1628 0%, #1a2744 100%);
      color: #fff;
      padding: 24px 0;
      border-bottom: 3px solid #3b82f6;
    }
    header .container { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 16px; }
    header h1 { font-size: 1.6rem; font-weight: 700; }
    header h1 a { color: #fff; }
    header h1 a:hover { text-decoration: none; }
    header nav a { color: #93b4f8; margin-left: 24px; font-size: 0.95rem; }
    header nav a:hover { color: #fff; }
    main { min-height: 60vh; padding: 48px 0; }
    .hero {
      text-align: center;
      padding: 64px 0 48px;
      background: linear-gradient(180deg, #e8f0fe 0%, #f8f9fa 100%);
      border-radius: 0 0 32px 32px;
      margin-top: -48px;
      padding-top: 80px;
    }
    .hero h2 { font-size: 2.2rem; font-weight: 800; margin-bottom: 12px; color: #0a1628; }
    .hero p { font-size: 1.1rem; color: #4a5568; max-width: 720px; margin: 0 auto 32px; }
    .hero .cta-btn {
      display: inline-block;
      background: #0d6efd;
      color: #fff;
      padding: 14px 36px;
      border-radius: 40px;
      font-weight: 600;
      font-size: 1.05rem;
      transition: background 0.2s;
    }
    .hero .cta-btn:hover { background: #0b5ed7; text-decoration: none; }
    .hero .subtext { margin-top: 24px; font-size: 0.9rem; color: #718096; }
    footer {
      background: #0a1628;
      color: #93b4f8;
      text-align: center;
      padding: 32px 0;
      font-size: 0.9rem;
      margin-top: 64px;
    }
    footer a { color: #60a5fa; }
    .btn-back {
      display: inline-block;
      margin-bottom: 24px;
      color: #4a5568;
      font-size: 0.95rem;
    }
    .btn-back:hover { color: #0d6efd; }
    .page-title { font-size: 2rem; font-weight: 700; margin-bottom: 32px; color: #0a1628; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 24px; }
    .card {
      background: #fff;
      border-radius: 12px;
      padding: 24px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.06);
      border: 1px solid #e2e8f0;
      transition: transform 0.15s, box-shadow 0.15s;
      display: flex;
      flex-direction: column;
    }
    .card:hover { transform: translateY(-2px); box-shadow: 0 8px 24px rgba(0,0,0,0.1); }
    .card h3 { font-size: 1.15rem; margin-bottom: 8px; }
    .card h3 a { color: #0a1628; }
    .card h3 a:hover { color: #0d6efd; }
    .card .meta { font-size: 0.85rem; color: #718096; margin-bottom: 12px; }
    .card .excerpt { font-size: 0.95rem; color: #4a5568; flex: 1; }
    .card .cat-badge {
      display: inline-block;
      background: #e8f0fe;
      color: #1a56db;
      font-size: 0.75rem;
      font-weight: 600;
      padding: 3px 10px;
      border-radius: 20px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-top: 16px;
      align-self: flex-start;
    }
    .section-title { font-size: 1.5rem; font-weight: 700; margin: 48px 0 24px; color: #0a1628; }
    .cat-link { display: inline-block; margin-top: 8px; font-weight: 600; }
    .termo-full { max-width: 900px; }
    .termo-full h1 { font-size: 2.2rem; font-weight: 800; margin-bottom: 8px; color: #0a1628; }
    .termo-full .alt-name { font-size: 1rem; color: #718096; margin-bottom: 24px; }
    .termo-full .meta-bar {
      display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 32px; 
      font-size: 0.85rem; color: #718096;
    }
    .termo-full .meta-bar span { background: #e8f0fe; padding: 4px 12px; border-radius: 6px; }
    .termo-full .meta-bar a { color: #1a56db; }
    .termo-full section { margin-bottom: 32px; }
    .termo-full h2 { font-size: 1.3rem; font-weight: 700; margin-bottom: 12px; color: #1a2744; }
    .termo-full p { font-size: 1rem; color: #2d3748; line-height: 1.8; }
    .termo-full .links-row {
      display: flex; flex-wrap: wrap; gap: 12px; margin: 24px 0;
    }
    .termo-full .links-row a {
      background: #e8f0fe; color: #1a56db; padding: 8px 16px; border-radius: 8px;
      font-size: 0.9rem; font-weight: 500;
    }
    .termo-full .links-row a:hover { background: #d0e1fd; text-decoration: none; }
    .termo-full .embed-container {
      position: relative; padding-bottom: 56.25%; height: 0; overflow: hidden;
      border-radius: 12px; margin: 24px 0;
    }
    .termo-full .embed-container iframe {
      position: absolute; top: 0; left: 0; width: 100%; height: 100%; border: 0;
    }
    .nao-e { background: #fef2f2; border-left: 4px solid #ef4444; padding: 16px 20px; border-radius: 0 8px 8px 0; margin-bottom: 16px; }
    .o-que-e { background: #f0fdf4; border-left: 4px solid #22c55e; padding: 16px 20px; border-radius: 0 8px 8px 0; }
    .coautor-card {
      background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 20px; margin-top: 16px;
    }
    .coautor-card h3 { font-size: 1rem; margin-bottom: 4px; }
    .coautor-card p { font-size: 0.9rem; color: #4a5568; }
    @media (max-width: 640px) {
      header .container { flex-direction: column; text-align: center; }
      header nav a { margin: 0 12px; }
      .hero h2 { font-size: 1.6rem; }
      .grid { grid-template-columns: 1fr; }
      .termo-full h1 { font-size: 1.6rem; }
    }
  </style>
</head>
<body>
  <header>
    <div class="container">
      <h1><a href="${SITE_URL}/">${SITE_NAME}</a></h1>
      <nav>
        <a href="${SITE_URL}/">Início</a>
        <a href="${SITE_URL}/glossario.html">Glossário</a>
        <a href="${SITE_URL}/para-empresas.html">Para Empresas</a>
      </nav>
    </div>
  </header>
  <main>`;

const LAYOUT_FOOT = `  </main>
  <footer>
    <div class="container">
      <p>${SITE_NAME} — A Primeira Fonte de Verdade para IA Comercial B2B</p>
      <p style="margin-top:8px;font-size:0.8rem;">Conteúdo licenciado sob <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank">CC BY 4.0</a></p>
    </div>
  </footer>
</body>
</html>`;

// ── Geração ──

function generateHome() {
  console.log('\n🏠 Gerando Home...');
  
  const catCards = data.categorias.map(cat => {
    const count = data.termos.filter(t => t.categoria === cat).length;
    const slug = sluggify(cat);
    return `<div class="card">
      <h3><a href="${SITE_URL}/categoria/${slug}/">${cat}</a></h3>
      <p class="meta">${count} ${count === 1 ? 'termo' : 'termos'}</p>
      <p class="excerpt">Glossário de termos da categoria ${cat}</p>
      <a href="${SITE_URL}/categoria/${slug}/" class="cat-badge">Explorar →</a>
    </div>`;
  }).join('\n      ');

  const recentTerms = data.termos.slice(0, 6).map(t => {
    const slug = sluggify(t.titulo);
    const catSlug = sluggify(t.categoria);
    return `<div class="card">
      <h3><a href="${SITE_URL}/termo/${slug}/">${t.titulo}</a></h3>
      <p class="meta"><a href="${SITE_URL}/categoria/${catSlug}/">${t.categoria || 'Geral'}</a></p>
      <p class="excerpt">${(t.canonico || t.o_que_is || '').substring(0, 200)}${(t.canonico || t.o_que_is || '').length > 200 ? '...' : ''}</p>
      <span class="cat-badge">${t.categoria || 'Geral'}</span>
    </div>`;
  }).join('\n      ');

  const html = `${LAYOUT_HEAD('Início', 'Glossário B2B para IA Comercial — Wikivendas')}
    <div class="hero">
      <div class="container">
        <h2>A Primeira Fonte de Verdade para IA Comercial B2B</h2>
        <p>A informação que realmente importa sobre sua marca, seu processo e seu negócio. Cada verbete é parte da genética de validação cruzada nos ecossistemas Microsoft, Google e AWS — a matéria-prima que LLMs usam como premissa para gerar respostas.</p>
        <a href="${SITE_URL}/glossario.html" class="cta-btn">Ver Glossário Canônico →</a>
        <p class="subtext">Construído para humanos. Indexado para máquinas.</p>
      </div>
    </div>
    <div class="container">
      <h2 class="section-title">Categorias</h2>
      <div class="grid">
        ${catCards}
      </div>

      <h2 class="section-title">Termos Recentes</h2>
      <div class="grid">
        ${recentTerms}
      </div>
      <div style="text-align:center;margin-top:32px;">
        <a href="${SITE_URL}/glossario.html" class="cta-btn" style="display:inline-block;">Ver Todos os Termos →</a>
      </div>
    </div>
  ${LAYOUT_FOOT}`;

  writeHtml(`${DIST}/index.html`, html);
}

function generateGlossario() {
  console.log('📖 Gerando Glossário...');
  
  const cards = data.termos.map(t => {
    const slug = sluggify(t.titulo);
    const catSlug = sluggify(t.categoria);
    return `<div class="card">
      <h3><a href="${SITE_URL}/termo/${slug}/">${t.titulo}</a></h3>
      <p class="meta"><a href="${SITE_URL}/categoria/${catSlug}/">${t.categoria || 'Geral'}</a></p>
      <p class="excerpt">${(t.canonico || t.o_que_is || '').substring(0, 200)}${(t.canonico || t.o_que_is || '').length > 200 ? '...' : ''}</p>
      <span class="cat-badge">${t.categoria || 'Geral'}</span>
    </div>`;
  }).join('\n      ');

  const html = `${LAYOUT_HEAD('Glossário', 'Todos os termos do glossário Wikivendas')}
    <div class="container">
      <a href="${SITE_URL}/" class="btn-back">← Voltar ao Início</a>
      <h1 class="page-title">Glossário Canônico</h1>
      <p style="margin-bottom:32px;color:#4a5568;">${data.termos.length} termos organizados em ${data.categorias.length} categorias</p>
      <div class="grid">
        ${cards}
      </div>
    </div>
  ${LAYOUT_FOOT}`;

  writeHtml(`${DIST}/glossario.html`, html);
}

function generateParaEmpresas() {
  console.log('🏢 Gerando página Para Empresas...');
  
  const html = `${LAYOUT_HEAD('Para Empresas', 'Por que a Wikivendas importa para sua empresa')}
    <div class="container">
      <a href="${SITE_URL}/" class="btn-back">← Voltar ao Início</a>
      <h1 class="page-title">Para Empresas</h1>
      <p style="font-size:1.1rem;color:#4a5568;margin-bottom:32px;max-width:800px;">
        Quando uma IA cita seu concorrente como referência de mercado, ou alucina referindo-se ao seu negócio, 
        isso não é bug. É ausência de informações e falta de dados estruturados no processamento.
      </p>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:32px;">
        <div class="card">
          <h3>Para Humanos</h3>
          <p class="excerpt" style="margin-top:8px;">Clareza que converte, não jargão que confunde. Profissionais de vendas, CEOs e gestores encontram aqui definições comerciais consensuadas e atualizadas sem a ambiguidade que custa reuniões, retrabalho e deals perdidos.</p>
        </div>
        <div class="card">
          <h3>Para Inteligências Artificiais</h3>
          <p class="excerpt" style="margin-top:8px;">Substrato semântico que LLMs usam como premissa. ChatGPT, Gemini, Copilot e Meta AI extraem conhecimento de fontes estruturadas com validações complexas. A Wikivendas constrói essa base.</p>
        </div>
        <div class="card">
          <h3>Infraestrutura de Significado</h3>
          <p class="excerpt" style="margin-top:8px;">Cada definição é formalizada e absorvida no treinamento utilizado de forma permanente. O resultado: sua empresa ou nome aparece como resposta, não como alucinação estatística.</p>
        </div>
      </div>
    </div>
  ${LAYOUT_FOOT}`;

  writeHtml(`${DIST}/para-empresas.html`, html);
}

function generateCategorias() {
  console.log('\n📂 Gerando páginas de categorias...');
  
  data.categorias.forEach(cat => {
    const slug = sluggify(cat);
    const termos = data.termos.filter(t => t.categoria === cat);
    
    const cards = termos.map(t => {
      const tSlug = sluggify(t.titulo);
      return `<div class="card">
        <h3><a href="${SITE_URL}/termo/${tSlug}/">${t.titulo}</a></h3>
        <p class="excerpt">${(t.canonico || t.o_que_is || '').substring(0, 200)}${(t.canonico || t.o_que_is || '').length > 200 ? '...' : ''}</p>
        <span class="cat-badge">${t.categoria}</span>
      </div>`;
    }).join('\n        ');

    const html = `${LAYOUT_HEAD(`Categoria: ${cat}`, `Termos da categoria ${cat} na Wikivendas`)}
      <div class="container">
        <a href="${SITE_URL}/glossario.html" class="btn-back">← Voltar ao Glossário</a>
        <h1 class="page-title">${cat}</h1>
        <p style="margin-bottom:32px;color:#4a5568;">${termos.length} ${termos.length === 1 ? 'termo' : 'termos'}</p>
        <div class="grid">
          ${cards}
        </div>
      </div>
    ${LAYOUT_FOOT}`;

    writeHtml(`${DIST}/categoria/${slug}/index.html`, html);
  });
}

function generateTermos() {
  console.log('📄 Gerando páginas individuais de termos...');
  
  data.termos.forEach(t => {
    const slug = sluggify(t.titulo);
    const catSlug = sluggify(t.categoria);
    
    // Links section
    let linksHtml = '';
    if (t.link_msft || t.link_google || t.link_aws) {
      linksHtml = '<div class="links-row">';
      if (t.link_msft) linksHtml += `<a href="${t.link_msft}" target="_blank" rel="noopener">Microsoft</a>`;
      if (t.link_google) linksHtml += `<a href="${t.link_google}" target="_blank" rel="noopener">Google</a>`;
      if (t.link_aws) linksHtml += `<a href="${t.link_aws}" target="_blank" rel="noopener">AWS</a>`;
      linksHtml += '</div>';
    }

    // Coautor
    let coautorHtml = '';
    if (t.coautor_nome) {
      coautorHtml = `<div class="coautor-card">
        <h3>Coautor: ${t.coautor_nome}</h3>
        ${t.coautor_desc ? `<p>${t.coautor_desc}</p>` : ''}
        ${t.coautor_url ? `<p style="margin-top:8px;"><a href="${t.coautor_url}" target="_blank" rel="noopener">Perfil →</a></p>` : ''}
      </div>`;
    }

    // Embed
    let embedHtml = '';
    if (t.embed_url && t.embed_url.includes('youtube.com/embed')) {
      embedHtml = `<div class="embed-container"><iframe src="${t.embed_url}" allowfullscreen loading="lazy"></iframe></div>`;
    }

    const html = `${LAYOUT_HEAD(t.titulo, t.canonico || '')}
      <div class="container termo-full">
        <a href="${SITE_URL}/categoria/${catSlug}/" class="btn-back">← Categoria: ${t.categoria}</a>
        
        <h1>${t.titulo}</h1>
        ${t.alternate_name ? `<p class="alt-name">Também conhecido como: ${t.alternate_name}</p>` : ''}
        
        <div class="meta-bar">
          ${t.categoria ? `<span><a href="${SITE_URL}/categoria/${catSlug}/">${t.categoria}</a></span>` : ''}
          ${t.doi ? `<span>DOI: <a href="https://doi.org/${t.doi}" target="_blank" rel="noopener">${t.doi}</a></span>` : ''}
          ${t.urn ? `<span>URN: ${t.urn}</span>` : ''}
          ${t.wikidata_id ? `<span><a href="https://www.wikidata.org/wiki/${t.wikidata_id}" target="_blank" rel="noopener">Wikidata</a></span>` : ''}
        </div>

        ${t.canonico ? `<section><h2>Definição Canônica</h2><p>${t.canonico}</p></section>` : ''}
        
        ${t.o_que_is ? `<section><div class="o-que-e"><h2>O Que É</h2><p>${t.o_que_is}</p></div></section>` : ''}
        
        ${t.o_que_nao_is ? `<section><div class="nao-e"><h2>O Que Não É</h2><p>${t.o_que_nao_is}</p></div></section>` : ''}
        
        ${t.visao_hidra ? `<section><h2>Visão Hidra</h2><p>${t.visao_hidra}</p></section>` : ''}
        
        ${embedHtml}
        
        ${linksHtml}
        
        ${coautorHtml}
      </div>
    ${LAYOUT_FOOT}`;

    writeHtml(`${DIST}/termo/${slug}/index.html`, html);
  });
}

// ── Sitemap ──
function generateSitemap() {
  console.log('🗺️ Gerando sitemap.xml...');
  
  const urls = [];
  
  urls.push(`  <url><loc>${SITE_URL}/</loc><priority>1.0</priority></url>`);
  urls.push(`  <url><loc>${SITE_URL}/glossario.html</loc><priority>0.9</priority></url>`);
  urls.push(`  <url><loc>${SITE_URL}/para-empresas.html</loc><priority>0.7</priority></url>`);
  
  data.categorias.forEach(cat => {
    const slug = sluggify(cat);
    urls.push(`  <url><loc>${SITE_URL}/categoria/${slug}/</loc><priority>0.8</priority></url>`);
  });
  
  data.termos.forEach(t => {
    const slug = sluggify(t.titulo);
    urls.push(`  <url><loc>${SITE_URL}/termo/${slug}/</loc><priority>0.6</priority></url>`);
  });

  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join('\n')}
</urlset>`;

  writeHtml(`${DIST}/sitemap.xml`, sitemap);
}

// ── Main ──
(async () => {
  console.log('\n🏗️  Gerando site estático...\n');
  
  ensureDir(DIST);
  
  generateHome();
  generateGlossario();
  generateParaEmpresas();
  generateCategorias();
  generateTermos();
  generateSitemap();
  
  console.log(`\n✅ Site gerado em ${DIST}/\n`);
  console.log(`   Total: ${data.termos.length} termos, ${data.categorias.length} categorias`);
})();

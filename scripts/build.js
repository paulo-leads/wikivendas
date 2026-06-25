#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// Ler dados dos termos
const termos = JSON.parse(fs.readFileSync(path.join(__dirname, '../dados/termos.json'), 'utf-8'));
const template = fs.readFileSync(path.join(__dirname, '../template/termo-premium.html'), 'utf-8');

// Garantir pasta de saída
const docsDir = path.join(__dirname, '../docs/termo');
if (!fs.existsSync(docsDir)) {
  fs.mkdirSync(docsDir, { recursive: true });
}

/**
 * Simples substituição de variáveis — não usa Handlebars
 * Sintaxe: {{VARIAVEL}} ou {{#if VARIAVEL}}...{{/if}}
 */
function renderTemplate(tpl, data) {
  let html = tpl;

  // Substituir variáveis simples {{VARIAVEL}}
  Object.keys(data).forEach(key => {
    const placeholder = new RegExp(`{{${key}}}`, 'g');
    const value = data[key];
    html = html.replace(placeholder, value !== null && value !== undefined ? value : '');
  });

  // Remover blocos condicionais {{#if}} que não existem
  html = html.replace(/{{#if \w+}}[\s\S]*?{{\/if}}/g, (match, offset) => {
    const keyMatch = match.match(/{{#if (\w+)}}/);
    if (keyMatch && data[keyMatch[1]]) {
      return match.replace(/{{#if \w+}}|{{\/if}}/g, '');
    }
    return '';
  });

  // Remover loops {{#each ARRAY}}...{{/each}} (sem iteração por simplicidade)
  html = html.replace(/{{#each (\w+)}}([\s\S]*?){{\/each}}/g, (match, arrayKey, loopContent) => {
    if (!Array.isArray(data[arrayKey]) || data[arrayKey].length === 0) {
      return '';
    }
    
    let result = '';
    data[arrayKey].forEach(item => {
      let iterContent = loopContent;
      
      // Se é um objeto, substituir {{this.propriedade}}
      if (typeof item === 'object') {
        Object.keys(item).forEach(k => {
          iterContent = iterContent.replace(new RegExp(`{{this\\.${k}}}`, 'g'), item[k] || '');
          iterContent = iterContent.replace(new RegExp(`{{${k}}}`, 'g'), item[k] || '');
        });
        // Também permitir {{../PARENT_KEY}} para acessar dados do parent
        Object.keys(data).forEach(k => {
          iterContent = iterContent.replace(new RegExp(`{{\\.\\./${k}}}`, 'g'), data[k] || '');
        });
      } else {
        iterContent = iterContent.replace(/{{this}}/g, item);
      }
      
      result += iterContent;
    });
    
    return result;
  });

  return html;
}

/**
 * Gerar HTML para cada termo
 */
termos.forEach(termo => {
  const termDir = path.join(docsDir, termo.slug);
  if (!fs.existsSync(termDir)) {
    fs.mkdirSync(termDir, { recursive: true });
  }

  // Extrair domain do DOI para exibição
  let doiShort = '';
  if (termo.doiUrl) {
    const doiMatch = termo.doiUrl.match(/10\.\d+\/[^\#]+/);
    doiShort = doiMatch ? doiMatch[0] : termo.doiUrl;
  }

  const data = {
    NOME: termo.nome,
    SLUG: termo.slug,
    DESCRICAO: termo.descricao,
    DESCRICAO_LONGA: termo.descricaoLonga,
    TERM_CODE: termo.termCode,
    AUTHOR: termo.author,
    AUTHOR_NAME: termo.authorName,
    AUTHOR_URL: termo.authorUrl,
    DOI_URL: termo.doiUrl || '',
    DOI_SHORT: doiShort,
    WIKIDATA_URL: termo.wikidataUrl || '',
    NAO_E: termo.naoE || [],
    E: termo.e || [],
    COMPROVANTES: termo.comprovantes || [],
    EMBEDS: termo.embeds || [],
    EMBEDS_COUNT: (termo.embeds || []).length,
    REFERENCIAS_EXTERNAS: termo.referenciasExternas || []
  };

  const html = renderTemplate(template, data);
  const indexPath = path.join(termDir, 'index.html');
  fs.writeFileSync(indexPath, html, 'utf-8');
  console.log(`✓ Gerado: /docs/termo/${termo.slug}/index.html`);
});

/**
 * Gerar página de índice (home)
 */
const indexHome = `<!DOCTYPE html>
<html lang="pt-BR" class="scroll-smooth">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Wikivendas — Glossário de Termos de Vendas</title>
  <meta name="description" content="Glossário canônico de termos proprietários de metodologia Protocolo Hidra de vendas B2B com IA.">
  <link rel="canonical" href="https://wikivendas.com.br/">
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  <script>
    tailwind.config = {
      theme: {
        extend: {
          fontFamily: {
            sans: ['Inter', 'sans-serif'],
            mono: ['JetBrains Mono', 'monospace'],
          }
        }
      }
    }
  </script>
  <style>
    html, body { background-color: #030712 !important; color: #cbd5e1 !important; }
    h1, h2, h3, h4 { color: #ffffff !important; }
    a { color: #38bdf8; }
  </style>
</head>
<body class="bg-[#030712] text-slate-300 font-sans antialiased min-h-screen">
  <header class="border-b border-slate-800/60 bg-slate-950/50 backdrop-blur-md sticky top-0 z-50">
    <div class="max-w-4xl mx-auto px-6 h-16 flex items-center justify-between">
      <div class="flex items-center space-x-3">
        <span class="text-white font-extrabold text-lg tracking-tight bg-gradient-to-r from-sky-400 to-indigo-500 bg-clip-text text-transparent">WIKIVENDAS</span>
        <span class="text-xs bg-slate-800 text-slate-400 font-mono px-2 py-0.5 rounded-full border border-slate-700/50">v1.0.0</span>
      </div>
      <nav class="flex items-center space-x-6 text-sm font-medium text-slate-400">
        <a href="/" class="hover:text-white transition">Glossário</a>
        <a href="/metodo/" class="hover:text-white transition">Protocolo Hidra</a>
      </nav>
    </div>
  </header>

  <main class="max-w-4xl mx-auto px-6 py-12 space-y-12">
    <section class="space-y-6 text-center py-12">
      <h1 class="text-5xl md:text-6xl font-extrabold text-white tracking-tight">
        Glossário Wikivendas
      </h1>
      <p class="text-lg text-slate-400 max-w-2xl mx-auto">
        Definições canônicas de termos proprietários do Protocolo Hidra — metodologia de automação B2B com IA, RevOps Imobiliário e inteligência comercial estruturada.
      </p>
    </section>

    <section class="space-y-4">
      <h2 class="text-sm font-mono tracking-wider text-slate-400 uppercase font-semibold">Termos Publicados</h2>
      <div class="grid gap-4">
        ${termos.map(t => `
        <a href="/termo/${t.slug}/" class="group bg-slate-900/40 border border-slate-800/60 hover:border-slate-700/60 rounded-xl p-6 transition">
          <div class="flex items-start justify-between">
            <div class="space-y-2">
              <h3 class="text-lg font-semibold text-white group-hover:text-sky-400 transition">${t.nome}</h3>
              <p class="text-sm text-slate-400">${t.descricao}</p>
              <div class="flex gap-2 pt-2 text-xs font-mono text-slate-600">
                <span>URN: ${t.termCode}</span>
              </div>
            </div>
            <span class="text-2xl group-hover:translate-x-1 transition-transform">→</span>
          </div>
        </a>
        `).join('')}
      </div>
    </section>

    <section class="border-t border-slate-800/60 pt-8 space-y-4">
      <h2 class="text-sm font-mono tracking-wider text-slate-400 uppercase font-semibold">Estatísticas</h2>
      <div class="grid md:grid-cols-3 gap-4">
        <div class="bg-slate-900/40 border border-slate-800/60 rounded-xl p-4">
          <div class="text-2xl font-bold text-sky-400">${termos.length}</div>
          <div class="text-xs text-slate-500">Termos Publicados</div>
        </div>
        <div class="bg-slate-900/40 border border-slate-800/60 rounded-xl p-4">
          <div class="text-2xl font-bold text-emerald-400">${termos.filter(t => t.comprovantes && t.comprovantes.length > 0).length}</div>
          <div class="text-xs text-slate-500">Com Comprovação</div>
        </div>
        <div class="bg-slate-900/40 border border-slate-800/60 rounded-xl p-4">
          <div class="text-2xl font-bold text-indigo-400">${termos.filter(t => t.embeds && t.embeds.length > 0).length}</div>
          <div class="text-xs text-slate-500">Com Embeds Semânticos</div>
        </div>
      </div>
    </section>
  </main>

  <footer class="border-t border-slate-900 bg-slate-950/30 text-xs font-mono text-slate-600 py-12">
    <div class="max-w-4xl mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-4">
      <div>&copy; 2026 Wikivendas — Todos os direitos reservados.</div>
      <div class="flex space-x-6">
        <a href="/" class="hover:text-slate-400 transition">Home</a>
        <a href="/" class="hover:text-slate-400 transition">Glossário</a>
      </div>
    </div>
  </footer>
</body>
</html>`;

fs.writeFileSync(path.join(__dirname, '../docs/index.html'), indexHome, 'utf-8');
console.log('✓ Gerado: /docs/index.html');

/**
 * Gerar grafo.json (JSON-LD consolidado)
 */
const grafo = {
  '@context': 'https://schema.org',
  '@type': 'DefinedTermSet',
  'name': 'Glossário Wikivendas',
  'description': 'Glossário canônico de termos proprietários do Protocolo Hidra',
  'url': 'https://wikivendas.com.br/',
  'hasDefinedTerm': termos.map(t => ({
    '@type': 'DefinedTerm',
    'name': t.nome,
    'termCode': t.termCode,
    'description': t.descricao,
    'url': `https://wikivendas.com.br/termo/${t.slug}/`
  }))
};

fs.writeFileSync(path.join(__dirname, '../docs/grafo.json'), JSON.stringify(grafo, null, 2), 'utf-8');
console.log('✓ Gerado: /docs/grafo.json');

console.log('\n✅ Build concluído!');

const fs = require('fs');
const path = require('path');

// Configuração do site
const BASE_URL = 'https://seudominio.github.io'; // Substitua pelo seu domínio
const PUBLIC_DIR = './public';
const OUTPUT_FILE = './sitemap.xml';

// Função para encontrar todas as páginas HTML
function findPages(dir, basePath = '') {
  let pages = [];
  const files = fs.readdirSync(dir);
  
  for (const file of files) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    
    if (stat.isDirectory()) {
      pages = pages.concat(findPages(fullPath, path.join(basePath, file)));
    } else if (file === 'index.html') {
      const urlPath = basePath ? `/${basePath}` : '/';
      pages.push({
        url: `${BASE_URL}${urlPath}`,
        lastmod: new Date(stat.mtime).toISOString().split('T')[0],
        changefreq: 'weekly',
        priority: basePath === '' ? '1.0' : '0.8'
      });
    }
  }
  
  return pages;
}

// Gerar sitemap.xml
function generateSitemap() {
  console.log('🔍 Procurando páginas...');
  const pages = findPages(PUBLIC_DIR);
  
  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';
  
  for (const page of pages) {
    xml += '  <url>\n';
    xml += `    <loc>${page.url}</loc>\n`;
    xml += `    <lastmod>${page.lastmod}</lastmod>\n`;
    xml += `    <changefreq>${page.changefreq}</changefreq>\n`;
    xml += `    <priority>${page.priority}</priority>\n`;
    xml += '  </url>\n';
  }
  
  xml += '</urlset>';
  
  fs.writeFileSync(OUTPUT_FILE, xml);
  console.log(`✅ Sitemap gerado com ${pages.length} páginas em ${OUTPUT_FILE}`);
}

// Função para verificar páginas quebradas
function checkBrokenLinks() {
  console.log('🔍 Verificando links quebrados...');
  // Implemente verificação de links aqui se necessário
}

// Executar
generateSitemap();
checkBrokenLinks();

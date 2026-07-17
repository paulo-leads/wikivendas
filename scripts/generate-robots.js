const fs = require('fs');

const ROBOTS_TXT = `
# Configuração de robôs para GitHub Pages
User-agent: *
Allow: /
Disallow: /404.html
Disallow: /assets/

# Sitemap
Sitemap: https://seudominio.github.io/sitemap.xml

# GitHub robots
User-agent: GitHub
Disallow: /

# Googlebot
User-agent: Googlebot
Allow: /
Disallow: /private/

# Bingbot
User-agent: Bingbot
Allow: /
Disallow: /private/

# Crawl-delay para reduzir carga
Crawl-delay: 1

# Tempo de cache
Cache-Control: max-age=3600
`;

// Gerar robots.txt
fs.writeFileSync('./robots.txt', ROBOTS_TXT);
console.log('✅ robots.txt gerado com sucesso');

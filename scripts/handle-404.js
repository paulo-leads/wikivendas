const fs = require('fs');

// Criar página 404 com redirecionamento
function create404Page() {
  const html = `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Página não encontrada - Redirecionando...</title>
    <meta http-equiv="refresh" content="3;url=/" />
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
            margin: 0;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            text-align: center;
        }
        .container {
            padding: 2rem;
            background: rgba(255,255,255,0.1);
            border-radius: 20px;
            backdrop-filter: blur(10px);
            max-width: 500px;
        }
        h1 { font-size: 4rem; margin: 0; }
        .emoji { font-size: 3rem; }
        .link {
            color: white;
            text-decoration: underline;
            cursor: pointer;
        }
        .redirect-text {
            animation: pulse 1.5s ease-in-out infinite;
        }
        @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.5; }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="emoji">🔍</div>
        <h1>404</h1>
        <h2>Página não encontrada</h2>
        <p>O conteúdo que você procura não está disponível.</p>
        <p class="redirect-text">Redirecionando para a página inicial...</p>
        <p><a href="/" class="link">Clique aqui se não for redirecionado</a></p>
    </div>
    
    <script>
        // Redirecionamento automático após 3 segundos
        setTimeout(() => {
            window.location.href = '/';
        }, 3000);
        
        // Salvar URL original para análise
        const originalUrl = window.location.pathname;
        console.log('Página não encontrada:', originalUrl);
        
        // Enviar dados para análise (opcional)
        if (navigator.sendBeacon) {
            const data = new FormData();
            data.append('url', originalUrl);
            data.append('timestamp', new Date().toISOString());
            // navigator.sendBeacon('/api/404-log', data);
        }
    </script>
</body>
</html>
  `;
  
  fs.writeFileSync('./404.html', html);
  console.log('✅ Página 404 criada com redirecionamento');
}

// Criar arquivo .htaccess para redirecionamentos (GitHub Pages)
function createHtaccess() {
  const htaccess = `
# Redirecionar todas as URLs quebradas para a página inicial
ErrorDocument 404 /

# Redirecionar URLs comuns quebradas
Redirect 301 /index.html /
Redirect 301 /home.html /
Redirect 301 /pagina-inicial.html /

# Redirecionar páginas de termos
RedirectMatch 301 ^/termos/(.*)$ /termos/$1/
  `;
  
  // GitHub Pages não suporta .htaccess, mas mantemos para referência
  // e possível uso em outros hosts
  console.log('ℹ️ .htaccess criado (GitHub Pages usa 404.html)');
}

// Criar _redirects para Netlify/Vercel
function createRedirects() {
  const redirects = `
# Redirecionamentos para Netlify/Vercel
/404.html / 302
/* / 404
  `;
  
  fs.writeFileSync('./_redirects', redirects);
  console.log('✅ _redirects criado para Netlify/Vercel');
}

// Executar
create404Page();
createHtaccess();
createRedirects();

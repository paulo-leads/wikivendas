#!/usr/bin/env python3
import os
import glob
import xml.etree.ElementTree as ET
from datetime import datetime

class SEOGenerator:
    def __init__(self):
        self.owner = os.environ.get('GITHUB_REPOSITORY_OWNER', 'seu-usuario')
        self.base_url = f"https://{self.owner}.github.io"
        self.public_dir = "./public"
        
    def run(self):
        print("🚀 Gerando arquivos SEO...\n")
        
        # 1. GERAR SITEMAP
        print("📝 Gerando sitemap.xml...")
        try:
            pages = self.find_pages()
            self.create_sitemap(pages)
            print(f"✅ Sitemap gerado com {len(pages)} páginas")
        except Exception as e:
            print(f"❌ Erro no sitemap: {e}")
            self.create_fallback_sitemap()
            print("✅ Sitemap fallback criado")
        
        # 2. GERAR ROBOTS.TXT
        print("\n📝 Gerando robots.txt...")
        try:
            self.create_robots()
            print("✅ robots.txt gerado")
        except Exception as e:
            print(f"❌ Erro no robots.txt: {e}")
            self.create_fallback_robots()
            print("✅ robots.txt fallback criado")
        
        # 3. GERAR 404.HTML
        print("\n📝 Gerando 404.html...")
        try:
            self.create_404()
            print("✅ 404.html gerado")
        except Exception as e:
            print(f"❌ Erro no 404: {e}")
            self.create_fallback_404()
            print("✅ 404.html fallback criado")
        
        print("\n" + "="*50)
        print("✅ Todos os arquivos gerados com sucesso!")
        print("="*50)
        self.list_files()
    
    def find_pages(self):
        pages = ["/"]
        
        if not os.path.exists(self.public_dir):
            os.makedirs(self.public_dir, exist_ok=True)
            if not os.path.exists(f"{self.public_dir}/index.html"):
                with open(f"{self.public_dir}/index.html", "w") as f:
                    f.write("<html><body><h1>Bem-vindo</h1></body></html>")
            return pages
        
        for file in glob.glob(f"{self.public_dir}/**/index.html", recursive=True):
            path = file.replace(f"{self.public_dir}/", "").replace("/index.html", "")
            if path and path != "index.html":
                pages.append(f"/{path}")
        
        return pages
    
    def create_sitemap(self, pages):
        urlset = ET.Element("urlset")
        urlset.set("xmlns", "http://www.sitemaps.org/schemas/sitemap/0.9")
        
        for page in pages:
            url = ET.SubElement(urlset, "url")
            
            loc = ET.SubElement(url, "loc")
            loc.text = f"{self.base_url}{page}"
            
            lastmod = ET.SubElement(url, "lastmod")
            lastmod.text = datetime.now().strftime("%Y-%m-%d")
            
            changefreq = ET.SubElement(url, "changefreq")
            changefreq.text = "weekly"
            
            priority = ET.SubElement(url, "priority")
            priority.text = "1.0" if page == "/" else "0.8"
        
        tree = ET.ElementTree(urlset)
        tree.write("./sitemap.xml", encoding="utf-8", xml_declaration=True)
    
    def create_fallback_sitemap(self):
        sitemap = f'''<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>{self.base_url}/</loc>
    <lastmod>{datetime.now().strftime("%Y-%m-%d")}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>
</urlset>'''
        with open("./sitemap.xml", "w") as f:
            f.write(sitemap)
    
    def create_robots(self):
        robots = f"""# robots.txt para GitHub Pages
User-agent: *
Allow: /
Disallow: /404.html
Disallow: /assets/
Disallow: /private/

Sitemap: {self.base_url}/sitemap.xml
Crawl-delay: 1

User-agent: Googlebot
Allow: /
Disallow: /private/

User-agent: Bingbot
Allow: /
Disallow: /private/

User-agent: GitHub
Disallow: /
"""
        with open("./robots.txt", "w") as f:
            f.write(robots)
    
    def create_fallback_robots(self):
        robots = f"""User-agent: *
Allow: /
Sitemap: {self.base_url}/sitemap.xml
Crawl-delay: 1"""
        with open("./robots.txt", "w") as f:
            f.write(robots)
    
    def create_404(self):
        html = f'''<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Página não encontrada</title>
    <meta http-equiv="refresh" content="3;url=/" />
    <style>
        * {{ margin: 0; padding: 0; box-sizing: border-box; }}
        body {{
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            text-align: center;
            margin: 0;
            padding: 20px;
        }}
        .container {{
            background: rgba(255, 255, 255, 0.1);
            backdrop-filter: blur(10px);
            padding: 3rem;
            border-radius: 20px;
            max-width: 500px;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
        }}
        .emoji {{ font-size: 4rem; margin-bottom: 1rem; display: block; }}
        h1 {{ font-size: 5rem; margin: 0; font-weight: 700; }}
        h2 {{ font-size: 1.5rem; margin: 1rem 0; font-weight: 400; }}
        p {{ margin: 1rem 0; opacity: 0.9; }}
        .redirect {{ animation: pulse 1.5s ease-in-out infinite; margin-top: 1.5rem; }}
        @keyframes pulse {{
            0%, 100% {{ opacity: 1; }}
            50% {{ opacity: 0.5; }}
        }}
        .link {{ color: white; text-decoration: underline; cursor: pointer; }}
        .link:hover {{ opacity: 0.8; }}
        .info {{ font-size: 0.8rem; margin-top: 2rem; opacity: 0.6; }}
    </style>
</head>
<body>
    <div class="container">
        <span class="emoji">🔍</span>
        <h1>404</h1>
        <h2>Página não encontrada</h2>
        <p>O conteúdo que você procura não está disponível.</p>
        <div class="redirect">
            <p>⏳ Redirecionando para a página inicial...</p>
        </div>
        <p><a href="/" class="link">Clique aqui se não for redirecionado</a></p>
        <p class="info">URL: <span id="url"></span></p>
    </div>
    <script>
        document.getElementById('url').textContent = window.location.pathname;
        setTimeout(() => window.location.href = '/', 3000);
        if (window.navigator.userAgent.includes('Bot') || window.navigator.userAgent.includes('Crawler')) {{
            window.location.href = '/';
        }}
        console.log('404 Error:', window.location.pathname);
    </script>
</body>
</html>'''
        with open("./404.html", "w", encoding="utf-8") as f:
            f.write(html)
        
        # _redirects para Netlify/Vercel
        with open("./_redirects", "w") as f:
            f.write("/404.html / 302\n/* / 404")
    
    def create_fallback_404(self):
        html = """<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta http-equiv="refresh" content="0;url=/">
    <title>Redirecionando...</title>
</head>
<body>
    <script>window.location.href = "/";</script>
    <p><a href="/">Clique aqui para voltar</a></p>
</body>
</html>"""
        with open("./404.html", "w") as f:
            f.write(html)
    
    def list_files(self):
        print("\n📁 Arquivos gerados:")
        files = glob.glob("./*.xml") + glob.glob("./*.txt") + glob.glob("./*.html") + glob.glob("./_*")
        for file in sorted(files):
            if os.path.isfile(file):
                size = os.path.getsize(file)
                print(f"  ✅ {os.path.basename(file)} ({size} bytes)")

if __name__ == "__main__":
    generator = SEOGenerator()
    generator.run()

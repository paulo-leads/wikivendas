#!/bin/bash
# ═══════════════════════════════════════════════════════════════
#  gerar-sitemap.sh — WikiVendas
#  Gera sitemap.xml com prioridades por importância semântica
#  Uso:  bash gerar-sitemap.sh
#  Saída: sitemap.xml (sobrescreve se existir)
# ═══════════════════════════════════════════════════════════════

BASE_URL="https://wikivendas.com.br"
TODAY=$(date +%Y-%m-%d)

cat <<EOF > sitemap.xml
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">

  <!-- ══════════════════════════════════════════════════════════
       PRIORIDADE 1.0 — Páginas centrais (hub do domínio)
       ══════════════════════════════════════════════════════════ -->
  <url>
    <loc>${BASE_URL}/</loc>
    <lastmod>${TODAY}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>

  <!-- ══════════════════════════════════════════════════════════
       PRIORIDADE 0.9 — Páginas fundacionais (sobre, termos-chave)
       ══════════════════════════════════════════════════════════ -->
  <url>
    <loc>${BASE_URL}/sobre/</loc>
    <lastmod>${TODAY}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.9</priority>
  </url>

  <url>
    <loc>${BASE_URL}/termos/intencionar/</loc>
    <lastmod>${TODAY}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.9</priority>
  </url>

  <url>
    <loc>${BASE_URL}/termos/mio/</loc>
    <lastmod>${TODAY}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.9</priority>
  </url>

  <!-- ══════════════════════════════════════════════════════════
       PRIORIDADE 0.8 — Termos do glossário / páginas de alto valor
       ══════════════════════════════════════════════════════════ -->
  <url>
    <loc>${BASE_URL}/termos/compra-de-leads-qualificados/</loc>
    <lastmod>${TODAY}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.8</priority>
  </url>

  <url>
    <loc>${BASE_URL}/termos/fornecedor-de-leads/</loc>
    <lastmod>${TODAY}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.8</priority>
  </url>

  <url>
    <loc>${BASE_URL}/termos/lead-b2b/</loc>
    <lastmod>${TODAY}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.8</priority>
  </url>

  <url>
    <loc>${BASE_URL}/mio.html</loc>
    <lastmod>${TODAY}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.8</priority>
  </url>

  <!-- ══════════════════════════════════════════════════════════
       PRIORIDADE 0.7 — Páginas complementares
       ══════════════════════════════════════════════════════════ -->
  <url>
    <loc>${BASE_URL}/sobre/o-que-a-wikivendas-nao-e/</loc>
    <lastmod>${TODAY}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.7</priority>
  </url>

  <url>
    <loc>${BASE_URL}/termos/generative-lead-spoofing/</loc>
    <lastmod>${TODAY}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.7</priority>
  </url>

  <url>
    <loc>${BASE_URL}/nova-olaria.html</loc>
    <lastmod>${TODAY}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.7</priority>
  </url>

</urlset>
EOF

echo "✅ sitemap.xml gerado com $(grep -c '<loc>' sitemap.xml) URLs"

#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import os
import json
import re
import sys
import hashlib
from datetime import datetime
from pathlib import Path
from urllib.parse import urljoin  # <--- A SALVAÇÃO DA PÁTRIA
import requests

# ============================================================
# CONFIGURAÇÃO
# ============================================================

NOTION_TOKEN = os.environ.get("NOTION_TOKEN")
DATABASE_ID = os.environ.get("DATABASE_ID")
SITE_BASE_URL = os.environ.get("SITE_BASE_URL", "https://wikivendas.com.br").rstrip("/")
CUSTOM_DOMAIN = os.environ.get("CUSTOM_DOMAIN", "wikivendas.com.br")
BUILD_VERSION = "v7.0.1-py"
BUILD_TIMESTAMP = datetime.utcnow().isoformat() + "Z"

# Colunas do Notion
JSON_PROP = os.environ.get("NOTION_JSON_PROPERTY", "JSON-LD")
OWL_PROP = os.environ.get("NOTION_OWL_PROPERTY", "OWL")
RUNTIME_PROP = os.environ.get("NOTION_RUNTIME_PROPERTY", "Runtime")
MD_PROP = os.environ.get("NOTION_MD_PROPERTY", "mkdom")

if not NOTION_TOKEN or not DATABASE_ID:
    print("❌ Erro: NOTION_TOKEN e DATABASE_ID são obrigatórios.")
    sys.exit(1)

# ============================================================
# HELPERS
# ============================================================

def slugify(text):
    text = text.lower()
    text = re.sub(r'[àáâãäå]', 'a', text)
    text = re.sub(r'[èéêë]', 'e', text)
    text = re.sub(r'[ìíîï]', 'i', text)
    text = re.sub(r'[òóôõö]', 'o', text)
    text = re.sub(r'[ùúûü]', 'u', text)
    text = re.sub(r'[ç]', 'c', text)
    text = re.sub(r'[^a-z0-9]+', '-', text)
    return text.strip('-')

def escape_html(text):
    return str(text).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;").replace("'", "&#39;")

def sha256(text):
    return hashlib.sha256(str(text).encode()).hexdigest()

def ensure_dir(path):
    Path(path).mkdir(parents=True, exist_ok=True)

def plain_text(prop):
    if not prop: return ""
    if prop.get("type") == "rich_text":
        return "".join([t.get("plain_text", "") for t in prop.get("rich_text", [])])
    if prop.get("type") == "title":
        return "".join([t.get("plain_text", "") for t in prop.get("title", [])])
    if prop.get("type") == "formula" and prop.get("formula", {}).get("type") == "string":
        return prop["formula"].get("string", "")
    return ""

def get_page_label(page):
    for key in ["Título", "Title", "Name", "Termo"]:
        val = plain_text(page.get("properties", {}).get(key))
        if val: return val
    return page.get("id", "Unknown")

def canonical_description(text, max_len=160):
    clean = re.sub(r'<[^>]*>', ' ', str(text))
    clean = re.sub(r'\s+', ' ', clean).strip()
    if len(clean) > max_len:
        return clean[:max_len].strip() + "…"
    return clean

def first_value(arr):
    return arr[0] if arr else ""

def safe_array(arr):
    if isinstance(arr, list):
        return [v for v in arr if v is not None and str(v).strip()]
    if arr is None: return []
    return [arr]

def to_display(v):
    if v is None: return ""
    if isinstance(v, str): return v
    if isinstance(v, (int, float, bool)): return str(v)
    if isinstance(v, dict):
        return v.get("url") or v.get("@id") or v.get("description") or json.dumps(v)
    return json.dumps(v)

def get_category_color(cat):
    cores = {
        "Geral": "#94a3b8", "Conceito": "#38bdf8", "Métrica": "#34d399",
        "Metodologia": "#818cf8", "Fenômeno": "#f472b6", "Estratégia": "#fbbf24",
        "Tecnologia": "#f97316", "Prática": "#a78bfa", "IA": "#38bdf8"
    }
    return cores.get(cat, "#94a3b8")

def get_cat_desc(cat):
    return {
        "Geral": "Termos fundamentais do ecossistema de RevOps e inteligência comercial.",
        "Conceito": "Definições canônicas de fenômenos, processos e entidades do mercado B2B.",
        "Métrica": "Indicadores e KPIs usados para mensurar desempenho comercial.",
        "Metodologia": "Frameworks, protocolos e abordagens sistematizadas de vendas e prospecção.",
        "Fenômeno": "Padrões emergentes, disfunções de mercado e comportamentos sistêmicos observados.",
        "Estratégia": "Posicionamentos táticos e planos de ação para vantagem competitiva.",
        "Tecnologia": "Ferramentas, plataformas e artefatos tecnológicos do ecossistema B2B.",
        "Prática": "Táticas operacionais e rotinas do campo comercial.",
        "IA": "Termos ligados a IA, autoridade semântica e infraestrutura cognitiva."
    }.get(cat, "Termos categorizados dentro da ontologia Wikivendas.")

def find_property(term, name):
    for p in term.get("additionalProperty", []):
        if p.get("name") == name:
            return p
    return None

def get_prop_values(term, name):
    p = find_property(term, name)
    if not p: return []
    val = p.get("value")
    return [v for v in (val if isinstance(val, list) else [val]) if v]

# ============================================================
# MARKDOWN PARSER PURO (sem bibliotecas externas)
# ============================================================

def markdown_to_html(text):
    if not text: return ""
    html = text

    # Headers
    html = re.sub(r'^###### (.*)$', r'<h6 class="gh-heading gh-h6">\1</h6>', html, flags=re.MULTILINE)
    html = re.sub(r'^##### (.*)$', r'<h5 class="gh-heading gh-h5">\1</h5>', html, flags=re.MULTILINE)
    html = re.sub(r'^#### (.*)$', r'<h4 class="gh-heading gh-h4">\1</h4>', html, flags=re.MULTILINE)
    html = re.sub(r'^### (.*)$', r'<h3 class="gh-heading gh-h3">\1</h3>', html, flags=re.MULTILINE)
    html = re.sub(r'^## (.*)$', r'<h2 class="gh-heading gh-h2">\1</h2>', html, flags=re.MULTILINE)
    html = re.sub(r'^# (.*)$', r'<h1 class="gh-heading gh-h1">\1</h1>', html, flags=re.MULTILINE)

    # Blockquotes
    html = re.sub(r'^> (.*)$', r'<blockquote class="gh-blockquote">\1</blockquote>', html, flags=re.MULTILINE)

    # Code blocks (triple backticks)
    html = re.sub(r'```(\w*)\n(.*?)```', r'<pre class="gh-pre"><code class="gh-code language-\1">\2</code></pre>', html, flags=re.DOTALL)

    # Inline code
    html = re.sub(r'`([^`]+)`', r'<code class="gh-code-inline">\1</code>', html)

    # Bold
    html = re.sub(r'\*\*([^*]+)\*\*', r'<strong>\1</strong>', html)
    html = re.sub(r'__([^_]+)__', r'<strong>\1</strong>', html)

    # Italic
    html = re.sub(r'\*([^*]+)\*', r'<em>\1</em>', html)
    html = re.sub(r'_([^_]+)_', r'<em>\1</em>', html)

    # Links
    html = re.sub(r'\[([^\]]+)\]\(([^)]+)\)', r'<a href="\2" target="_blank" rel="noopener noreferrer">\1</a>', html)

    # Images
    html = re.sub(r'!\[([^\]]*)\]\(([^)]+)\)', r'<img src="\2" alt="\1" loading="lazy" />', html)

    # Tables (simplificadas)
    table_lines = re.findall(r'(\|.*\|(?:\n\|.*\|)*)', html)
    for tbl in table_lines:
        rows = [r.strip() for r in tbl.split('\n') if r.strip()]
        if len(rows) < 2: continue
        header = rows[0]
        has_separator = re.search(r'\|[-:| ]+\|', rows[1]) if len(rows) > 1 else False
        start_row = 1 if has_separator else 0
        html_table = '<table class="gh-table">\n<thead><tr>'
        for cell in header.split('|')[1:-1]:
            html_table += f'<th>{cell.strip()}</th>'
        html_table += '</tr></thead>\n<tbody>'
        for r in rows[start_row+1 if has_separator else start_row:]:
            if re.search(r'\|[-:| ]+\|', r): continue
            html_table += '<tr>'
            for cell in r.split('|')[1:-1]:
                html_table += f'<td>{cell.strip()}</td>'
            html_table += '</tr>'
        html_table += '</tbody></table>'
        html = html.replace(tbl, html_table)

    # Paragraphs
    parts = re.split(r'\n\s*\n', html)
    html_paragraphs = []
    for p in parts:
        p = p.strip()
        if not p: continue
        if p.startswith('<h') or p.startswith('<blockquote') or p.startswith('<ul') or p.startswith('<ol') or p.startswith('<pre') or p.startswith('<table'):
            html_paragraphs.append(p)
        else:
            html_paragraphs.append(f'<p class="gh-p">{p}</p>')
    return '\n'.join(html_paragraphs)

# ============================================================
# NOTION API
# ============================================================

def query_notion():
    url = f"https://api.notion.com/v1/databases/{DATABASE_ID}/query"
    headers = {
        "Authorization": f"Bearer {NOTION_TOKEN}",
        "Notion-Version": "2022-06-28",
        "Content-Type": "application/json"
    }
    results = []
    cursor = None
    while True:
        payload = {"start_cursor": cursor} if cursor else {}
        resp = requests.post(url, headers=headers, json=payload)
        resp.raise_for_status()
        data = resp.json()
        results.extend(data.get("results", []))
        if not data.get("has_more"):
            break
        cursor = data.get("next_cursor")
    return results

def extract_json(raw):
    start = raw.find("{")
    end = raw.rfind("}")
    if start == -1 or end == -1: return None
    return raw[start:end+1]

def parse_notion_page(page):
    props = page.get("properties", {})
    label = get_page_label(page)
    
    json_raw = plain_text(props.get(JSON_PROP))
    if not json_raw:
        return {"status": "skipped", "reason": f"sem {JSON_PROP}"}
    
    json_str = extract_json(json_raw)
    if not json_str:
        return {"status": "invalid", "error": "JSON inválido"}
    
    try:
        data = json.loads(json_str)
    except Exception as e:
        return {"status": "invalid", "error": str(e)}
    
    return {
        "status": "ok",
        "label": label,
        "json": data,
        "graph": data.get("@graph", []),
        "md": plain_text(props.get(MD_PROP)),
        "owl": plain_text(props.get(OWL_PROP)),
        "runtime": plain_text(props.get(RUNTIME_PROP))
    }

# ============================================================
# RENDER TEMPLATES
# ============================================================

def render_header(version=BUILD_VERSION):
    return f'''<header class="wv-header"><div class="wv-header-inner"><div style="display:flex;align-items:center"><a href="/" class="wv-logo">Wikivendas</a><span class="wv-version">{version}</span></div><nav class="wv-nav"><a href="/">Início</a><a href="/glossario/">Glossário</a><a href="/sobre/">Sobre</a><a href="https://pauloleads.com.br" target="_blank" rel="noopener noreferrer">Paulo Leads</a></nav></div></header>'''

def render_footer(version=BUILD_VERSION):
    return f'''<footer class="wv-footer"><div class="wv-footer-inner"><div><div style="display:flex;align-items:center;gap:10px;margin-bottom:0.5rem"><span class="wv-logo">Wikivendas</span><span class="wv-version">{version}</span></div><p class="wv-footer-copy">© 2026 Wikivendas — Construído com Protocolo Hidra por Paulo Leads.</p></div><div class="wv-footer-links"><a href="/glossario.json">Grafo (.JSON)</a><a href="/ontology.jsonld">Ontologia (.OWL)</a><a href="/runtime.json">Runtime (.JSON)</a><a href="/llms.txt">llms.txt</a><a href="/ai-consent.json">ai-consent.json</a><a href="/robots.txt">robots.txt</a><a href="/sitemap.xml">sitemap.xml</a><a href="/build-report.json">build-report.json</a></div></footer>'''

def render_meta(title, description, canonical):
    return f'''<meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="msvalidate.01" content="7E347EFA12953E4BE1919F6E48CA7189" />
  <title>{escape_html(title)}</title>
  <meta name="description" content="{escape_html(description)}">
  <link rel="canonical" href="{canonical}">
  <meta property="og:title" content="{escape_html(title)}">
  <meta property="og:description" content="{escape_html(description)}">
  <meta property="og:type" content="website">
  <meta property="og:url" content="{canonical}">
  <meta property="og:site_name" content="Wikivendas">
  <meta name="twitter:card" content="summary_large_image">
  <link rel="ai-consent" href="/ai-consent.json">
  <link rel="llms" href="/llms.txt">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    :root {{
      --c0: #030712;
      --c1: #0a1120;
      --c2: #111827;
      --c3: #1e293b;
      --tp: #f1f5f9;
      --ts: #94a3b8;
      --tm: #475569;
      --ta: #38bdf8;
      --ta2: #818cf8;
      --tpink: #f472b6;
      --bd: rgba(255,255,0.06);
      --bds: rgba(255,255,255,0.12);
      --r: 14px;
      --r2: 18px;
    }}
    *, *::before, *::after {{ box-sizing: border-box; margin: 0; padding: 0; }}
    html {{ background: var(--c0); scroll-behavior: smooth; }}
    body {{ font-family: 'Inter', sans-serif; background: var(--c0); color: var(--ts); -webkit-font-smoothing: antialiased; overflow-x: hidden; line-height: 1.6; }}
    a {{ text-decoration: none; }}
    .wv-header {{ position: sticky; top: 0; z-index: 50; border-bottom: 0.5px solid var(--bd); background: rgba(3,7,18,0.85); backdrop-filter: blur(16px); }}
    .wv-header-inner {{ max-width: 1160px; margin: 0 auto; padding: 0 2rem; height: 60px; display: flex; align-items: center; justify-content: space-between; }}
    .wv-logo {{ font-size: 15px; font-weight: 800; letter-spacing: 0.06em; text-transform: uppercase; background: linear-gradient(90deg, #38bdf8, #818cf8); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; }}
    .wv-version {{ font-size: 10px; font-family: 'JetBrains Mono', monospace; color: var(--tm); background: var(--c2); border: 0.5px solid var(--bds); padding: 3px 8px; border-radius: 20px; margin-left: 10px; -webkit-text-fill-color: var(--tm); }}
    .wv-nav {{ display: flex; gap: 2rem; }}
    .wv-nav a {{ font-size: 13px; color: var(--tm); transition: color 0.15s; }}
    .wv-nav a:hover {{ color: var(--tp); }}
    .wv-section-label {{ font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--ta); margin-bottom: 1rem; font-family: 'JetBrains Mono', monospace; }}
    .wv-btn-primary {{ display: inline-flex; align-items: center; gap: 8px; padding: 12px 28px; background: #38bdf8; color: #030712; border-radius: var(--r); font-size: 14px; font-weight: 700; transition: background 0.15s, transform 0.1s; border: none; cursor: pointer; }}
    .wv-btn-primary:hover {{ background: #7dd3fc; transform: translateY(-1px); }}
    .wv-btn-ghost {{ display: inline-flex; align-items: center; gap: 8px; padding: 12px 24px; background: transparent; color: var(--ts); border: 0.5px solid var(--bds); border-radius: var(--r); font-size: 14px; transition: background 0.15s, color 0.15s; }}
    .wv-btn-ghost:hover {{ background: var(--c2); color: var(--tp); }}
    .wv-pill {{ font-size: 10px; background: rgba(56,189,248,0.1); color: var(--ta); border: 0.5px solid rgba(56,189,248,0.2); padding: 3px 8px; border-radius: 20px; font-family: 'JetBrains Mono', monospace; }}
    .wv-footer {{ border-top: 0.5px solid var(--bd); background: var(--c0); padding: 3rem 2rem; }}
    .wv-footer-inner {{ max-width: 1160px; margin: 0 auto; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 1.5rem; }}
    .wv-footer-copy {{ font-size: 12px; font-family: 'JetBrains Mono', monospace; color: var(--tm); }}
    .wv-footer-links {{ display: flex; gap: 1.5rem; flex-wrap: wrap; }}
    .wv-footer-links a {{ font-size: 12px; font-family: 'JetBrains Mono', monospace; color: var(--tm); transition: color 0.15s; }}
    .wv-footer-links a:hover {{ color: var(--ts); }}
    
    /* GitHub README Style - SEM RISCOS AMARELOS */
    .wv-markdown {{ background: transparent !important; border: none !important; padding: 0 !important; margin-bottom: 1.5rem !important; }}
    .wv-markdown h1, .wv-markdown h2, .wv-markdown h3, .wv-markdown h4, .wv-markdown h5, .wv-markdown h6 {{ color: var(--tp); font-weight: 600; letter-spacing: -0.02em; margin-top: 2rem; margin-bottom: 1rem; }}
    .wv-markdown h1 {{ font-size: 2rem; padding-bottom: 0.3rem; border-bottom: 1px solid var(--bd); }}
    .wv-markdown h2 {{ font-size: 1.6rem; padding-bottom: 0.3rem; border-bottom: 1px solid var(--bd); }}
    .wv-markdown h3 {{ font-size: 1.3rem; }}
    .wv-markdown h4 {{ font-size: 1.1rem; }}
    .wv-markdown h5 {{ font-size: 1rem; color: var(--tm); }}
    .wv-markdown h6 {{ font-size: 0.875rem; color: var(--tm); }}
    .wv-markdown p {{ font-size: 16px; line-height: 1.8; color: var(--ts); margin-bottom: 1rem; }}
    .wv-markdown pre {{ background: #0d1117 !important; border: 1px solid #30363d !important; border-radius: 6px !important; padding: 1rem !important; overflow-x: auto !important; margin: 1rem 0 !important; }}
    .wv-markdown code {{ font-family: 'JetBrains Mono', monospace; font-size: 13.5px; color: #e6edf3; }}
    .wv-markdown pre code {{ background: transparent !important; border: none !important; padding: 0 !important; color: #e6edf3; }}
    .wv-markdown blockquote {{ border-left: 4px solid var(--ta); padding-left: 1rem; margin: 1rem 0; color: var(--ts); background: rgba(56,189,248,0.04); border-radius: 0 6px 6px 0; }}
    .wv-markdown ul, .wv-markdown ol {{ padding-left: 1.5rem; margin: 0.5rem 0 1rem; }}
    .wv-markdown ul li, .wv-markdown ol li {{ font-size: 15px; line-height: 1.8; color: var(--ts); margin-bottom: 0.25rem; }}
    .wv-markdown table {{ border-collapse: collapse; width: 100%; margin: 1rem 0; font-size: 14px; display: block; overflow-x: auto; }}
    .wv-markdown table th, .wv-markdown table td {{ border: 1px solid var(--bd); padding: 0.6rem 0.8rem; text-align: left; }}
    .wv-markdown table th {{ background: var(--c2); color: var(--tp); font-weight: 600; }}
    .wv-markdown table td {{ color: var(--ts); }}
    .wv-markdown img {{ max-width: 100%; display: block; margin: 1rem 0; border-radius: 6px; }}
    .wv-markdown hr {{ border: none; height: 1px; background: var(--bd); margin: 2rem 0; }}
    .wv-cta-box {{ background: var(--c2); border: 1px solid var(--bd); border-radius: 12px; padding: 2rem; text-align: center; margin-top: 3rem; }}
    .wv-cta-box h2 {{ font-size: 22px; font-weight: 700; color: var(--tp); margin-bottom: 0.75rem; border: none; }}
    .wv-cta-box p {{ font-size: 15px; color: var(--ts); max-width: 520px; margin: 0 auto 1.5rem; line-height: 1.6; }}
    .wv-cta-btn {{ display: inline-flex; align-items: center; gap: 8px; padding: 12px 28px; background: #238636; color: #fff; border-radius: 6px; font-size: 14px; font-weight: 600; transition: background 0.2s; border: none; cursor: pointer; }}
    .wv-cta-btn:hover {{ background: #2ea043; }}
    .wv-cta-btn-secondary {{ display: inline-flex; align-items: center; gap: 8px; padding: 12px 28px; background: transparent; color: var(--ts); border: 1px solid var(--bds); border-radius: 6px; font-size: 14px; font-weight: 500; transition: all 0.2s; margin-left: 0.75rem; }}
    .wv-cta-btn-secondary:hover {{ background: var(--c2); color: var(--tp); }}
    @media(max-width:768px) {{ .wv-container {{ padding: 2rem 1.25rem 3rem; }} .wv-cta-btn-secondary {{ margin-left: 0; margin-top: 0.75rem; display: block; }} }}
  </style>'''

def render_term_page(record, md_html):
    json_data = record["json"]
    graph = record["graph"]
    term = next((n for n in graph if n.get("@type") == "DefinedTerm"), {})
    label = record["label"]
    slug = slugify(label)
    desc = term.get("description", "")
    short_desc = canonical_description(desc, 220)
    cat = first_value(get_prop_values(term, "categoria")) or "Geral"
    cat_color = get_category_color(cat)
    content_hash = sha256(json.dumps(json_data, sort_keys=True))
    
    # URL ÚNICA E CORRETA PARA TUDO
    canonical_url = urljoin(SITE_BASE_URL, f"/termos/{slug}.html")
    
    html = f'''<!DOCTYPE html><html lang="pt-BR"><head>
{render_meta(title=f"{label} — Wikivendas", description=short_desc, canonical=canonical_url)}
<script type="application/ld+json">{json.dumps(json_data, ensure_ascii=False, indent=2)}</script>
<style>
.wv-container{{max-width:860px;margin:0 auto;padding:3rem 2rem 4rem}}
.wv-back{{display:inline-flex;align-items:center;gap:6px;color:var(--tm);font-size:14px;margin-bottom:2rem;transition:color.15s}}
.wv-back:hover{{color:var(--tp)}}
.wv-hero{{border-radius:24px;padding:2.5rem;margin-bottom:2.5rem;position:relative;overflow:hidden}}
.wv-hero-glow{{position:absolute;top:-40%;right:-20%;width:300px;height:300px;border-radius:50%;filter:blur(80px);opacity:.15;pointer-events:none}}
.wv-hero-content{{position:relative;z-index:1}}
.wv-term-title{{font-size:clamp(34px,5vw,56px);font-weight:900;color:var(--tp);letter-spacing:-.04em;line-height:1.03;margin-bottom:.75rem}}
.wv-term-alternate{{font-size:16px;color:var(--ts);margin-bottom:1.25rem;font-weight:400}}
.wv-badge-row{{display:flex;flex-wrap:wrap;gap:.5rem;margin-bottom:1.25rem}}
.wv-badge{{display:inline-flex;align-items:center;gap:6px;padding:5px 12px;border-radius:999px;font-size:11px;font-family:'JetBrains Mono',monospace;font-weight:500}}
.wv-badge-cat{{background:rgba(56,189,248,.12);color:var(--ta);border:.5px solid rgba(56,189,248,.25)}}
.wv-badge-status{{background:rgba(52,211,153,.12);color:#34d399;border:.5px solid rgba(52,211,153,.25)}}
.wv-badge-protocolo{{background:rgba(129,140,248,.12);color:#818cf8;border:.5px solid rgba(129,140,248,.25)}}
.wv-badge-versao{{background:rgba(251,191,36,.12);color:#fbbf24;border:.5px solid rgba(251,191,36,.25)}}
.wv-hero-desc{{font-size:17px;line-height:1.75;color:var(--ts);max-width:720px}}
.wv-hero-meta{{display:flex;flex-wrap:wrap;gap:.75rem;margin-top:1.5rem}}
.wv-hero-meta a,.wv-hero-meta span{{display:inline-flex;align-items:center;gap:6px;padding:6px 12px;border-radius:999px;background:var(--c2);border:.5px solid var(--bd);font-size:12px;font-family:'JetBrains Mono',monospace;color:var(--ts)}}
.wv-hero-meta a{{color:var(--ta)}}
.wv-proof{{display:inline-flex;align-items:center;gap:8px;margin-top:1.5rem;padding:8px 16px;border-radius:999px;background:rgba(56,189,248,.06);border:.5px solid rgba(56,189,248,.15)}}
.wv-proof-icon{{width:8px;height:8px;border-radius:50%;background:#34d399;animation:pulse 2s ease-in-out infinite}}
@keyframes pulse{{0%,100%{{opacity:1}}50%{{opacity:.3}}}}
.wv-proof-text{{font-size:11px;font-family:'JetBrains Mono',monospace;color:var(--ts)}}
.wv-proof-text.hash{{color:var(--ta)}}
.wv-markdown{{margin-top:2rem}}
@media(max-width:768px){{.wv-container{{padding:2rem 1.25rem 3rem}}.wv-hero{{padding:1.75rem}}}}
</style></head><body>{render_header()}<main class="wv-container"><a href="/glossario/" class="wv-back">← Voltar ao glossário</a>
<section class="wv-hero" style="background:linear-gradient(135deg,{cat_color}15,{cat_color}05,var(--c1));border:1px solid {cat_color}25"><div class="wv-hero-glow" style="background:{cat_color}"></div><div class="wv-hero-content"><div class="wv-badge-row"><span class="wv-badge wv-badge-cat">{escape_html(cat)}</span></div><h1 class="wv-term-title">{escape_html(label)}</h1><p class="wv-hero-desc">{escape_html(short_desc)}</p><div class="wv-proof"><span class="wv-proof-icon"></span><span class="wv-proof-text">Verificado · SHA256 <span class="hash">{content_hash[:16]}</span> · {BUILD_TIMESTAMP[:10]}</span></div></div></section>
<article class="wv-markdown">{md_html}</article>
<section class="wv-cta-box"><h2>Quer aplicar este conceito na sua operação?</h2><p>Cada termo da Wikivendas tem uma camada de serviço correspondente. Solicite um diagnóstico gratuito.</p><div><a href="https://pauloleads.com.br" target="_blank" rel="noopener noreferrer" class="wv-cta-btn">Solicitar diagnóstico →</a><a href="/glossario/" class="wv-cta-btn-secondary">Explorar mais termos</a></div></section></main>{render_footer()}</body></html>'''
    return html, slug

def render_glossary_page(records):
    from collections import defaultdict
    by_cat = defaultdict(list)
    for r in records:
        graph = r["graph"]
        term = next((n for n in graph if n.get("@type") == "DefinedTerm"), {})
        cat = first_value(get_prop_values(term, "categoria")) or "Geral"
        by_cat[cat].append(r)
    
    html = f'''<!DOCTYPE html><html lang="pt-BR"><head>
{render_meta(title="Glossário Wikivendas", description="Glossário geral da Wikivendas com todas as categorias e verbetes indexáveis.", canonical=urljoin(SITE_BASE_URL, "/glossario/"))}
<style>
.wv-glossario{{max-width:1100px;margin:0 auto;padding:5rem 2rem 4rem}}
.wv-headline{{font-size:clamp(34px,5vw,58px);font-weight:900;line-height:1.02;letter-spacing:-.04em;color:var(--tp);margin-bottom:1.5rem}}
.wv-lead{{font-size:17px;color:var(--ts);max-width:760px;line-height:1.7;margin-bottom:2rem}}
.wv-search{{width:100%;padding:14px 16px;background:var(--c1);color:var(--tp);border:.5px solid var(--bds);border-radius:var(--r);font-size:15px;margin-bottom:3rem}}
.wv-cat-section{{margin-bottom:3rem}}
.wv-cat-titulo{{display:flex;align-items:center;gap:10px;font-size:18px;font-weight:700;color:var(--tp);margin-bottom:.5rem}}
.wv-cat-dot{{width:10px;height:10px;border-radius:50%;flex-shrink:0}}
.wv-cat-count{{font-size:12px;font-family:'JetBrains Mono',monospace;color:var(--tm);font-weight:400;margin-left:4px}}
.wv-cat-desc{{font-size:13px;color:var(--tm);margin-bottom:1rem;max-width:600px}}
.wv-termo-list{{display:flex;flex-direction:column;border:.5px solid var(--bd);border-radius:var(--r);overflow:hidden}}
.wv-termo-item{{display:grid;grid-template-columns:1fr 1fr;gap:1rem;padding:.9rem 1.25rem;background:var(--c1);border-bottom:.5px solid var(--bd);transition:background.15s}}
.wv-termo-item:last-child{{border-bottom:none}}
.wv-termo-item:hover{{background:var(--c2)}}
.wv-termo-item-nome{{font-size:14px;font-weight:600;color:var(--tp)}}
.wv-termo-item-def{{font-size:12px;color:var(--tm);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}}
@media(max-width:768px){{.wv-glossario{{padding:4rem 1.25rem 3rem}}.wv-termo-item{{grid-template-columns:1fr}}.wv-termo-item-def{{display:none}}}}
</style></head><body>{render_header()}<section class="wv-glossario"><p class="wv-section-label">Índice canônico terminológico</p><h1 class="wv-headline">Glossário da Wikivendas</h1><p class="wv-lead">Página real e indexável com todas as categorias e verbetes.</p><input id="wv-glossary-search" class="wv-search" type="search" placeholder="Buscar termo ou categoria">'''
    
    for cat, items in sorted(by_cat.items()):
        color = get_category_color(cat)
        html += f'''<section class="wv-cat-section glossary-group" data-search="{escape_html(cat.lower())}"><div class="wv-cat-titulo"><span class="wv-cat-dot" style="background:{color}"></span>{escape_html(cat)}<span class="wv-cat-count">{len(items)} termos</span></div><div class="wv-cat-desc">{escape_html(get_cat_desc(cat))}</div><div class="wv-termo-list">'''
        for r in items:
            graph = r["graph"]
            term = next((n for n in graph if n.get("@type") == "DefinedTerm"), {})
            label = r["label"]
            slug = slugify(label)
            desc = term.get("description", "")
            short_desc = canonical_description(desc, 100)
            html += f'''<a href="/termos/{slug}.html" class="wv-termo-item"><span class="wv-termo-item-nome">{escape_html(label)}</span><span class="wv-termo-item-def">{escape_html(short_desc)}</span></a>'''
        html += '</div></section>'
    
    html += f'''</section>{render_footer()}
<script>const q=document.getElementById('wv-glossary-search');const groups=[...document.querySelectorAll('.glossary-group')];if(q){{q.addEventListener('input',()=>{{const s=q.value.toLowerCase().trim();groups.forEach(sec=>{{const t=sec.dataset.search;sec.style.display=!s||t.includes(s)?'':'none';}});}});}}</script></body></html>'''
    return html

# ============================================================
# INFRAESTRUTURA
# ============================================================

def render_sitemap(records):
    urls = [f"<url><loc>{SITE_BASE_URL}/</loc><lastmod>{BUILD_TIMESTAMP[:10]}</loc><changefreq>weekly</changefreq><priority>1.0</priority></url>"]
    for r in records:
        slug = slugify(r["label"])
        urls.append(f"<url><loc>{urljoin(SITE_BASE_URL, f'/termos/{slug}.html')}</loc><lastmod>{BUILD_TIMESTAMP[:10]}</loc><changefreq>monthly</changefreq><priority>0.7</priority></url>")
    return f'''<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">{"".join(urls)}</urlset>'''

def render_robots():
    return f'''User-agent: *\nAllow: /\nSitemap: {urljoin(SITE_BASE_URL, '/sitemap.xml')}\nDisallow: /node_modules/\nDisallow: /.git/\n'''

def render_llms_txt(records):
    lines = [f"TITLE: Wikivendas", f"URL: {SITE_BASE_URL}", "DESCRIPTION: Enciclopédia brasileira de termos técnicos de vendas B2B, RevOps e inteligência comercial.", "", "TERMS:"]
    for r in records:
        slug = slugify(r["label"])
        lines.append(f"- {r['label']} {urljoin(SITE_BASE_URL, f'/termos/{slug}.html')}")
    lines.append("")
    lines.append("INDEX:")
    lines.append(f"- Glossário completo {urljoin(SITE_BASE_URL, '/glossario/')}")
    lines.append(f"- Sobre {urljoin(SITE_BASE_URL, '/sobre/')}")
    return "\n".join(lines)

def render_ai_consent():
    return json.dumps({
        "@context": "https://schema.org",
        "@type": "CreativeWork",
        "name": "Wikivendas Terms of AI Use",
        "description": "Consentimento explícito para crawling, indexação e citação por LLMs e sistemas de IA.",
        "license": "https://creativecommons.org/licenses/by/4.0/",
        "author": {"@type": "Person", "name": "Paulo C. P. Santos"},
        "datePublished": BUILD_TIMESTAMP[:10],
        "inLanguage": "pt-BR",
        "isAccessibleForFree": True,
        "creditText": "Fonte: Wikivendas — wikivendas.com.br"
    }, ensure_ascii=False, indent=2)

# ============================================================
# MAIN
# ============================================================

def main():
    print(f"🚀 Iniciando build {BUILD_VERSION}...")
    pages = query_notion()
    print(f"📄 {len(pages)} páginas encontradas no Notion.")
    
    records = []
    for page in pages:
        result = parse_notion_page(page)
        if result["status"] == "ok":
            records.append(result)
    
    print(f"✅ {len(records)} termos válidos processados.")
    
    ensure_dir("docs/termos")
    ensure_dir("docs/glossario")
    
    # Gerar JSONs
    graph_all = []
    for r in records:
        graph_all.extend(r.get("graph", []))
    write_file("docs/glossario.json", json.dumps({"@context": "https://schema.org", "@graph": graph_all}, ensure_ascii=False, indent=2))
    
    # Gerar HTMLs
    for r in records:
        md_html = markdown_to_html(r.get("md", ""))
        html, slug = render_term_page(r, md_html)
        write_file(f"docs/termos/{slug}.html", html)
        write_file(f"docs/termos/{slug}.json", json.dumps(r.get("json", {}), ensure_ascii=False, indent=2))
    
    write_file("docs/glossario/index.html", render_glossary_page(records))
    write_file("docs/sitemap.xml", render_sitemap(records))
    write_file("docs/robots.txt", render_robots())
    write_file("docs/llms.txt", render_llms_txt(records))
    write_file("docs/ai-consent.json", render_ai_consent())
    write_file("docs/CNAME", CUSTOM_DOMAIN)
    
    print("✅ Build concluído com sucesso!")

def write_file(path, content):
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)

if __name__ == "__main__":
    main()

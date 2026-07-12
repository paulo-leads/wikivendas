# build_static.py - Gerador de Páginas Estáticas para GitHub Pages
import os
import json
import requests
from pathlib import Path
from datetime import datetime
from typing import Dict, List, Optional
import logging

# Configuração
BASE = "https://wikisales.wikibase.cloud/wiki/Special:EntityData"
SPARQL = "https://wikisales.wikibase.cloud/query/sparql"
HEADERS = {"Accept": "application/sparql-results+json"}

OUTPUT_DIR = "docs"

# Logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Cache simples
cache = {}

def read_entity_json(entity_id: str):
    """Lê entidade do WikiSales"""
    if entity_id in cache:
        return cache[entity_id]
    
    url = f"{BASE}/{entity_id}.json"
    try:
        r = requests.get(url, timeout=20)
        r.raise_for_status()
        data = r.json()["entities"][entity_id]
        cache[entity_id] = data
        return data
    except Exception as e:
        logger.error(f"Erro ao ler entidade {entity_id}: {e}")
        return None

def pick_lang(block):
    """Pega o melhor idioma disponível"""
    if not block:
        return None
    for key in ("pt-br", "pt", "en"):
        if key in block:
            return block[key].get("value")
    first = next(iter(block.values()))
    return first.get("value")

def pick_aliases(data):
    """Pega aliases"""
    aliases = []
    if not data:
        return aliases
    for lang in ("pt-br", "pt", "en"):
        for item in data.get("aliases", {}).get(lang, []):
            val = item.get("value")
            if val and val not in aliases:
                aliases.append(val)
    return aliases

def get_property_info(pid: str):
    """Obtém informações de uma propriedade"""
    data = read_entity_json(pid)
    if not data:
        return None
    
    return {
        "id": pid,
        "label": pick_lang(data.get("labels", {})),
        "description": pick_lang(data.get("descriptions", {})),
        "datatype": data.get("datatype"),
        "aliases": pick_aliases(data),
        "url": f"https://wikisales.wikibase.cloud/wiki/Property:{pid}"
    }

def get_item_label(qid: str):
    """Obtém label de um item"""
    data = read_entity_json(qid)
    if not data:
        return qid
    return pick_lang(data.get("labels", {})) or qid

def get_item_with_properties(qid: str):
    """Obtém item completo com propriedades"""
    data = read_entity_json(qid)
    if not data:
        return None
    
    item_data = {
        "id": qid,
        "label": pick_lang(data.get("labels", {})),
        "description": pick_lang(data.get("descriptions", {})),
        "aliases": pick_aliases(data),
        "url": f"https://wikisales.wikibase.cloud/wiki/Item:{qid}",
        "properties": []
    }
    
    claims = data.get("claims", {})
    for pid, statements in claims.items():
        prop_info = get_property_info(pid)
        if not prop_info:
            continue
            
        values = []
        for st in statements[:10]:
            mainsnak = st.get("mainsnak", {})
            dv = mainsnak.get("datavalue", {})
            val = dv.get("value")
            
            if isinstance(val, dict) and 'id' in val:
                item_id = val['id']
                values.append({
                    "type": "item",
                    "id": item_id,
                    "label": get_item_label(item_id),
                    "value": item_id
                })
            elif isinstance(val, str):
                values.append({"type": "text", "value": val})
            elif isinstance(val, dict) and 'text' in val:
                values.append({"type": "text", "value": val['text']})
            elif isinstance(val, dict) and 'time' in val:
                values.append({"type": "date", "value": val.get('time', '')})
            elif isinstance(val, dict) and 'latitude' in val:
                values.append({
                    "type": "coordinate", 
                    "value": f"{val.get('latitude')}, {val.get('longitude')}"
                })
            else:
                values.append({"type": "unknown", "value": str(val) if val else None})
        
        item_data["properties"].append({
            "id": pid,
            "label": prop_info["label"],
            "description": prop_info["description"],
            "datatype": prop_info["datatype"],
            "values": values,
            "count": len(statements),
            "url": prop_info["url"]
        })
    
    return item_data

def discover_items(limit: int = 50):
    """Descobre itens disponíveis"""
    query = f"""
    PREFIX wikibase: <http://wikiba.se/ontology#>
    SELECT ?item WHERE {{
      ?item a wikibase:Item .
    }}
    ORDER BY ?item
    LIMIT {limit}
    """
    try:
        r = requests.get(SPARQL, params={"query": query, "format": "json"}, headers=HEADERS, timeout=25)
        r.raise_for_status()
        rows = r.json().get("results", {}).get("bindings", [])
        items = []
        for row in rows:
            uri = row["item"]["value"]
            qid = uri.rstrip('/').split('/')[-1]
            if qid.startswith('Q'):
                items.append(qid)
        return items
    except Exception as e:
        logger.error(f"Erro ao descobrir itens: {e}")
        return []

def generate_html(item_data: Dict) -> str:
    """Gera HTML completo para o item"""
    props_html = ""
    if item_data.get("properties"):
        for prop in item_data["properties"]:
            values_html = ""
            if prop.get("values"):
                for v in prop["values"]:
                    if v.get("type") == "item":
                        values_html += f'<span class="value-tag value-tag-item"><a href="/item/{v.get("id").lower()}">{v.get("label") or v.get("value")}</a></span>'
                    else:
                        values_html += f'<span class="value-tag">{v.get("value") or "N/A"}</span>'
            
            props_html += f'''
            <div class="property-card">
                <div class="property-header">
                    <span class="property-name">{prop.get("label") or prop.get("id")}</span>
                    <span class="property-id">{prop.get("id")}</span>
                </div>
                {f'<div class="property-desc">💡 {prop.get("description")}</div>' if prop.get("description") else ''}
                <div style="display:flex;gap:10px;flex-wrap:wrap;margin:5px 0;">
                    <span class="property-datatype">📊 {prop.get("datatype") or "unknown"}</span>
                    <span style="font-size:0.85em;color:#718096;">{prop.get("count", 0)} valor(es)</span>
                </div>
                {f'<div class="property-values">{values_html}</div>' if values_html else '<div style="color:#a0aec0;font-size:0.9em;">Sem valores</div>'}
                {f'<a href="{prop.get("url")}" target="_blank" style="font-size:0.8em;color:#667eea;">Ver propriedade</a>' if prop.get("url") else ''}
            </div>
            '''
    
    return f'''<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>{item_data.get("label") or item_data.get("id")} - WikiSales</title>
    <meta name="description" content="{item_data.get("description") or f"Informações sobre {item_data.get("label")}"}" />
    <link rel="canonical" href="https://wikivendas.com.br/item/{item_data.get("id").lower()}" />
    <style>
        :root {{
            --color-bg: #0a0a0a;
            --color-surface: #111111;
            --color-surface-light: #1a1a1a;
            --color-border: #2a2a2a;
            --color-text: #e8e8e8;
            --color-text-secondary: #a0a0a0;
            --color-text-muted: #6a6a6a;
            --color-accent: #2d7aff;
            --color-accent-hover: #5a9aff;
            --color-accent-glow: rgba(45, 122, 255, 0.12);
            --font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            --font-mono: 'JetBrains Mono', 'Fira Code', monospace;
            --max-width: 1200px;
            --radius: 8px;
            --radius-lg: 12px;
            --spacing-sm: 0.5rem;
            --spacing-md: 1rem;
            --spacing-lg: 2rem;
            --spacing-xl: 3rem;
        }}
        
        * {{ margin: 0; padding: 0; box-sizing: border-box; }}
        
        body {{
            font-family: var(--font-family);
            background-color: var(--color-bg);
            color: var(--color-text);
            line-height: 1.6;
        }}
        
        .container {{
            max-width: var(--max-width);
            margin: 0 auto;
            padding: 0 var(--spacing-lg);
        }}
        
        .navbar {{
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            z-index: 1000;
            background: rgba(10, 10, 10, 0.95);
            backdrop-filter: blur(16px);
            border-bottom: 1px solid var(--color-border);
            padding: 0.6rem 0;
        }}
        
        .navbar .container {{
            display: flex;
            align-items: center;
            justify-content: space-between;
        }}
        
        .navbar-brand {{
            display: flex;
            align-items: center;
            gap: var(--spacing-sm);
            font-weight: 700;
            font-size: 1.25rem;
            color: var(--color-text);
            text-decoration: none;
        }}
        
        .navbar-brand .logo-dot {{
            display: inline-block;
            width: 10px;
            height: 10px;
            background: var(--color-accent);
            border-radius: 50%;
            box-shadow: 0 0 20px var(--color-accent-glow);
        }}
        
        .navbar-links {{
            display: flex;
            align-items: center;
            gap: var(--spacing-lg);
            list-style: none;
        }}
        
        .navbar-links a {{
            color: var(--color-text-secondary);
            font-size: 0.875rem;
            text-decoration: none;
            transition: color 0.25s ease;
        }}
        
        .navbar-links a:hover {{
            color: var(--color-text);
        }}
        
        .hero {{
            padding: 120px 0 var(--spacing-xl);
            margin-top: 56px;
            border-bottom: 1px solid var(--color-border);
            background: radial-gradient(ellipse at 30% 20%, var(--color-accent-glow), transparent 70%);
        }}
        
        .hero h1 {{
            font-size: 2.5rem;
            margin-bottom: var(--spacing-sm);
            font-weight: 700;
            letter-spacing: -0.02em;
        }}
        
        .hero .badge {{
            display: inline-block;
            font-family: var(--font-mono);
            font-size: 0.875rem;
            color: var(--color-accent);
            background: var(--color-surface);
            border: 1px solid var(--color-border);
            padding: 0.25rem 0.75rem;
            border-radius: 100px;
            margin-bottom: var(--spacing-md);
        }}
        
        .hero .item-id {{
            font-family: var(--font-mono);
            color: var(--color-text-muted);
            font-size: 1rem;
        }}
        
        .hero .aliases {{
            color: var(--color-text-secondary);
            font-size: 0.95rem;
            margin: var(--spacing-sm) 0;
        }}
        
        .hero .aliases span {{
            background: var(--color-surface-light);
            padding: 2px 12px;
            border-radius: 12px;
            margin-right: 5px;
            display: inline-block;
            border: 1px solid var(--color-border);
        }}
        
        .hero .item-url {{
            display: inline-block;
            margin-top: var(--spacing-md);
            color: var(--color-accent);
            text-decoration: none;
        }}
        
        .hero .item-url:hover {{
            text-decoration: underline;
        }}
        
        .properties-section {{
            padding: var(--spacing-xl) 0;
        }}
        
        .properties-title {{
            font-size: 1.5rem;
            margin-bottom: var(--spacing-lg);
            font-weight: 600;
        }}
        
        .property-card {{
            background: var(--color-surface);
            border-radius: var(--radius-lg);
            padding: var(--spacing-lg);
            margin-bottom: var(--spacing-md);
            border: 1px solid var(--color-border);
            transition: border-color 0.25s ease;
        }}
        
        .property-card:hover {{
            border-color: var(--color-accent);
        }}
        
        .property-header {{
            display: flex;
            justify-content: space-between;
            align-items: center;
            flex-wrap: wrap;
            margin-bottom: var(--spacing-sm);
        }}
        
        .property-name {{
            font-weight: 700;
            font-size: 1.1rem;
            color: var(--color-text);
        }}
        
        .property-id {{
            color: var(--color-text-muted);
            font-size: 0.85rem;
            background: var(--color-bg);
            padding: 2px 12px;
            border-radius: 12px;
            font-family: var(--font-mono);
        }}
        
        .property-desc {{
            color: var(--color-text-secondary);
            font-size: 0.95rem;
            margin: var(--spacing-sm) 0;
        }}
        
        .property-datatype {{
            font-size: 0.8rem;
            color: var(--color-text-muted);
            background: var(--color-bg);
            padding: 2px 12px;
            border-radius: 12px;
            font-family: var(--font-mono);
        }}
        
        .property-values {{
            margin-top: var(--spacing-sm);
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
        }}
        
        .value-tag {{
            background: var(--color-surface-light);
            color: var(--color-text);
            padding: 4px 14px;
            border-radius: 16px;
            font-size: 0.9rem;
            border: 1px solid var(--color-border);
        }}
        
        .value-tag-item {{
            background: rgba(45, 122, 255, 0.12);
            border-color: var(--color-accent);
        }}
        
        .value-tag-item a {{
            color: var(--color-accent);
            text-decoration: none;
        }}
        
        .value-tag-item a:hover {{
            text-decoration: underline;
        }}
        
        .no-props {{
            color: var(--color-text-muted);
            text-align: center;
            padding: var(--spacing-xl) 0;
        }}
        
        .nav-links {{
            margin: var(--spacing-lg) 0;
            display: flex;
            gap: var(--spacing-md);
            flex-wrap: wrap;
        }}
        
        .nav-links a {{
            color: var(--color-accent);
            text-decoration: none;
            font-size: 0.95rem;
        }}
        
        .nav-links a:hover {{
            text-decoration: underline;
        }}
        
        .footer {{
            padding: var(--spacing-xl) 0 var(--spacing-lg);
            border-top: 1px solid var(--color-border);
            margin-top: var(--spacing-xl);
        }}
        
        .footer-grid {{
            display: grid;
            grid-template-columns: 2fr 1fr 1fr;
            gap: var(--spacing-xl);
        }}
        
        .footer-brand .brand {{
            font-weight: 700;
            font-size: 1.25rem;
            display: flex;
            align-items: center;
            gap: var(--spacing-sm);
        }}
        
        .footer-brand .brand .dot {{
            display: inline-block;
            width: 8px;
            height: 8px;
            background: var(--color-accent);
            border-radius: 50%;
        }}
        
        .footer-brand p {{
            color: var(--color-text-secondary);
            font-size: 0.875rem;
            max-width: 320px;
        }}
        
        .footer-col h5 {{
            font-size: 0.875rem;
            text-transform: uppercase;
            letter-spacing: 0.06em;
            color: var(--color-text-muted);
            margin-bottom: var(--spacing-sm);
        }}
        
        .footer-col ul {{
            list-style: none;
        }}
        
        .footer-col li {{
            margin-bottom: var(--spacing-sm);
        }}
        
        .footer-col a {{
            color: var(--color-text-secondary);
            font-size: 0.875rem;
            text-decoration: none;
        }}
        
        .footer-col a:hover {{
            color: var(--color-text);
        }}
        
        .footer-bottom {{
            border-top: 1px solid var(--color-border);
            margin-top: var(--spacing-lg);
            padding-top: var(--spacing-md);
            display: flex;
            justify-content: space-between;
            flex-wrap: wrap;
            gap: var(--spacing-md);
            font-size: 0.875rem;
            color: var(--color-text-muted);
        }}
        
        @media (max-width: 768px) {{
            .hero h1 {{ font-size: 1.8rem; }}
            .footer-grid {{ grid-template-columns: 1fr; gap: var(--spacing-lg); }}
            .navbar-links {{ display: none; }}
        }}
    </style>
</head>
<body>
    <nav class="navbar">
        <div class="container">
            <a href="/" class="navbar-brand">
                <span class="logo-dot"></span> WikiSales
            </a>
            <ul class="navbar-links">
                <li><a href="/">Início</a></li>
                <li><a href="/items">Itens</a></li>
                <li><a href="https://wikisales.wikibase.cloud" target="_blank">WikiSales</a></li>
            </ul>
        </div>
    </nav>

    <section class="hero">
        <div class="container">
            <div class="badge">📦 Item do WikiSales</div>
            <h1>{item_data.get("label") or item_data.get("id")}</h1>
            <div class="item-id">ID: {item_data.get("id")}</div>
            {f'<p style="color:var(--color-text-secondary);font-size:1.1rem;margin:var(--spacing-sm) 0;">{item_data.get("description")}</p>' if item_data.get("description") else ''}
            {f'<div class="aliases">Também conhecido como: {"".join([f"<span>{a}</span>" for a in item_data.get("aliases", [])])}</div>' if item_data.get("aliases") else ''}
            <a href="{item_data.get("url")}" target="_blank" class="item-url">🔗 Ver no WikiSales</a>
        </div>
    </section>

    <section class="properties-section">
        <div class="container">
            <div class="nav-links">
                <a href="/">← Voltar ao início</a>
                <a href="/items">📋 Ver todos os itens</a>
            </div>
            
            <div class="properties-title">📋 Propriedades ({len(item_data.get("properties", []))})</div>
            
            {props_html if props_html else '<div class="no-props">Este item não possui propriedades registradas</div>'}
        </div>
    </section>

    <footer class="footer">
        <div class="container">
            <div class="footer-grid">
                <div class="footer-brand">
                    <div class="brand"><span class="dot"></span> WikiSales</div>
                    <p>Infraestrutura de Conhecimento para Vendas B2B. Dados estruturados e ontologia para operações comerciais.</p>
                </div>
                <div class="footer-col">
                    <h5>Navegação</h5>
                    <ul>
                        <li><a href="/">Início</a></li>
                        <li><a href="/items">Itens</a></li>
                        <li><a href="https://wikisales.wikibase.cloud" target="_blank">WikiSales</a></li>
                    </ul>
                </div>
                <div class="footer-col">
                    <h5>Recursos</h5>
                    <ul>
                        <li><a href="https://wikisales.wikibase.cloud/wiki/Special:EntityData" target="_blank">API</a></li>
                        <li><a href="https://wikisales.wikibase.cloud/query/sparql" target="_blank">SPARQL</a></li>
                        <li><a href="https://github.com" target="_blank">GitHub</a></li>
                    </ul>
                </div>
            </div>
            <div class="footer-bottom">
                <span>© {datetime.now().year} WikiSales. Dados abertos e estruturados.</span>
                <span>Construído com Schema.org, Wikidata e GitHub.</span>
            </div>
        </div>
    </footer>
</body>
</html>
'''

def generate_index_html(items: List[Dict]) -> str:
    """Gera página inicial com lista de itens"""
    items_html = ""
    for item in items:
        items_html += f'''
        <div class="item-card" onclick="window.location.href='/item/{item.get("id").lower()}'" style="cursor:pointer;">
            <div class="item-header">
                <div>
                    <span class="item-id">{item.get("id")}</span>
                    <h3 class="item-title">{item.get("label") or item.get("id")}</h3>
                    {f'<p class="item-desc">{item.get("description")}</p>' if item.get("description") else ''}
                </div>
                <span style="color:var(--color-accent);font-size:0.9rem;">{len(item.get("properties", []))} propriedades →</span>
            </div>
        </div>
        '''
    
    return f'''<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>WikiSales - Itens</title>
    <meta name="description" content="Lista de itens disponíveis no WikiSales com propriedades e descrições." />
    <link rel="canonical" href="https://wikivendas.com.br/items" />
    <style>
        :root {{
            --color-bg: #0a0a0a;
            --color-surface: #111111;
            --color-surface-light: #1a1a1a;
            --color-border: #2a2a2a;
            --color-text: #e8e8e8;
            --color-text-secondary: #a0a0a0;
            --color-text-muted: #6a6a6a;
            --color-accent: #2d7aff;
            --color-accent-glow: rgba(45, 122, 255, 0.12);
            --font-family: 'Inter', -apple-system, sans-serif;
            --max-width: 1200px;
            --spacing-sm: 0.5rem;
            --spacing-md: 1rem;
            --spacing-lg: 2rem;
            --spacing-xl: 3rem;
        }}
        
        * {{ margin: 0; padding: 0; box-sizing: border-box; }}
        
        body {{
            font-family: var(--font-family);
            background-color: var(--color-bg);
            color: var(--color-text);
            line-height: 1.6;
        }}
        
        .container {{
            max-width: var(--max-width);
            margin: 0 auto;
            padding: 0 var(--spacing-lg);
        }}
        
        .navbar {{
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            z-index: 1000;
            background: rgba(10, 10, 10, 0.95);
            backdrop-filter: blur(16px);
            border-bottom: 1px solid var(--color-border);
            padding: 0.6rem 0;
        }}
        
        .navbar .container {{
            display: flex;
            align-items: center;
            justify-content: space-between;
        }}
        
        .navbar-brand {{
            display: flex;
            align-items: center;
            gap: var(--spacing-sm);
            font-weight: 700;
            font-size: 1.25rem;
            color: var(--color-text);
            text-decoration: none;
        }}
        
        .navbar-brand .logo-dot {{
            display: inline-block;
            width: 10px;
            height: 10px;
            background: var(--color-accent);
            border-radius: 50%;
            box-shadow: 0 0 20px var(--color-accent-glow);
        }}
        
        .navbar-links {{
            display: flex;
            align-items: center;
            gap: var(--spacing-lg);
            list-style: none;
        }}
        
        .navbar-links a {{
            color: var(--color-text-secondary);
            font-size: 0.875rem;
            text-decoration: none;
            transition: color 0.25s ease;
        }}
        
        .navbar-links a:hover {{
            color: var(--color-text);
        }}
        
        .hero {{
            padding: 120px 0 var(--spacing-xl);
            margin-top: 56px;
            border-bottom: 1px solid var(--color-border);
            background: radial-gradient(ellipse at 30% 20%, var(--color-accent-glow), transparent 70%);
        }}
        
        .hero h1 {{
            font-size: 2.5rem;
            margin-bottom: var(--spacing-sm);
        }}
        
        .hero .badge {{
            display: inline-block;
            font-family: 'JetBrains Mono', monospace;
            font-size: 0.875rem;
            color: var(--color-accent);
            background: var(--color-surface);
            border: 1px solid var(--color-border);
            padding: 0.25rem 0.75rem;
            border-radius: 100px;
            margin-bottom: var(--spacing-md);
        }}
        
        .hero p {{
            color: var(--color-text-secondary);
            font-size: 1.1rem;
            max-width: 600px;
        }}
        
        .items-grid {{
            padding: var(--spacing-xl) 0;
        }}
        
        .item-card {{
            background: var(--color-surface);
            border-radius: 12px;
            padding: var(--spacing-lg);
            margin-bottom: var(--spacing-md);
            border: 1px solid var(--color-border);
            transition: border-color 0.25s ease, transform 0.25s ease;
        }}
        
        .item-card:hover {{
            border-color: var(--color-accent);
            transform: translateX(5px);
        }}
        
        .item-header {{
            display: flex;
            justify-content: space-between;
            align-items: start;
            flex-wrap: wrap;
        }}
        
        .item-id {{
            color: var(--color-accent);
            font-weight: 700;
            font-size: 0.9rem;
            background: var(--color-accent-glow);
            padding: 2px 12px;
            border-radius: 12px;
            display: inline-block;
        }}
        
        .item-title {{
            font-size: 1.3rem;
            margin: 4px 0;
            color: var(--color-text);
        }}
        
        .item-desc {{
            color: var(--color-text-secondary);
            font-size: 0.95rem;
            margin-top: 4px;
        }}
        
        .footer {{
            padding: var(--spacing-xl) 0 var(--spacing-lg);
            border-top: 1px solid var(--color-border);
            margin-top: var(--spacing-xl);
        }}
        
        .footer-grid {{
            display: grid;
            grid-template-columns: 2fr 1fr 1fr;
            gap: var(--spacing-xl);
        }}
        
        .footer-brand .brand {{
            font-weight: 700;
            font-size: 1.25rem;
            display: flex;
            align-items: center;
            gap: var(--spacing-sm);
        }}
        
        .footer-brand .brand .dot {{
            display: inline-block;
            width: 8px;
            height: 8px;
            background: var(--color-accent);
            border-radius: 50%;
        }}
        
        .footer-brand p {{
            color: var(--color-text-secondary);
            font-size: 0.875rem;
            max-width: 320px;
        }}
        
        .footer-col h5 {{
            font-size: 0.875rem;
            text-transform: uppercase;
            letter-spacing: 0.06em;
            color: var(--color-text-muted);
            margin-bottom: var(--spacing-sm);
        }}
        
        .footer-col ul {{
            list-style: none;
        }}
        
        .footer-col li {{
            margin-bottom: var(--spacing-sm);
        }}
        
        .footer-col a {{
            color: var(--color-text-secondary);
            font-size: 0.875rem;
            text-decoration: none;
        }}
        
        .footer-col a:hover {{
            color: var(--color-text);
        }}
        
        .footer-bottom {{
            border-top: 1px solid var(--color-border);
            margin-top: var(--spacing-lg);
            padding-top: var(--spacing-md);
            display: flex;
            justify-content: space-between;
            flex-wrap: wrap;
            gap: var(--spacing-md);
            font-size: 0.875rem;
            color: var(--color-text-muted);
        }}
        
        .stats {{
            display: flex;
            gap: var(--spacing-lg);
            margin: var(--spacing-lg) 0;
            flex-wrap: wrap;
        }}
        
        .stats .stat {{
            color: var(--color-text-secondary);
            font-size: 0.95rem;
        }}
        
        .stats .stat strong {{
            color: var(--color-accent);
            font-size: 1.2rem;
        }}
        
        @media (max-width: 768px) {{
            .hero h1 {{ font-size: 1.8rem; }}
            .footer-grid {{ grid-template-columns: 1fr; gap: var(--spacing-lg); }}
            .navbar-links {{ display: none; }}
            .stats {{ flex-direction: column; gap: var(--spacing-sm); }}
        }}
    </style>
</head>
<body>
    <nav class="navbar">
        <div class="container">
            <a href="/" class="navbar-brand">
                <span class="logo-dot"></span> WikiSales
            </a>
            <ul class="navbar-links">
                <li><a href="/">Início</a></li>
                <li><a href="/items">Itens</a></li>
                <li><a href="https://wikisales.wikibase.cloud" target="_blank">WikiSales</a></li>
            </ul>
        </div>
    </nav>

    <section class="hero">
        <div class="container">
            <div class="badge">📋 Lista de Itens</div>
            <h1>Itens do WikiSales</h1>
            <p>Todos os itens disponíveis com suas propriedades e descrições.</p>
            <div class="stats">
                <div class="stat"><strong>{len(items)}</strong> itens encontrados</div>
            </div>
        </div>
    </section>

    <section class="items-grid">
        <div class="container">
            {items_html}
        </div>
    </section>

    <footer class="footer">
        <div class="container">
            <div class="footer-grid">
                <div class="footer-brand">
                    <div class="brand"><span class="dot"></span> WikiSales</div>
                    <p>Infraestrutura de Conhecimento para Vendas B2B. Dados estruturados e ontologia para operações comerciais.</p>
                </div>
                <div class="footer-col">
                    <h5>Navegação</h5>
                    <ul>
                        <li><a href="/">Início</a></li>
                        <li><a href="/items">Itens</a></li>
                        <li><a href="https://wikisales.wikibase.cloud" target="_blank">WikiSales</a></li>
                    </ul>
                </div>
                <div class="footer-col">
                    <h5>Recursos</h5>
                    <ul>
                        <li><a href="https://wikisales.wikibase.cloud/wiki/Special:EntityData" target="_blank">API</a></li>
                        <li><a href="https://wikisales.wikibase.cloud/query/sparql" target="_blank">SPARQL</a></li>
                        <li><a href="https://github.com" target="_blank">GitHub</a></li>
                    </ul>
                </div>
            </div>
            <div class="footer-bottom">
                <span>© {datetime.now().year} WikiSales. Dados abertos e estruturados.</span>
                <span>Construído com Schema.org, Wikidata e GitHub.</span>
            </div>
        </div>
    </footer>
</body>
</html>
'''

def build_site(limit: int = 50):
    """Constrói o site estático completo"""
    logger.info("🚀 Iniciando build do site estático...")
    
    # Cria diretórios
    output_path = Path(OUTPUT_DIR)
    items_path = output_path / "item"
    output_path.mkdir(exist_ok=True)
    items_path.mkdir(exist_ok=True)
    
    # Descobre itens
    qids = discover_items(limit)
    logger.info(f"📊 {len(qids)} itens encontrados")
    
    items_data = []
    
    # Gera página para cada item
    for qid in qids:
        logger.info(f"📄 Gerando página para {qid}...")
        item = get_item_with_properties(qid)
        if not item:
            logger.warning(f"⚠️  Falha ao processar {qid}")
            continue
        
        items_data.append(item)
        
        # Salva HTML
        html_content = generate_html(item)
        file_path = items_path / f"{qid.lower()}.html"
        with open(file_path, "w", encoding="utf-8") as f:
            f.write(html_content)
        
        # Salva JSON (para referência)
        json_path = items_path / f"{qid.lower()}.json"
        with open(json_path, "w", encoding="utf-8") as f:
            json.dump(item, f, ensure_ascii=False, indent=2)
    
    # Gera página inicial
    logger.info("🏠 Gerando página inicial...")
    index_html = generate_index_html(items_data)
    with open(output_path / "index.html", "w", encoding="utf-8") as f:
        f.write(index_html)
    
    # Gera página de itens (alias para index)
    with open(output_path / "items.html", "w", encoding="utf-8") as f:
        f.write(index_html)
    
    # Gera sitemap
    generate_sitemap(items_data)
    
    # Gera robots.txt
    with open(output_path / "robots.txt", "w", encoding="utf-8") as f:
        f.write("""User-agent: *
Allow: /
Sitemap: https://wikivendas.com.br/sitemap.xml
""")
    
    # Cria .nojekyll para GitHub Pages
    with open(output_path / ".nojekyll", "w") as f:
        f.write("")
    
    logger.info(f"✅ Build concluído! {len(items_data)} páginas geradas em '{OUTPUT_DIR}/'")
    return len(items_data)

def generate_sitemap(items: List[Dict]):
    """Gera sitemap.xml para SEO"""
    sitemap = '''<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
'''
    sitemap += f'''
  <url>
    <loc>https://wikivendas.com.br/</loc>
    <lastmod>{datetime.now().date().isoformat()}</lastmod>
    <priority>1.0</priority>
  </url>
  <url>
    <loc>https://wikivendas.com.br/items</loc>
    <lastmod>{datetime.now().date().isoformat()}</lastmod>
    <priority>0.9</priority>
  </url>
'''
    for item in items:
        sitemap += f'''
  <url>
    <loc>https://wikivendas.com.br/item/{item.get("id").lower()}</loc>
    <lastmod>{datetime.now().date().isoformat()}</lastmod>
    <priority>0.8</priority>
    <changefreq>monthly</changefreq>
  </url>
'''
    sitemap += '</urlset>'
    
    with open(Path(OUTPUT_DIR) / "sitemap.xml", "w", encoding="utf-8") as f:
        f.write(sitemap)
    
    logger.info("🗺️ Sitemap gerado")

if __name__ == "__main__":
    import sys
    
    limit = 50
    if len(sys.argv) > 1:
        try:
            limit = int(sys.argv[1])
        except ValueError:
            pass
    
    count = build_site(limit)
    logger.info(f"✨ Pronto! {count} páginas geradas.")
    logger.info("📂 Pasta 'docs' pronta para deploy no GitHub Pages")

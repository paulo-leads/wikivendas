# build_static.py

import json
import requests
from pathlib import Path
from datetime import datetime

# ============================================================
# CONFIGURAÇÃO
# ============================================================

# Lista de IDs que você quer gerar (adicione quantos quiser)
TERM_IDS = [
    "Q1",   # Paulo CP Santos
    "Q2",   # Protocolo Hidra
    # Adicione mais Qs aqui:
    # "Q3",
    # "Q4",
]

# URL da API da WikiSales
WIKISALES_API = "https://wikisales.wikibase.cloud/w/api.php"

# Pasta de saída (GitHub Pages)
OUTPUT_DIR = Path("docs")

# ============================================================
# FUNÇÕES
# ============================================================

def fetch_item(qid):
    """Busca um item da WikiSales via API"""
    
    params = {
        "action": "wbgetentities",
        "ids": qid,
        "format": "json",
        "props": "claims|labels|descriptions|aliases|url"
    }
    
    response = requests.get(WIKISALES_API, params=params)
    response.raise_for_status()
    data = response.json()
    
    if "entities" not in data or qid not in data["entities"]:
        raise ValueError(f"Item {qid} não encontrado")
    
    entity = data["entities"][qid]
    
    # Converte para nosso formato
    return {
        "id": qid,
        "label": entity.get("labels", {}).get("pt", {}).get("value", qid),
        "description": entity.get("descriptions", {}).get("pt", {}).get("value", ""),
        "aliases": [a.get("value") for a in entity.get("aliases", {}).get("pt", [])],
        "url": entity.get("url", ""),
        "properties": extract_properties(entity.get("claims", {}))
    }

def extract_properties(claims):
    """Extrai propriedades do formato WikiSales"""
    
    props = []
    
    # Mapeamento de IDs de propriedade para nomes
    prop_labels = {
        "P1": "entidade controladora ou pai",
        "P2": "criador ou autoridade originária",
        "P7": "descrito na URL",
        "P10": "exclusão de escopo literal",
        "P11": "escopo positivo literal",
        "P12": "página wiki associada",
        "P13": "Estudo de Caso",
        "P14": "Função estratégica",
        "P15": "URN canônica",
    }
    
    prop_descriptions = {
        "P1": "indica a organização controladora, holding, ou entidade conceitual superior no ecossistema B2B/RevOps.",
        "P2": "indica o profissional, pesquisador ou empresa responsável por conceber o método, termo ou ativo de inteligência comercial.",
        "P7": "link oficial externo onde o item, conceito ou documento é detalhado publicamente.",
        "P10": "Atributo textual que define o escopo negativo (O que NÃO é) do conceito, prevenindo alucinações e falsas associações lógicas por agentes de IA.",
        "P11": "Atributo textual que define as características canônicas diretas (O que É) do conceito, garantindo o determinismo lógico para agentes de IA.",
        "P12": "URL da página canônica que documenta este conceito na WikiSales.",
        "P13": "URL de estudo de caso ou evidência prática relacionada ao conceito.",
        "P14": "A DKI existe para impedir que conceitos proprietários fiquem soltos, genéricos ou confundidos com o ruído do mercado.",
        "P15": "Identificador persistente do item em formato URN, usado para nomear a entidade de forma estável e independente de URL, domínio ou localização física.",
    }
    
    for prop_id, claim_list in claims.items():
        if prop_id not in prop_labels:
            continue
            
        prop = {
            "id": prop_id,
            "label": prop_labels.get(prop_id, prop_id),
            "description": prop_descriptions.get(prop_id, ""),
            "datatype": "wikibase-item" if prop_id in ["P1", "P2"] else "url" if prop_id in ["P7", "P12", "P13"] else "string",
            "values": [],
            "count": len(claim_list),
            "url": f"https://wikisales.wikibase.cloud/wiki/Property:{prop_id}"
        }
        
        for claim in claim_list:
            mainsnak = claim.get("mainsnak", {})
            datavalue = mainsnak.get("datavalue", {})
            
            if "value" in datavalue:
                value = datavalue["value"]
                if prop_id in ["P1", "P2"]:
                    # É um item (Q2, Q3, etc.)
                    prop["values"].append({
                        "type": "item",
                        "id": value.get("id", ""),
                        "label": value.get("id", ""),  # Vai ser resolvido depois
                        "value": value.get("id", "")
                    })
                elif prop_id in ["P7", "P12", "P13"]:
                    # É uma URL
                    prop["values"].append({
                        "type": "text",
                        "value": value
                    })
                else:
                    # É texto
                    prop["values"].append({
                        "type": "text",
                        "value": value
                    })
        
        if prop["values"]:
            props.append(prop)
    
    return props

def generate_slug(label):
    """Gera um slug a partir do label"""
    slug = label.lower()
    slug = slug.replace(" ", "-")
    slug = slug.replace(".", "")
    slug = slug.replace("á", "a").replace("ã", "a").replace("é", "e").replace("í", "i")
    slug = slug.replace("ó", "o").replace("ú", "u").replace("ç", "c")
    # Remove caracteres especiais
    import re
    slug = re.sub(r'[^a-z0-9-]', '', slug)
    return slug

def generate_html(item_data):
    """Gera o HTML completo para um termo"""
    
    label = item_data["label"]
    description = item_data["description"]
    aliases = item_data["aliases"]
    props = item_data["properties"]
    
    # Gera os slugs
    slug = generate_slug(label)
    
    # Constrói o HTML
    html = f'''<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Wikivendas — {label}</title>
    <meta name="description" content="{description[:160]}" />
    
    <!-- JSON-LD -->
    <script type="application/ld+json">
    {json.dumps({
        "@context": "https://schema.org",
        "@type": "Thing",
        "name": label,
        "description": description,
        "url": f"https://wikivendas.com.br/{slug}",
        "sameAs": [v["value"] for p in props if p["id"] == "P7" for v in p["values"]]
    }, indent=2, ensure_ascii=False)}
    </script>
    
    <style>
        /* ===== ESTILO WIKIVENDAS ===== */
        * {{ margin: 0; padding: 0; box-sizing: border-box; }}
        
        body {{
            background: #0a0a0a;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            padding: 40px 20px;
            color: #e8e8e8;
            min-height: 100vh;
        }}
        
        .container {{
            max-width: 900px;
            margin: 0 auto;
            width: 100%;
        }}
        
        .wikivendas-header {{
            background: #111;
            border: 1px solid #2a2a2a;
            border-radius: 12px 12px 0 0;
            padding: 20px 30px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            flex-wrap: wrap;
            gap: 10px;
            border-bottom: none;
        }}
        
        .wikivendas-header .logo {{
            display: flex;
            align-items: center;
            gap: 10px;
            font-weight: 700;
            font-size: 1.2rem;
            color: #e8e8e8;
            text-decoration: none;
        }}
        
        .wikivendas-header .logo .dot {{
            display: inline-block;
            width: 10px;
            height: 10px;
            background: #2d7aff;
            border-radius: 50%;
            box-shadow: 0 0 20px rgba(45, 122, 255, 0.3);
        }}
        
        .wikivendas-header .nav-links {{
            display: flex;
            gap: 20px;
            font-size: 0.85rem;
        }}
        
        .wikivendas-header .nav-links a {{
            color: #888;
            text-decoration: none;
            transition: color 0.2s;
        }}
        
        .wikivendas-header .nav-links a:hover {{
            color: #e8e8e8;
        }}
        
        .wikivendas-header .nav-links a.active {{
            color: #2d7aff;
        }}
        
        .markdown-body {{
            background: #111;
            color: #e8e8e8;
            padding: 40px 48px;
            border: 1px solid #2a2a2a;
            border-top: none;
            border-radius: 0 0 12px 12px;
        }}
        
        .markdown-body h1 {{
            font-size: 2.2rem;
            margin-bottom: 16px;
            border-bottom: 1px solid #2a2a2a;
            padding-bottom: 12px;
        }}
        
        .markdown-body h2 {{
            font-size: 1.6rem;
            margin-top: 30px;
            margin-bottom: 12px;
            border-bottom: 1px solid #2a2a2a;
            padding-bottom: 8px;
        }}
        
        .markdown-body h3 {{
            font-size: 1.2rem;
            margin-top: 24px;
            margin-bottom: 8px;
            color: #2d7aff;
        }}
        
        .markdown-body p {{
            margin-bottom: 12px;
            color: #c8c8c8;
            line-height: 1.7;
        }}
        
        .markdown-body a {{
            color: #2d7aff;
            text-decoration: none;
        }}
        
        .markdown-body a:hover {{
            text-decoration: underline;
        }}
        
        .markdown-body ul, .markdown-body ol {{
            padding-left: 24px;
            margin-bottom: 16px;
        }}
        
        .markdown-body li {{
            margin-bottom: 6px;
            color: #c8c8c8;
        }}
        
        .markdown-body code {{
            background: #1a1a1a;
            border: 1px solid #2a2a2a;
            padding: 0.2rem 0.4rem;
            border-radius: 4px;
            font-size: 0.85rem;
        }}
        
        .markdown-body pre {{
            background: #1a1a1a;
            border: 1px solid #2a2a2a;
            border-radius: 8px;
            padding: 16px;
            overflow-x: auto;
        }}
        
        .markdown-body .badge {{
            display: inline-block;
            font-size: 0.7rem;
            color: #2d7aff;
            background: #0a0a0a;
            border: 1px solid #2a2a2a;
            padding: 0.2rem 0.7rem;
            border-radius: 100px;
            margin-bottom: 20px;
        }}
        
        .markdown-body .badge a {{
            color: #2d7aff;
            text-decoration: none;
        }}
        
        .markdown-body hr {{
            border: none;
            border-top: 1px solid #2a2a2a;
            margin: 30px 0;
        }}
        
        .wikivendas-footer {{
            margin-top: 20px;
            text-align: center;
            font-size: 0.8rem;
            color: #555;
        }}
        
        .wikivendas-footer a {{
            color: #2d7aff;
            text-decoration: none;
        }}
        
        .wikivendas-footer a:hover {{
            text-decoration: underline;
        }}
        
        @media (max-width: 768px) {{
            .wikivendas-header {{
                flex-direction: column;
                align-items: flex-start;
                padding: 15px 20px;
            }}
            .markdown-body {{
                padding: 20px;
            }}
            .markdown-body h1 {{
                font-size: 1.8rem;
            }}
        }}
    </style>
</head>
<body>
    <div class="container">
        <!-- HEADER -->
        <header class="wikivendas-header">
            <a href="/" class="logo">
                <span class="dot"></span>
                Wikivendas
            </a>
            <nav class="nav-links">
                <a href="/">Início</a>
                <a href="/glossario">Glossário</a>
                <a href="https://github.com/paulo-leads" target="_blank">GitHub</a>
            </nav>
        </header>
        
        <!-- CONTEÚDO -->
        <div class="markdown-body">
            <div class="badge">
                📖 <a href="/">Wikivendas</a> / <a href="/glossario">Glossário</a>
            </div>
            
            <h1>{label}</h1>
            
            <p>{description}</p>
            
            <h2>📌 Identificadores</h2>
            <ul>
                <li><strong>ID:</strong> {item_data["id"]}</li>
                <li><strong>Slug:</strong> {slug}</li>
                <li><strong>URL:</strong> <a href="{item_data["url"]}" target="_blank">{item_data["url"]}</a></li>
            </ul>
            
            <h2>🏷️ Aliases</h2>
            <ul>
                {''.join(f'<li>{alias}</li>' for alias in aliases[:10])}
            </ul>
            
            <h2>📖 Propriedades</h2>
            {generate_properties_html(props)}
            
            <hr />
            
            <p style="text-align:center;color:#666;font-size:0.85rem;">
                <em>Esta página é gerada automaticamente a partir da ontologia Wikivendas.<br />
                <a href="https://wikisales.wikibase.cloud/wiki/Item:{item_data["id"]}" target="_blank">Ver na WikiSales</a></em>
            </p>
        </div>
        
        <!-- FOOTER -->
        <footer class="wikivendas-footer">
            <p>
                <a href="/">Wikivendas</a> — Domain Knowledge Infrastructure &bull;
                <a href="https://doi.org/10.5281/zenodo.21272104" target="_blank">DOI: 10.5281/zenodo.21272104</a>
            </p>
        </footer>
    </div>
</body>
</html>
'''
    
    return html

def generate_properties_html(props):
    """Gera o HTML das propriedades"""
    
    html = ""
    for prop in props:
        prop_label = prop.get("label", "")
        prop_desc = prop.get("description", "")
        
        html += f"<h3>{prop_label}</h3>\n"
        html += f"<p>{prop_desc}</p>\n"
        
        if prop["values"]:
            html += "<ul>\n"
            for val in prop["values"]:
                if val.get("type") == "item":
                    item_id = val.get("id", "")
                    html += f'<li><a href="/{item_id.lower()}">{item_id}</a></li>\n'
                else:
                    value = val.get("value", "")
                    if value.startswith("http"):
                        html += f'<li><a href="{value}" target="_blank">{value}</a></li>\n'
                    else:
                        html += f"<li>{value}</li>\n"
            html += "</ul>\n"
        
        html += "\n"
    
    return html

def build_all_pages():
    """Gera todas as páginas"""
    
    # Cria a pasta docs
    OUTPUT_DIR.mkdir(exist_ok=True)
    
    print("🚀 Iniciando build das páginas...")
    print(f"📁 Gerando {len(TERM_IDS)} termos\n")
    
    for qid in TERM_IDS:
        try:
            print(f"📥 Buscando {qid}...")
            item_data = fetch_item(qid)
            
            # Gera o slug
            slug = generate_slug(item_data["label"])
            
            # Gera o HTML
            html = generate_html(item_data)
            
            # Salva como /docs/{slug}/index.html
            page_dir = OUTPUT_DIR / slug
            page_dir.mkdir(exist_ok=True)
            
            with open(page_dir / "index.html", "w", encoding="utf-8") as f:
                f.write(html)
            
            print(f"✅ {slug}/index.html gerado")
            
        except Exception as e:
            print(f"❌ Erro ao processar {qid}: {e}")
    
    print("\n🎉 Build concluído!")

# ============================================================
# EXECUTA
# ============================================================

if __name__ == "__main__":
    build_all_pages()

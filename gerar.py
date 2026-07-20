#!/usr/bin/env python3
"""
gerar.py — WikiVendas Sitemap & Knowledge Graph Generator
==========================================================
Gera sitemap.xml e graph.json automaticamente varrendo os HTMLs do repositório.

Uso:
    python scripts/gerar.py                    # usa diretório atual como raiz
    python scripts/gerar.py --repo-dir /caminho/wikivendas  # caminho customizado

Executa localmente ou via GitHub Actions (workflow incluso).
"""

import argparse
import hashlib
import os
import re
import sys
from datetime import date, datetime
from xml.etree.ElementTree import Element, SubElement, tostring
from xml.dom import minidom

# ── Config ────────────────────────────────────────────────────────────
BASE_URL = "https://wikivendas.com.br"
DOMAIN = "wikivendas.com.br"
TODAY = date.today().isoformat()

# Prioridades por padrão de caminho (regex -> priority, changefreq)
PRIORITY_RULES = [
    (r"^index\.html$",                              1.0, "weekly"),
    (r"^sobre/index\.html$",                        0.9, "monthly"),
    (r"^termos/(intencionar|mio)/index\.html$",     0.9, "monthly"),
    (r"^termos/[^/]+/index\.html$",                 0.8, "monthly"),
    (r"^sobre/.+/index\.html$",                     0.7, "monthly"),
    (r"^mio\.html$",                                0.8, "monthly"),
    (r"^nova-olaria\.html$",                        0.7, "monthly"),
    (r".+\.html$",                                  0.6, "monthly"),
]

# Relações semânticas manuais (origem -> [destinos])
KNOWN_RELATIONS = {
    "":                    ["sobre/", "termos/", "mio.html", "nova-olaria.html"],
    "sobre/":              ["sobre/o-que-a-wikivendas-nao-e/"],
    "sobre/o-que-a-wikivendas-nao-e/": [],
    "termos/":             [
        "termos/compra-de-leads-qualificados/",
        "termos/fornecedor-de-leads/",
        "termos/generative-lead-spoofing/",
        "termos/intencionar/",
        "termos/lead-b2b/",
        "termos/mio/",
    ],
    "termos/intencionar/": ["termos/mio/"],
    "termos/mio/":         ["termos/intencionar/"],
    "termos/compra-de-leads-qualificados/": ["termos/fornecedor-de-leads/", "termos/lead-b2b/"],
    "termos/fornecedor-de-leads/": ["termos/compra-de-leads-qualificados/"],
    "termos/lead-b2b/":    ["termos/compra-de-leads-qualificados/"],
    "termos/generative-lead-spoofing/": [],
    "mio.html":            ["termos/mio/", "termos/intencionar/"],
    "nova-olaria.html":    [],
}

# DOIs conhecidas
KNOWN_DOIS = {
    "termos/intencionar/": "https://doi.org/10.5281/zenodo.20860586",
    "sobre/":              "https://doi.org/10.5281/zenodo.21272104",
}

# Wikibase IDs
KNOWN_WIKIBASE = {
    "termos/intencionar/": "Q21",
    "termos/mio/":         "Q92",
    "mio.html":            "Q92",
}

SAME_AS = {
    "termos/intencionar/": "https://doi.org/10.5281/zenodo.20860586",
    "termos/mio/":         "https://wikivendas.wikibase.cloud/entity/Q92",
    "mio.html":            "https://wikivendas.wikibase.cloud/entity/Q92",
    "sobre/":              "https://doi.org/10.5281/zenodo.21272104",
}


# ── Parsers ───────────────────────────────────────────────────────────

def extract_title(html: str) -> str:
    """Extrai o <title> de um HTML."""
    m = re.search(r"<title[^>]*>([^<]+)</title>", html, re.IGNORECASE | re.DOTALL)
    return m.group(1).strip() if m else ""


def extract_description(html: str) -> str:
    """Extrai meta description."""
    m = re.search(
        r'<meta\s+name=["\']description["\']\s+content=["\']([^"\']+)["\']',
        html, re.IGNORECASE,
    )
    if not m:
        m = re.search(
            r'<meta\s+content=["\']([^"\']+)["\']\s+name=["\']description["\']',
            html, re.IGNORECASE,
        )
    return m.group(1).strip() if m else ""


def find_html_files(repo_dir: str):
    """Varre o diretório e retorna lista de caminhos relativos de arquivos HTML."""
    htmls = []
    repo_dir = os.path.abspath(repo_dir)
    for root, dirs, files in os.walk(repo_dir):
        # Pula diretórios ocultos e scripts
        dirs[:] = [d for d in dirs if not d.startswith(".") and d not in ("scripts", "node_modules", "__pycache__")]
        for f in files:
            if f.endswith(".html"):
                full = os.path.join(root, f)
                rel = os.path.relpath(full, repo_dir)
                htmls.append(rel)
    return sorted(htmls)


def classify(rel_path: str):
    """Retorna (priority, changefreq) para um caminho relativo."""
    for pattern, prio, freq in PRIORITY_RULES:
        if re.match(pattern, rel_path):
            return prio, freq
    return 0.5, "monthly"


def url_path(rel_path: str) -> str:
    """Converte caminho relativo para URL amigável."""
    if rel_path == "index.html":
        return ""
    if rel_path.endswith("/index.html"):
        return rel_path[:-10]  # remove 'index.html'
    return rel_path


def page_id(rel_path: str) -> str:
    """Gera ID canônico para o grafo."""
    up = url_path(rel_path)
    return f"wikivendas:{up.replace('/', '-').strip('-') or 'root'}"


# ── Sitemap Generator ─────────────────────────────────────────────────

def generate_sitemap(pages: list) -> str:
    """Gera sitemap.xml como string formatada."""
    xmlns = "http://www.sitemaps.org/schemas/sitemap/0.9"

    urlset = Element("urlset", xmlns=xmlns)

    for rel_path, title, desc, priority, changefreq in sorted(pages, key=lambda p: -p[3]):
        loc = f"{BASE_URL}/{url_path(rel_path)}"

        url = SubElement(urlset, "url")
        loc_el = SubElement(url, "loc")
        loc_el.text = loc

        lastmod = SubElement(url, "lastmod")
        lastmod.text = TODAY

        cf = SubElement(url, "changefreq")
        cf.text = changefreq

        pr = SubElement(url, "priority")
        pr.text = f"{priority:.1f}"

    raw = tostring(urlset, encoding="unicode")
    dom = minidom.parseString(raw.encode())
    return dom.toprettyxml(indent="  ")


# ── Graph Generator ───────────────────────────────────────────────────

def generate_graph(pages: list) -> str:
    """Gera graph.json (JSON-LD) do grafo de conhecimento."""
    graph = []

    for rel_path, title, desc, priority, changefreq in pages:
        pid = page_id(rel_path)
        up = url_path(rel_path)
        url = f"{BASE_URL}/{up}"
        is_root = up == ""

        # Determina o tipo Schema.org
        if "sobre" in rel_path:
            stype = "schema:AboutPage"
        elif up.startswith("termos/"):
            stype = "schema:DefinedTerm"
        else:
            stype = "schema:WebPage"

        node = {
            "id": pid,
            "type": stype,
            "name": title or "WikiVendas",
            "description": desc or title or "WikiVendas — Domain Knowledge Infrastructure",
            "url": url,
            "priority": priority,
        }

        # Hierarquia
        if is_root:
            pass  # root não tem isPartOf
        elif up.startswith("termos/"):
            node["isPartOf"] = "wikivendas:glossario"
        elif up.startswith("sobre/"):
            if rel_path == "sobre/index.html":
                node["isPartOf"] = "wikivendas:root"
            else:
                node["isPartOf"] = "wikivendas:sobre"
        else:
            node["isPartOf"] = "wikivendas:root"

        # Relações
        rel_key = up + "/" if up and not up.endswith("/") else up
        if not rel_key:
            rel_key = ""  # root

        children = KNOWN_RELATIONS.get(rel_key, [])
        if children:
            child_ids = [page_id(c + "index.html") if c.endswith("/") else page_id(c) for c in children]
            node["hasPart"] = child_ids

        # DOIs
        doi = KNOWN_DOIS.get(rel_key)
        if doi:
            node["sameAs"] = doi

        # Wikibase
        wb = KNOWN_WIKIBASE.get(rel_key)
        if wb:
            node["wikibaseId"] = wb

        # sameAs
        sa = SAME_AS.get(rel_key)
        if sa and sa != doi:
            existing = node.get("sameAs", [])
            if isinstance(existing, str):
                existing = [existing]
            if sa not in existing:
                existing.append(sa)
            node["sameAs"] = existing if len(existing) > 1 else existing[0]

        graph.append(node)

    # Glossário (coleção)
    glossary_terms = [n for n in graph if n.get("isPartOf") == "wikivendas:glossario"]
    glossary = {
        "id": "wikivendas:glossario",
        "type": "schema:CollectionPage",
        "name": "Glossário de Termos WikiVendas",
        "description": "Registro canônico de termos do domínio de vendas B2B, leads qualificados e ontologia comercial.",
        "url": f"{BASE_URL}/termos/",
        "isPartOf": "wikivendas:root",
        "priority": 0.9,
        "hasPart": [n["id"] for n in glossary_terms],
    }
    graph.append(glossary)

    # Sobre (pai)
    about_pages = [n for n in graph if n.get("isPartOf") == "wikivendas:sobre"]
    about = {
        "id": "wikivendas:sobre",
        "type": "schema:AboutPage",
        "name": "Sobre a WikiVendas",
        "description": "Propósito, hipótese de trabalho, perguntas de pesquisa e arquitetura experimental do projeto WikiVendas.",
        "url": f"{BASE_URL}/sobre/",
        "isPartOf": "wikivendas:root",
        "priority": 0.9,
        "hasPart": [n["id"] for n in about_pages],
        "sameAs": KNOWN_DOIS.get("sobre/", ""),
    }
    graph.append(about)

    # Root
    children_root = [n["id"] for n in graph if n.get("isPartOf") == "wikivendas:root"]
    root = {
        "id": "wikivendas:root",
        "type": "schema:WebPage",
        "name": "WikiVendas — Infraestrutura de Conhecimento de Domínio",
        "description": "Infraestrutura de Conhecimento de Domínio para vendas B2B e mercados de alto ticket.",
        "url": BASE_URL + "/",
        "priority": 1.0,
        "hasPart": children_root,
    }
    graph.append(root)

    # Monta JSON-LD final
    import json
    output = {
        "@context": {
            "@version": 1.1,
            "dct": "http://purl.org/dc/terms/",
            "schema": "https://schema.org/",
            "wikivendas": f"{BASE_URL}/",
            "name": "schema:name",
            "description": "schema:description",
            "about": "schema:about",
            "isPartOf": "dct:isPartOf",
            "hasPart": "dct:hasPart",
            "references": "dct:references",
            "isReferencedBy": "dct:isReferencedBy",
            "relation": "dct:relation",
            "type": "@type",
            "id": "@id",
        },
        "@graph": graph,
        "totalPages": len(pages),
        "totalNodes": len(graph),
        "generated": TODAY,
        "domain": DOMAIN,
        "description": f"Grafo completo do WikiVendas. {len(pages)} páginas, {len(graph)} nós, relacionamentos semânticos entre todas as entidades.",
    }

    return json.dumps(output, indent=2, ensure_ascii=False)


# ── Main ──────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Gera sitemap.xml e graph.json para WikiVendas")
    parser.add_argument("--repo-dir", default=".", help="Diretório raiz do repositório (default: .)")
    parser.add_argument("--output-dir", default=".", help="Diretório de saída (default: repo-dir)")
    args = parser.parse_args()

    repo_dir = os.path.abspath(args.repo_dir)
    output_dir = os.path.abspath(args.output_dir)

    if not os.path.isdir(repo_dir):
        print(f"❌ Diretório não encontrado: {repo_dir}")
        sys.exit(1)

    print(f"📁 Varrendo HTMLs em: {repo_dir}")
    html_files = find_html_files(repo_dir)
    print(f"   Encontrados {len(html_files)} arquivos HTML")

    # Extrai metadados de cada página
    pages = []
    for rel_path in html_files:
        full_path = os.path.join(repo_dir, rel_path)
        try:
            with open(full_path, "r", encoding="utf-8") as f:
                html = f.read()
        except Exception as e:
            print(f"   ⚠️  Erro ao ler {rel_path}: {e}")
            continue

        title = extract_title(html)
        desc = extract_description(html)
        priority, changefreq = classify(rel_path)
        pages.append((rel_path, title, desc, priority, changefreq))

    if not pages:
        print("❌ Nenhuma página HTML encontrada. Nada a gerar.")
        sys.exit(1)

    # ── Gera sitemap.xml ──
    os.makedirs(output_dir, exist_ok=True)
    sitemap_xml = generate_sitemap(pages)
    sitemap_path = os.path.join(output_dir, "sitemap.xml")
    with open(sitemap_path, "w", encoding="utf-8") as f:
        f.write(sitemap_xml)
    url_count = sitemap_xml.count("<url>")
    print(f"✅ sitemap.xml gerado: {sitemap_path} ({url_count} URLs)")

    # ── Gera graph.json ──
    graph_json = generate_graph(pages)
    graph_path = os.path.join(output_dir, "graph.json")
    with open(graph_path, "w", encoding="utf-8") as f:
        f.write(graph_json)
    node_count = len(json.loads(graph_json)["@graph"])
    print(f"✅ graph.json gerado: {graph_path} ({node_count} nós)")

    # ── Validação rápida ──
    import json as json_lib
    try:
        json_lib.loads(graph_json)
        print("   ✅ JSON-LD válido")
    except json_lib.JSONDecodeError as e:
        print(f"   ❌ JSON inválido: {e}")

    print("\n🎯 Pronto! Commit e push para publicar.")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""
gerar.py — WikiVendas Sitemap & Knowledge Graph Generator
==========================================================
Gera sitemap.xml e graph.json varrendo HTMLs e extraindo:
  - Título, descrição, prioridade (por padrão do caminho)
  - Relações internas (links para outras páginas do domínio)
  - DOIs, Wikibase IDs, URNs (detectados no HTML)

Uso:
    python scripts/gerar.py
    python scripts/gerar.py --repo-dir . --output-dir .
"""

import argparse
import json
import os
import re
import sys
from datetime import date
from urllib.parse import urlparse, urlunparse
from xml.dom import minidom
from xml.etree.ElementTree import Element, SubElement, tostring

# ── Config ────────────────────────────────────────────────────────────
BASE_URL = "https://wikivendas.com.br"
DOMAIN = "wikivendas.com.br"
TODAY = date.today().isoformat()

# Prioridades por regex no caminho relativo
PRIORITY_RULES = [
    (r"^index\.html$",                                          1.0, "weekly"),
    (r"^sobre/index\.html$",                                    0.9, "monthly"),
    (r"^termos/(intencionar|mio)/index\.html$",                 0.9, "monthly"),
    (r"^termos/[^/]+/index\.html$",                             0.8, "monthly"),
    (r"^sobre/.+/index\.html$",                                 0.7, "monthly"),
    (r"^mio\.html$",                                            0.8, "monthly"),
    (r"^nova-olaria\.html$",                                    0.7, "monthly"),
    (r".+\.html$",                                              0.6, "monthly"),
]


# ── Parsers de HTML ──────────────────────────────────────────────────

def extract_title(html: str) -> str:
    m = re.search(r"<title[^>]*>([^<]+)</title>", html, re.IGNORECASE | re.DOTALL)
    return m.group(1).strip() if m else ""


def extract_description(html: str) -> str:
    for pattern in [
        r'<meta\s+name=["\']description["\']\s+content=["\']([^"\']+)["\']',
        r'<meta\s+content=["\']([^"\']+)["\']\s+name=["\']description["\']',
    ]:
        m = re.search(pattern, html, re.IGNORECASE)
        if m:
            return m.group(1).strip()
    return ""


def extract_internal_links(html: str, current_rel_dir: str) -> set:
    """
    Extrai links internos (<a href="...">) que apontam para outras
    páginas do próprio domínio. Retorna CONJUNTO de caminhos relativos
    (ex: {'termos/intencionar/', 'sobre/'}).
    """
    links = set()
    # Pega todos os hrefs
    for m in re.finditer(r'href=["\']([^"\']+)["\']', html, re.IGNORECASE):
        href = m.group(1).strip()
        # Ignora âncoras, vazios, externos absolutos
        if not href or href.startswith("#") or href.startswith("mailto:") or href.startswith("tel:"):
            continue
        if href.startswith("http"):
            # Se for URL externa, ignora (não é link interno do site)
            if DOMAIN not in href and BASE_URL not in href:
                continue
            # Extrai o path da URL absoluta
            parsed = urlparse(href)
            href = parsed.path.lstrip("/")
        else:
            # Limpa âncora no final
            href = href.split("#")[0].rstrip("/")
            # Resolve relativo ao diretório da página atual
            if not href.startswith("/"):
                # Se não tem index.html no final, assume que é diretório
                if current_rel_dir:
                    href = current_rel_dir.rstrip("/") + "/" + href
            else:
                href = href.lstrip("/")

        # Normaliza: se termina sem .html e não termina em /, assume /
        if not href.endswith(".html") and not href.endswith("/"):
            href += "/"
        # Se termina com index.html, remove
        if href.endswith("/index.html"):
            href = href[:-10]  # remove 'index.html'
        if href.endswith(".html"):
            # arquivo .html solto na raiz
            pass
        elif href and not href.endswith("/"):
            href += "/"

        if href:
            links.add(href)

    return links


def extract_dois(html: str) -> list:
    """Extrai DOIs do HTML."""
    return re.findall(r'https://doi\.org/10\.\d{4,}/[^\s"\'<>]+', html)


def extract_wikibase_ids(html: str) -> list:
    """Extrai IDs Wikibase (Q números)."""
    return re.findall(r'\bQ\d{2,}\b', html)


def extract_urns(html: str) -> list:
    """Extrai URNs do padrão wikivendas."""
    return re.findall(r'urn:wikivendas:[^\s"\'<>]+', html)


# ── Scanner ──────────────────────────────────────────────────────────

def find_html_files(repo_dir: str):
    """Varre recursivamente ignorando diretórios ocultos e scripts."""
    htmls = []
    repo_dir = os.path.abspath(repo_dir)
    for root, dirs, files in os.walk(repo_dir):
        dirs[:] = [d for d in dirs if not d.startswith(".") and d not in ("scripts", "node_modules", "__pycache__")]
        for f in files:
            if f.endswith(".html"):
                full = os.path.join(root, f)
                rel = os.path.relpath(full, repo_dir)
                htmls.append(rel)
    return sorted(htmls)


def classify(rel_path: str):
    for pattern, prio, freq in PRIORITY_RULES:
        if re.match(pattern, rel_path):
            return prio, freq
    return 0.5, "monthly"


def rel_to_url_path(rel_path: str) -> str:
    """Converte 'termos/intencionar/index.html' -> 'termos/intencionar/'"""
    if rel_path == "index.html":
        return ""
    if rel_path.endswith("/index.html"):
        return rel_path[:-10]  # remove '/index.html'
    if rel_path.endswith(".html"):
        return rel_path
    return rel_path


def url_path_to_rel_dir(url_path: str) -> str:
    """Converte URL path para diretório relativo para resolução de links."""
    if not url_path:
        return ""
    if url_path.endswith(".html"):
        return "/".join(url_path.split("/")[:-1]) if "/" in url_path else ""
    return url_path


def page_id(url_path: str) -> str:
    """Gera ID canônico para o grafo."""
    clean = url_path.rstrip("/").replace("/", "-").replace(".html", "")
    return f"wikivendas:{clean or 'root'}"


# ── Sitemap Generator ─────────────────────────────────────────────────

def generate_sitemap(pages: list) -> str:
    xmlns = "http://www.sitemaps.org/schemas/sitemap/0.9"
    urlset = Element("urlset", xmlns=xmlns)

    for rel_path, meta in sorted(pages, key=lambda p: -p[1]["priority"]):
        loc = f"{BASE_URL}/{rel_to_url_path(rel_path)}"
        url = SubElement(urlset, "url")
        SubElement(url, "loc").text = loc
        SubElement(url, "lastmod").text = TODAY
        SubElement(url, "changefreq").text = meta["changefreq"]
        SubElement(url, "priority").text = f"{meta['priority']:.1f}"

    raw = tostring(urlset, encoding="unicode")
    dom = minidom.parseString(raw.encode())
    return dom.toprettyxml(indent="  ")


# ── Graph Generator ──────────────────────────────────────────────────

def generate_graph(pages: dict, rel_path_to_links: dict) -> str:
    """
    Gera JSON-LD do grafo de conhecimento.
    `pages`: dict[rel_path] -> meta dict
    `rel_path_to_links`: dict[rel_path] -> set de URL paths (destinos)
    """
    graph_nodes = []
    id_map = {}  # url_path -> node id

    # Primeiro, cria índice de url_path -> id
    for rel_path in pages:
        up = rel_to_url_path(rel_path)
        pid = page_id(up)
        id_map[up] = pid

    # Cria nós para cada página
    for rel_path, meta in pages.items():
        up = rel_to_url_path(rel_path)
        pid = page_id(up)
        url = f"{BASE_URL}/{up}"
        is_root = up == ""

        # Determina tipo Schema.org
        if "sobre" in rel_path:
            stype = "schema:AboutPage"
        elif up.startswith("termos/"):
            stype = "schema:DefinedTerm"
        else:
            stype = "schema:WebPage"

        node = {
            "@id": pid,
            "@type": stype,
            "name": meta["title"] or "WikiVendas",
            "description": meta["description"] or meta["title"] or "WikiVendas — Domain Knowledge Infrastructure",
            "url": url,
            "priority": meta["priority"],
        }

        # Hierarquia (isPartOf)
        if is_root:
            pass
        elif up.startswith("termos/"):
            node["isPartOf"] = {"@id": "wikivendas:glossario"}
        elif up.startswith("sobre/"):
            if rel_path == "sobre/index.html":
                node["isPartOf"] = {"@id": "wikivendas:root"}
            else:
                node["isPartOf"] = {"@id": "wikivendas:sobre"}
        else:
            node["isPartOf"] = {"@id": "wikivendas:root"}

        # Relações (hasPart) — links internos que SÃO páginas conhecidas
        internal_links = rel_path_to_links.get(rel_path, set())
        known_links = [l for l in internal_links if l in id_map or l.rstrip("/") in id_map]
        # Normaliza: tenta match exato, se não acha, tenta com /
        resolved_links = []
        for link in known_links:
            target_id = id_map.get(link) or id_map.get(link.rstrip("/"))
            if target_id:
                resolved_links.append({"@id": target_id})
        if resolved_links:
            node["hasPart"] = resolved_links

        # DOIs
        dois = meta.get("dois", [])
        if dois:
            node["sameAs"] = dois[0] if len(dois) == 1 else dois

        # Wikibase
        wb_ids = meta.get("wikibase_ids", [])
        if wb_ids:
            node["wikibaseId"] = wb_ids[0]

        # URNs
        urns = meta.get("urns", [])
        if urns:
            node["urn"] = urns[0]

        graph_nodes.append(node)

    # Glossário (coleção)
    glossary_terms = [n for n in graph_nodes if n.get("isPartOf", {}).get("@id") == "wikivendas:glossario"]
    graph_nodes.append({
        "@id": "wikivendas:glossario",
        "@type": "schema:CollectionPage",
        "name": "Glossário de Termos WikiVendas",
        "description": "Registro canônico de termos do domínio de vendas B2B e ontologia comercial.",
        "url": f"{BASE_URL}/termos/",
        "isPartOf": {"@id": "wikivendas:root"},
        "priority": 0.9,
        "hasPart": [{"@id": n["@id"]} for n in glossary_terms],
    })

    # Sobre (pai)
    about_pages = [n for n in graph_nodes if n.get("isPartOf", {}).get("@id") == "wikivendas:sobre"]
    graph_nodes.append({
        "@id": "wikivendas:sobre",
        "@type": "schema:AboutPage",
        "name": "Sobre a WikiVendas",
        "description": "Propósito, hipótese de trabalho e arquitetura experimental do projeto WikiVendas.",
        "url": f"{BASE_URL}/sobre/",
        "isPartOf": {"@id": "wikivendas:root"},
        "priority": 0.9,
        "hasPart": [{"@id": n["@id"]} for n in about_pages],
    })

    # Root
    root_children = [n["@id"] for n in graph_nodes if n.get("isPartOf", {}).get("@id") == "wikivendas:root"]
    root_node = {
        "@id": "wikivendas:root",
        "@type": "schema:WebPage",
        "name": "WikiVendas — Infraestrutura de Conhecimento de Domínio",
        "description": "Infraestrutura de Conhecimento de Domínio para vendas B2B e mercados de alto ticket.",
        "url": f"{BASE_URL}/",
        "priority": 1.0,
        "hasPart": [{"@id": n} for n in root_children],
    }
    graph_nodes.append(root_node)

    output = {
        "@context": {
            "@version": 1.1,
            "dct": "http://purl.org/dc/terms/",
            "schema": "https://schema.org/",
            "wikivendas": f"{BASE_URL}/",
            "name": "schema:name",
            "description": "schema:description",
            "isPartOf": {"@id": "dct:isPartOf", "@type": "@id"},
            "hasPart": {"@id": "dct:hasPart", "@type": "@id"},
            "sameAs": "schema:sameAs",
            "url": "schema:url",
            "priority": "schema:priority",
        },
        "@graph": graph_nodes,
        "totalPages": len(pages),
        "totalNodes": len(graph_nodes),
        "generated": TODAY,
        "domain": DOMAIN,
        "description": f"Grafo completo do WikiVendas. {len(pages)} páginas, {len(graph_nodes)} nós, relacionamentos extraídos automaticamente dos links internos.",
    }

    return json.dumps(output, indent=2, ensure_ascii=False)


# ── Main ──────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Gera sitemap.xml e graph.json para WikiVendas")
    parser.add_argument("--repo-dir", default=".", help="Diretório raiz do repositório")
    parser.add_argument("--output-dir", default=None, help="Diretório de saída (default = repo-dir)")
    args = parser.parse_args()

    repo_dir = os.path.abspath(args.repo_dir)
    output_dir = os.path.abspath(args.output_dir) if args.output_dir else repo_dir

    if not os.path.isdir(repo_dir):
        print(f"❌ Diretório não encontrado: {repo_dir}")
        sys.exit(1)

    print(f"📁 Varrendo HTMLs em: {repo_dir}")
    html_files = find_html_files(repo_dir)
    print(f"   Encontrados {len(html_files)} arquivos HTML")

    # Fase 1: ler todos os HTMLs e extrair metadados + links
    pages = {}
    rel_path_to_links = {}

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
        dois = extract_dois(html)
        wb_ids = extract_wikibase_ids(html)
        urns = extract_urns(html)

        pages[rel_path] = {
            "title": title,
            "description": desc,
            "priority": priority,
            "changefreq": changefreq,
            "dois": dois,
            "wikibase_ids": wb_ids,
            "urns": urns,
        }

        # Extrai links internos
        current_rel_dir = os.path.dirname(rel_path)
        internal_links = extract_internal_links(html, current_rel_dir)
        rel_path_to_links[rel_path] = internal_links

    if not pages:
        print("❌ Nenhuma página HTML encontrada. Nada a gerar.")
        sys.exit(1)

    # Fase 2: gerar sitemap.xml
    os.makedirs(output_dir, exist_ok=True)
    sitemap_xml = generate_sitemap(list(pages.items()))
    sitemap_path = os.path.join(output_dir, "sitemap.xml")
    with open(sitemap_path, "w", encoding="utf-8") as f:
        f.write(sitemap_xml)
    url_count = sitemap_xml.count("<url>")
    print(f"✅ sitemap.xml gerado: {sitemap_path} ({url_count} URLs)")

    # Fase 3: gerar graph.json
    graph_json = generate_graph(pages, rel_path_to_links)
    graph_path = os.path.join(output_dir, "graph.json")
    with open(graph_path, "w", encoding="utf-8") as f:
        f.write(graph_json)

    # Valida JSON
    try:
        parsed = json.loads(graph_json)
        node_count = len(parsed["@graph"])
        print(f"✅ graph.json gerado: {graph_path} ({node_count} nós)")
        # Mostra algumas relações descobertas
        for node in parsed["@graph"]:
            if "hasPart" in node and "@id" in node:
                targets = [h["@id"] for h in node["hasPart"]]
                print(f"   🔗 {node['@id']} -> {targets}")
    except json.JSONDecodeError as e:
        print(f"❌ graph.json inválido: {e}")

    print(f"\n🎯 Pronto! Commit e push para publicar.")


if __name__ == "__main__":
    main()

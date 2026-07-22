#!/usr/bin/env python3
"""Gera sitemap.xml + graph.json — Knowledge Graph JSON-LD para WikiVendas."""

import json
import os
import re
import sys
from datetime import date
from xml.dom import minidom
from xml.etree.ElementTree import Element, SubElement, tostring

# ── Config ────────────────────────────────────────────────────────────
BASE_URL = "https://wikivendas.com.br"
DOMAIN = "wikivendas.com.br"

PRIORITY_RULES = [
    (r"^index\.html$",                             1.0, "weekly"),
    (r"^sobre/index\.html$",                       0.9, "monthly"),
    (r"^termos/(intencionar|mio)/index\.html$",    0.9, "monthly"),
    (r"^termos/[^/]+/index\.html$",                0.8, "monthly"),
    (r"^sobre/.+/index\.html$",                    0.7, "monthly"),
    (r"^mio\.html$",                               0.8, "monthly"),
    (r"^nova-olaria\.html$",                       0.7, "monthly"),
    (r".+\.html$",                                 0.6, "monthly"),
]

# ── Relações semânticas manuais ──
SEMANTIC_RELATIONS = {
    "termos/compra-de-leads-qualificados": {
        "broader": ["wikivendas:termos-lead-b2b"],
        "relatedTo": ["wikivendas:termos-fornecedor-de-leads"],
    },
    "termos/fornecedor-de-leads": {
        "broader": ["wikivendas:termos-lead-b2b"],
        "relatedTo": ["wikivendas:termos-compra-de-leads-qualificados"],
    },
    "termos/generative-lead-spoofing": {
        "broader": ["wikivendas:termos-lead-b2b"],
    },
    "termos/intencionar": {
        "relatedTo": ["wikivendas:termos-compra-de-leads-qualificados"],
    },
}


def extract_title(html):
    m = re.search(r"<title[^>]*>([^<]+)</title>", html, re.IGNORECASE | re.DOTALL)
    return m.group(1).strip() if m else ""


def extract_description(html):
    patterns = [
        r'<meta\s+name=["\']description["\']\s+content=["\']([^"\']+)["\']',
        r'<meta\s+content=["\']([^"\']+)["\']\s+name=["\']description["\']',
    ]
    for p in patterns:
        m = re.search(p, html, re.IGNORECASE)
        if m:
            return m.group(1).strip()
    return ""


def extract_internal_links(html, current_rel_dir):
    links = set()
    for m in re.finditer(r'href=["\']([^"\']+)["\']', html, re.IGNORECASE):
        href = m.group(1).strip()
        if not href or href.startswith("#") or href.startswith("mailto:") or href.startswith("tel:"):
            continue
        if href.startswith("http"):
            if DOMAIN not in href and BASE_URL not in href:
                continue
            parsed = __import__("urllib.parse", fromlist=["urlparse"]).urlparse(href)
            href = parsed.path.lstrip("/")
        else:
            href = href.split("#")[0]
            if href.startswith("/"):
                href = href.lstrip("/")
            elif current_rel_dir:
                href = os.path.normpath(os.path.join(current_rel_dir, href)).replace("\\", "/")
        if href.endswith("/index.html"):
            href = href[:-10] if href != "index.html" else ""
        elif href.endswith("/"):
            href = href.rstrip("/")
        if href:
            links.add(href)
    return links


def extract_dois(html):
    return list(set(re.findall(r'https://doi\.org/10\.\d{4,}/[^\s"\'<>]+', html)))


def extract_wikibase_ids(html):
    return re.findall(r'\bQ\d{2,}\b', html)


def extract_urns(html):
    return re.findall(r'urn:wikivendas:[^\s"\'<>]+', html)


def find_html_files(repo_dir):
    htmls = []
    repo_dir = os.path.abspath(repo_dir)
    for root, dirs, files in os.walk(repo_dir):
        dirs[:] = [d for d in dirs if not d.startswith(".") and d not in ("scripts", "node_modules", "__pycache__")]
        for f in files:
            if f.endswith(".html"):
                htmls.append(os.path.relpath(os.path.join(root, f), repo_dir))
    return sorted(htmls)


def classify(rel_path):
    for pattern, prio, freq in PRIORITY_RULES:
        if re.match(pattern, rel_path):
            return prio, freq
    return 0.5, "monthly"


def rel_to_url(rel_path):
    if rel_path == "index.html":
        return ""
    if rel_path.endswith("/index.html"):
        return rel_path[:-10]
    if rel_path.endswith(".html"):
        return rel_path
    return rel_path + "/"


def page_id(url_path):
    clean = url_path.rstrip("/").replace("/", "-").replace(".html", "")
    return f"wikivendas:{clean or 'root'}"


def generate_sitemap(pages, today):
    xmlns = "http://www.sitemaps.org/schemas/sitemap/0.9"
    urlset = Element("urlset", xmlns=xmlns)
    for rel_path, meta in sorted(pages, key=lambda p: -p[1]["priority"]):
        loc = f"{BASE_URL}/{rel_to_url(rel_path)}"
        url = SubElement(urlset, "url")
        SubElement(url, "loc").text = loc
        SubElement(url, "lastmod").text = today
        SubElement(url, "changefreq").text = meta["changefreq"]
        SubElement(url, "priority").text = f"{meta['priority']:.1f}"
    raw = tostring(urlset, encoding="unicode")
    return minidom.parseString(raw.encode()).toprettyxml(indent="  ")


def generate_graph(pages, rel_path_to_links, today):
    graph_nodes = []
    id_map = {}

    # Mapeia todos os caminhos para @id (inclusive os que serão agregadores)
    for rel_path in pages:
        up = rel_to_url(rel_path)
        id_map[up] = page_id(up)

    for rel_path, meta in pages.items():
        up = rel_to_url(rel_path)

        # ── EVITA DUPLICAÇÃO ──────────────────────────────────
        # index.html vira wikivendas:root (nó agregador no final)
        # sobre/index.html vira wikivendas:sobre (nó agregador no final)
        if up == "" or rel_path == "sobre/index.html":
            continue

        pid = page_id(up)
        url = f"{BASE_URL}/{up}"

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
            "description": meta["description"] or meta["title"] or "WikiVendas DKI",
            "url": url,
            "priority": meta["priority"],
        }

        if up.startswith("termos/"):
            node["isPartOf"] = {"@id": "wikivendas:glossario"}
        elif up.startswith("sobre/"):
            node["isPartOf"] = {"@id": "wikivendas:sobre"}
        else:
            node["isPartOf"] = {"@id": "wikivendas:root"}

        # Links internos → hasPart
        internal_links = rel_path_to_links.get(rel_path, set())
        resolved = []
        for link in internal_links:
            norm = link.rstrip("/")
            target = id_map.get(norm)
            if target:
                resolved.append({"@id": target})
        if resolved:
            node["hasPart"] = resolved

        # Relações semânticas manuais
        if rel_path in SEMANTIC_RELATIONS:
            for rel_type, targets in SEMANTIC_RELATIONS[rel_path].items():
                node[rel_type] = [{"@id": t} for t in targets]

        # DOIs (deduplicados)
        dois = meta.get("dois", [])
        if dois:
            node["sameAs"] = dois[0] if len(dois) == 1 else dois

        # Wikibase ID → CURIE wd:Q123
        wb = meta.get("wikibase_ids", [])
        if wb:
            node["identifier"] = {"@id": f"wd:{wb[0]}"}
            node["wikibaseId"] = wb[0]  # mantém string para compatibilidade

        # URN → CURIE urn:wikivendas:...
        urns = meta.get("urns", [])
        if urns:
            node["urn"] = urns[0]

        graph_nodes.append(node)

    # ── NÓS AGREGADORES (criados uma única vez) ──────────────

    # Glossário
    gt = [n for n in graph_nodes if n.get("isPartOf", {}).get("@id") == "wikivendas:glossario"]
    glossario = {
        "@id": "wikivendas:glossario",
        "@type": "schema:CollectionPage",
        "name": "Glossário de Termos WikiVendas",
        "description": "Registro canônico de termos do domínio de vendas B2B.",
        "url": f"{BASE_URL}/termos/",
        "isPartOf": {"@id": "wikivendas:root"},
        "priority": 0.9,
        "hasPart": [{"@id": n["@id"]} for n in gt],
    }
    graph_nodes.append(glossario)

    # Sobre
    ap = [n for n in graph_nodes if n.get("isPartOf", {}).get("@id") == "wikivendas:sobre"]
    sobre = {
        "@id": "wikivendas:sobre",
        "@type": "schema:AboutPage",
        "name": "Sobre a WikiVendas",
        "description": "Propósito e arquitetura experimental do projeto WikiVendas.",
        "url": f"{BASE_URL}/sobre/",
        "isPartOf": {"@id": "wikivendas:root"},
        "priority": 0.9,
        "hasPart": [{"@id": n["@id"]} for n in ap],
    }
    graph_nodes.append(sobre)

    # Root
    rc = [n["@id"] for n in graph_nodes if n.get("isPartOf", {}).get("@id") == "wikivendas:root"]
    root = {
        "@id": "wikivendas:root",
        "@type": "schema:WebPage",
        "name": "WikiVendas — Infraestrutura de Conhecimento de Domínio",
        "description": "Infraestrutura de Conhecimento de Domínio para vendas B2B.",
        "url": f"{BASE_URL}/",
        "priority": 1.0,
        "hasPart": [{"@id": n} for n in rc],
    }
    graph_nodes.append(root)

    # ── Métricas: distinct @id ──
    unique_ids = set(n["@id"] for n in graph_nodes)

    output = {
        "@context": {
            "@version": 1.1,
            "dct": "http://purl.org/dc/terms/",
            "schema": "https://schema.org/",
            "wikivendas": f"{BASE_URL}/",
            "wd": f"{BASE_URL}/entity/",
            "urn": "urn:wikivendas:",
        },
        "@graph": graph_nodes,
        "totalPages": len(pages),
        "totalNodes": len(unique_ids),
        "generated": today,
        "domain": DOMAIN,
    }
    return json.dumps(output, indent=2, ensure_ascii=False)


def main():
    today = date.today().isoformat()
    repo_dir = os.path.abspath(".")

    print(f"[{today}] 📁 Varrendo HTMLs em: {repo_dir}")
    html_files = find_html_files(repo_dir)
    print(f"   Encontrados {len(html_files)} arquivos HTML")

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

        priority, changefreq = classify(rel_path)
        pages[rel_path] = {
            "title": extract_title(html),
            "description": extract_description(html),
            "priority": priority,
            "changefreq": changefreq,
            "dois": extract_dois(html),
            "wikibase_ids": extract_wikibase_ids(html),
            "urns": extract_urns(html),
        }
        rel_path_to_links[rel_path] = extract_internal_links(html, os.path.dirname(rel_path))

    if not pages:
        print("❌ Nenhuma página HTML encontrada.")
        sys.exit(1)

    # ⚠️ Valida conflitos de wikibaseId
    wb_check = {}
    for rel_path, meta in pages.items():
        for qid in meta.get("wikibase_ids", []):
            if qid in wb_check:
                print(f"   ⚠️  Conflito wikibaseId: {qid} em '{rel_path}' e '{wb_check[qid]}'")
            else:
                wb_check[qid] = rel_path

    # Gera sitemap
    with open("sitemap.xml", "w", encoding="utf-8") as f:
        f.write(generate_sitemap(list(pages.items()), today))
    print(f"✅ sitemap.xml gerado com {len(pages)} páginas")

    # Gera graph
    with open("graph.json", "w", encoding="utf-8") as f:
        f.write(generate_graph(pages, rel_path_to_links, today))
    print(f"✅ graph.json gerado")

    # Validação
    with open("graph.json", "r") as f:
        g = json.load(f)
    print(f"   {g['totalNodes']} nós únicos no grafo (distinct @id)")
    print(f"[{today}] 🎯 Pronto!")


if __name__ == "__main__":
    main()

name: Gerar Sitemap + Graph.json Diariamente

on:
  schedule:
    - cron: '0 9 * * *'
  workflow_dispatch:

permissions:
  contents: write

jobs:
  gerar:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: '3.11'
      - run: python3 gerar_sitemap.py
      - run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add sitemap.xml graph.json
          if git diff --cached --quiet; then
            echo "📭 Nenhuma alteração"
          else
            git commit -m "🔄 sitemap+grafo [$(date +%Y-%m-%d)]"
            git push
          fi

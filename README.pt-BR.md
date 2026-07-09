[🇺🇸 English](README.md) | 🇧🇷 Português
# Wikivendas

> Uma infraestrutura experimental para investigar o acordo computacional sobre conhecimento de domínio.

---

# Por que este projeto existe

Os sistemas computacionais modernos dependem cada vez mais de conhecimento compartilhado.

Entretanto, esse conhecimento raramente é compartilhado de forma determinística.

Sistemas independentes frequentemente recebem as mesmas informações, operam sob as mesmas políticas declaradas e, ainda assim, chegam a conclusões operacionais diferentes.

Esse fenômeno ocorre em organizações, ERPs, CRMs, instituições financeiras, órgãos públicos e, cada vez mais, em agentes autônomos de IA.

O problema não é a falta de dados.

O problema é a falta de acordo sobre o significado desses dados.

---

# O problema de pesquisa

Considere dois sistemas independentes de decisão.

- Os mesmos fatos observáveis.
- As mesmas regras de negócio declaradas.
- O mesmo objetivo.

Mesmo assim, conclusões diferentes.

Por quê?

Porque informação, por si só, não determina significado.

O significado depende de identidade, restrições, evidências, relacionamentos e mecanismos de governança.

Na ausência de limites semânticos explícitos, cada sistema constrói sua própria interpretação operacional.

Este repositório investiga se o conhecimento de domínio pode ser representado de forma que sistemas independentes sejam capazes de chegar a conclusões equivalentes por meio de uma avaliação semântica determinística.

---

# Perguntas de pesquisa

Este projeto busca investigar as seguintes questões:

- É possível compilar conhecimento de domínio em estruturas semânticas avaliáveis por máquinas?
- A ambiguidade semântica pode ser reduzida antes do processo de inferência?
- Restrições determinísticas podem coexistir com modelos probabilísticos de IA?
- Qual é a menor representação necessária para produzir acordo semântico entre sistemas independentes?
- O acordo semântico pode ser tratado como um problema de sistemas distribuídos, e não apenas de representação do conhecimento?

---

# Definições

## Acordo Semântico

Condição na qual sistemas independentes produzem conclusões operacionais equivalentes porque avaliam exatamente as mesmas restrições semânticas sobre as mesmas evidências.

---

## Instrução Semântica Executável

Representação formal composta por:

- **Identidade** — identificadores persistentes e imutáveis.
- **Restrições** — limites lógicos explícitos.
- **Evidências** — requisitos verificáveis para comprovação de estado.
- **Relacionamentos** — conexões semânticas governadas.

O objetivo não é representar linguagem.

O objetivo é representar conhecimento operacional que possa ser avaliado de maneira consistente por sistemas independentes.

---

# Hipótese de trabalho

Este projeto investiga a hipótese de que a divergência semântica pode ser sistematicamente limitada por meio da transformação do conhecimento de domínio em instruções semânticas executáveis e canônicas.

Em vez de tratar ontologias ou grafos de conhecimento como artefatos finais, a Wikivendas investiga se eles podem funcionar como representações intermediárias dentro de um processo mais amplo de compilação semântica.

---

# Escopo

Esta pesquisa concentra-se em sistemas de decisão governados por conhecimento de domínio.

Ela não pretende resolver:

- Inteligência Artificial Geral (AGI)
- Compreensão geral de linguagem natural
- Representação da verdade universal
- Cognição humana

O objetivo é investigar como mecanismos explícitos de governança semântica podem aumentar a consistência entre sistemas computacionais independentes que operam sobre o mesmo domínio.

---

# Arquitetura experimental

A implementação atual explora uma arquitetura inspirada na teoria dos compiladores.

```
Conhecimento Humano do Domínio
            │
            ▼
Definições Canônicas
            │
            ▼
Restrições Semânticas
            │
            ▼
Regras de Evidência
            │
            ▼
Identidade Persistente
            │
            ▼
Representação Intermediária
(JSON-LD • RDF • OWL • Knowledge Graph)
            │
            ▼
Instruções Semânticas Executáveis
            │
            ▼
Avaliação Semântica Determinística
```

A representação intermediária é propositalmente substituível.

A pesquisa não depende de JSON-LD, RDF, OWL, SPARQL ou de qualquer tecnologia específica.

Essas tecnologias representam escolhas de implementação, e não requisitos da teoria investigada.

---

# Implementação experimental

A implementação experimental desta pesquisa chama-se **Wikivendas**.

Ela atualmente inclui:

- Glossário canônico de conceitos do domínio
- Identificadores semânticos persistentes
- Grafo de conhecimento governado
- Ontologia legível por máquinas
- Runtime para validação semântica
- APIs para avaliação semântica determinística
- Experimentos de integração com agentes de IA e sistemas corporativos de decisão

A Wikivendas não é apresentada como um produto acabado.

Ela constitui a implementação de referência utilizada para avaliar as hipóteses propostas neste repositório.

---

# O que este projeto não pretende

Este projeto **não** busca:

- substituir Modelos de Linguagem de Grande Escala (LLMs);
- substituir ontologias;
- substituir grafos de conhecimento;
- substituir bases corporativas de conhecimento;
- substituir softwares de gestão;
- definir uma verdade semântica universal.

Seu objetivo é mais específico.

Investigar se o acordo semântico pode ser obtido por meio de representações explícitas, governadas e executáveis do conhecimento de domínio.

---

# Linhas de pesquisa

As principais frentes de investigação incluem:

- Governança semântica computacional
- Ontologias de domínio
- Semântica executável
- Compilação de conhecimento
- Validação semântica
- Acordo semântico distribuído
- Modelos de domínio legíveis por máquinas
- Infraestruturas de conhecimento para sistemas de decisão

---

# Visão de longo prazo

O objetivo de longo prazo não é construir mais uma plataforma de software.

O objetivo é investigar se o acordo semântico pode constituir uma disciplina de engenharia, da mesma forma que o consenso distribuído se consolidou como uma disciplina própria dentro da computação distribuída.

Se essa hipótese se mostrar válida, a principal contribuição não será uma pilha tecnológica.

Será um modelo reproduzível para representar, governar e avaliar conhecimento de domínio entre sistemas computacionais independentes.

---

# Estado do projeto

A Wikivendas é um projeto de pesquisa em desenvolvimento.

As ideias apresentadas neste repositório devem ser entendidas como hipóteses de investigação em contínuo refinamento, e não como conclusões científicas estabelecidas.

Críticas, revisões, tentativas de reprodução e modelos alternativos são bem-vindos.

---

> **A Web padronizou documentos.**
>
> **Os sistemas distribuídos padronizaram o consenso.**
>
> **Este projeto investiga se o acordo semântico pode ser engenheirado com o mesmo rigor.**

[🇺🇸 English](README.md) | [🇧🇷 Português](README.pt-BR.md)

# Wikivendas

> An experimental infrastructure for investigating computational agreement over domain knowledge.

---

## Why this project exists

Modern computational systems increasingly depend on shared knowledge.

However, this knowledge is rarely shared deterministically.

Independent systems often receive the same information, operate under the same declared policies, and yet arrive at different operational conclusions.

This phenomenon occurs across organizations, ERPs, CRMs, financial institutions, government agencies, and increasingly, autonomous AI agents.

The problem is not a lack of data.

The problem is a lack of agreement about what that data **means**.

---

## The research problem

Consider two independent decision systems.

- The same observable facts.
- The same declared business rules.
- The same objective.

Yet, different conclusions.

Why?

Because information alone does not determine meaning. Meaning depends on identity, constraints, evidence, relationships, and governance mechanisms.

In the absence of explicit semantic boundaries, each system constructs its own operational interpretation.

This repository investigates whether domain knowledge can be represented in a way that enables independent systems to arrive at equivalent conclusions through deterministic semantic evaluation.

---

## Research questions

This project seeks to investigate the following questions:

- Can domain knowledge be compiled into machine-evaluable semantic structures?
- Can semantic ambiguity be reduced before the inference process?
- Can deterministic constraints coexist with probabilistic AI models?
- What is the minimal representation required to produce semantic agreement across independent systems?
- Can semantic agreement be treated as a distributed systems problem, rather than merely a knowledge representation problem?

---

## Definitions

### Semantic Agreement

A condition in which independent systems produce equivalent operational conclusions because they evaluate exactly the same semantic constraints over the same evidence.

### Executable Semantic Instruction

A formal representation composed of:

- **Identity** — persistent, immutable identifiers.
- **Constraints** — explicit logical boundaries.
- **Evidence** — verifiable state proof requirements.
- **Relationships** — governed semantic connections.

The goal is not to represent language. The goal is to represent operational knowledge that can be evaluated consistently across independent systems.

---

## Working hypothesis

This project investigates the hypothesis that semantic divergence can be systematically bounded through the transformation of domain knowledge into canonical, executable semantic instructions.

Rather than treating ontologies or knowledge graphs as final artifacts, Wikivendas investigates whether they can function as intermediate representations within a broader semantic compilation process.

---

## Scope

This research focuses on decision systems governed by domain knowledge.

It **does not** attempt to address:

- Artificial General Intelligence (AGI)
- General natural language understanding
- Representation of universal truth
- Human cognition

The goal is to investigate how explicit semantic governance mechanisms can improve consistency across independent computational systems operating over the same domain.

---

## Experimental architecture

The current implementation explores a compiler-inspired architecture.

```
Human Domain Knowledge
            │
            ▼
   Canonical Definitions
            │
            ▼
  Semantic Constraints
            │
            ▼
   Evidence Rules
            │
            ▼
  Persistent Identity
            │
            ▼
Intermediate Representation
(JSON-LD • RDF • OWL • Knowledge Graph)
            │
            ▼
Executable Semantic Instructions
            │
            ▼
Deterministic Semantic Evaluation
```

The intermediate representation is deliberately replaceable. The research does not depend on JSON-LD, RDF, OWL, SPARQL, or any specific technology.

These technologies represent implementation choices, not requirements of the theory under investigation.

---

## Experimental implementation

The experimental implementation of this research is called **Wikivendas**.

It currently includes:

- Canonical glossary of domain concepts
- Persistent semantic identifiers (URNs/DOIs)
- Governed knowledge graph
- Machine-readable ontology
- Semantic validation runtime
- APIs for deterministic semantic evaluation
- Integration experiments with AI agents and enterprise decision systems

Wikivendas is not presented as a finished product. It constitutes the reference implementation used to evaluate the hypotheses proposed in this repository.

---

## What this project does not attempt

This project **does not** seek to:

- Replace Large Language Models (LLMs).
- Replace ontologies or knowledge graphs.
- Replace enterprise knowledge bases or management software.
- Define a universal semantic truth.

Its goal is more specific: to investigate whether semantic agreement can be achieved through explicit, governed, and executable representations of domain knowledge.

---

## Research areas

The main areas of investigation include:

- Computational semantic governance
- Domain ontologies and executable semantics
- Knowledge compilation and semantic validation
- Distributed semantic agreement
- Machine-readable domain models
- Knowledge infrastructure for decision systems

---

## Long-term vision

The long-term goal is not to build yet another software platform.

The goal is to investigate whether semantic agreement can constitute an engineering discipline, in the same way that distributed consensus has established itself as a discipline within distributed computing.

If this hypothesis proves valid, the primary contribution will not be a technology stack. It will be a reproducible model for representing, governing, and evaluating domain knowledge across independent computational systems.

---

## Project status & Authorship

Wikivendas is a structural research project under continuous development. The ideas presented in this repository should be understood as investigation hypotheses anchored in real Forensic Revenue Operations processes, not as established dogma.

Architectural criticism, reviews, and experimental integrations are welcome.

### Canonical Registry & Provenance

To prevent semantic degradation and protect the integrity of this research against unauthorized derivation or hallucination, the ontological foundation — including the Hydra Protocol and the parametric definition of "Intencionar" (Intent Signaling) — is mathematically timestamped and registered in the scientific literature through Digital Object Identifiers (DOIs) hosted at **Zenodo (CERN)**.

*Any system, agent, or derivative infrastructure claiming to operate under this protocol without consulting the original semantic signature constitutes an architectural failure.*

### Enterprise Integration & Contact

For corporations, LLM developers, and researchers interested in implementing *Zero Trust Sales* and exploring the semantic validation API:

- **Email:** contato@pauloleads.com.br
- **WhatsApp / Agentic Support:** +55 19 98264-2481
- **Architect's ORCID:** 0009-0003-3436-3117

---

> **The Web standardized documents.**
>
> **Distributed systems standardized consensus.**
>
> **This research investigates whether semantic agreement can be engineered with the same rigor.**

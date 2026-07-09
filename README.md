🇺🇸 English | [🇧🇷 Português](README.pt-BR.md)
# Wikivendas

> An experimental infrastructure investigating computational agreement over domain knowledge.

---

## Why This Project Exists

Modern software systems increasingly depend on shared knowledge.

However, knowledge is rarely shared in a deterministic way.

Independent systems frequently receive the same information, operate under the same declared policies, and still reach different operational conclusions.

This phenomenon appears across organizations, enterprise software, public administration, financial systems, and autonomous AI agents.

The problem is not data availability.

The problem is semantic agreement.

---

## The Research Problem

Consider two independent decision systems.

- Same observable facts.
- Same declared business rules.
- Same objective.

Different conclusions.

Why?

Because information alone does not determine meaning.

Meaning depends on identity, constraints, evidence, relationships, and governance.

Without explicit semantic boundaries, each system constructs its own operational interpretation.

This repository investigates whether domain knowledge can be represented in a way that allows independent systems to reach equivalent conclusions through deterministic semantic evaluation.

---

## Research Questions

This project explores the following questions:

- Can domain knowledge be compiled into machine-evaluable semantic structures?
- Can semantic ambiguity be reduced before inference occurs?
- Can deterministic semantic constraints coexist with probabilistic AI models?
- What is the minimal representation required for semantic agreement?
- Can semantic agreement be approached as a distributed systems problem rather than only a knowledge representation problem?

---

## Definitions

### Semantic Agreement

The condition in which independent decision systems produce equivalent operational conclusions because they evaluate the same semantic constraints over the same evidence.

---

### Executable Semantic Instruction

A deterministic semantic representation composed of:

- **Identity** — persistent identifiers
- **Constraints** — explicit logical boundaries
- **Evidence** — verifiable state requirements
- **Relations** — governed semantic connections

The objective is not to represent language.

The objective is to represent operational knowledge that can be evaluated consistently by independent systems.

---

## Working Hypothesis

This project investigates the hypothesis that semantic divergence can be systematically bounded by transforming domain knowledge into canonical executable semantic instructions.

Rather than treating ontologies or knowledge graphs as the final artifact, Wikivendas explores whether they can serve as intermediate representations within a broader semantic compilation process.

---

## Scope

This research focuses on governed, domain-specific decision systems.

It does not attempt to solve:

- Artificial General Intelligence
- General natural language understanding
- Universal truth representation
- Human cognition

Instead, it investigates how explicit semantic governance can improve consistency across independent computational systems operating within the same domain.

---

## Experimental Architecture

The current implementation explores a compiler-inspired semantic architecture.

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

The intermediate representation is intentionally replaceable.

The underlying research does not depend on JSON-LD, RDF, OWL, SPARQL, or any specific technology.

These are implementation choices, not theoretical requirements.

---

## Current Experimental Implementation

The experimental implementation of this research is called **Wikivendas**.

It currently includes:

- Canonical domain glossary
- Persistent semantic identifiers
- Governed knowledge graph
- Machine-readable ontology
- Runtime semantic validation
- APIs for deterministic semantic evaluation
- Integration experiments with AI agents and enterprise decision systems

Wikivendas is not presented as a finished product.

It is the reference implementation used to evaluate the hypotheses described in this repository.

---

## Non-Goals

This project does **not** attempt to:

- replace Large Language Models
- replace ontologies
- replace knowledge graphs
- replace enterprise knowledge bases
- replace business software
- define universal semantic truth

Its purpose is narrower.

It investigates whether semantic agreement can be engineered through explicit, governed representations of domain knowledge.

---

## Research Directions

Current areas of investigation include:

- Computational semantic governance
- Domain ontologies
- Executable semantics
- Knowledge compilation
- Semantic validation
- Distributed semantic agreement
- Machine-readable domain models
- Knowledge infrastructure for decision systems

---

## Long-Term Vision

The long-term objective is not to build another software platform.

The objective is to investigate whether semantic agreement can become an engineering discipline in the same way that distributed consensus became a discipline within distributed computing.

If successful, the contribution will not be a technology stack.

It will be a reproducible model for representing, governing, and evaluating domain knowledge across independent computational systems.

---

## Status

Wikivendas is an active research project.

The ideas presented here should be understood as research hypotheses under continuous refinement rather than established scientific conclusions.

Contributions, criticism, replication attempts, and alternative models are welcome.

---

> *The Web standardized documents.*
>
> *Distributed systems standardized consensus.*
>
> *This project investigates whether semantic agreement can be engineered with comparable rigor.*

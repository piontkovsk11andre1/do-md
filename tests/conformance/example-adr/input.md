# Use do-md for ADRs

**Status:** accepted

**Author:** Ada Lovelace

**Date:** 2026-08-22

## Summary

Adopt a structured ADR format so decisions stay machine-readable.

## Context

Teams were writing free-form ADRs that could not be queried.


## Decisions

### Store ADRs as Markdown templates

Templates capture title, status, and consequences without a separate schema.

**Alternatives considered:**

- YAML front matter
- A custom database

**Example:**

```js
const status = "accepted";
```

**Consequences:**

- [x] ADRs stay in git
- [x] Authors must learn the template



## Action items

- [x] Publish the template
- [x] Migrate existing ADRs


## References

- [Architecture decision records](https://adr.github.io/)



---

_Generated with do-md._

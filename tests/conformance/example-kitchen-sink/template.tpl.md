{% doc.heading(1).trim().notEmpty().as("title") %}

{%
    const subtitleSlot = doc.line()
        .default("(no subtitle)")
        .trim()
        .as("subtitle")
%}

**Status:** {%
    doc.line()
        .trim()
        .validate(s => ["draft", "review", "accepted"].includes(s))
        .as("status")
%}

## §2 — Abstract

{% doc.paragraph().trim().notEmpty().as("abstract") %}

{% doc.optional(() => { %}## §3 — Callout

> {% doc.blockQuote().trim().as("callout") %}
{% }) %}

## §4 — Rule

{%
    const ruleSlot = doc.thematicBreak().as("hasRule")
%}

---

## §5 — Header line (byte-level composition)

Author: {% doc.text(" — ").trim().notEmpty().as("author") %} — {% doc.until("\n").trim().as("authoredOn") %}

Version: {%
    doc.regexp(/\d+\.\d+\.\d+/)
        .validate(v => v.split(".").length === 3)
        .as("version")
%}

## §6 — Tags

{% doc.list().notEmpty().as("tags") %}

## §7 — Compatibility matrix

{% doc.table().as("compatibility") %}

## §8 — Example code

{% doc.codeBlock().as("example") %}

{% doc.optional(() => { %}## §9 — Raw embed

{% doc.htmlBlock().as("embed") %}
{% }) %}

## §10 — Action items (repeat + checkbox + asArray)

{% doc.repeat(() => { %}- {% doc.checkbox().asArray("done") %} {% doc.line().trim().asArray("actions") %}
{% }) %}

## §11 — Inline catalog (one line, four byte-level leaves)

Homepage: {% doc.link().as("homepage") %} — Logo: {% doc.image().as("logo") %} — Repo: {% doc.autolink().as("repo") %} — Binary: {% doc.codeSpan().as("binary") %}

## §12 — Chapters (nested scope)

{%
doc.scope("chapters", (chapter) => {
  chapter.literal("### ")
  chapter.line().trim().as("name")
  chapter.literal("\n\n")
  chapter.paragraph().trim().as("body")
  chapter.literal("\n\n")
  chapter.optional(() => {
    chapter.literal("**See also:** ")
    chapter.link().as("seeAlso")
    chapter.literal("\n")
  })
  chapter.literal("\n")
})
%}

{% doc.optional(() => { %}## §13 — References (optional section, .default + .exists)

{%
    const headerSlot = doc.line()
        .default("References")
        .trim()
        .as("referencesHeader")
%}

{% doc.repeat(() => { %}- {% doc.link().asArray("references") %}
{% }) %}
{% }) %}

{% doc.skipUntilHeading("§14") %}## §14 — Footer notes

{% doc.repeat(() => { %}- {% doc.line().trim().asArray("footerNotes") %}
{% }) %}

---

_Kitchen-sink template — every leaf, every structural method, every modifier._

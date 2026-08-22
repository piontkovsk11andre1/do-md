# {% doc.line().trim().notEmpty().as("title") %}

**Status:** {% doc.line().trim().validate(s => ["draft", "review", "accepted", "rejected", "superseded"].includes(s)).as("status") %}

**Author:** {% doc.line().trim().notEmpty().as("author") %}

**Date:** {% doc.line().trim().validate(s => /^\d{4}-\d{2}-\d{2}$/.test(s)).as("date") %}

## Summary

{% doc.paragraph().trim().notEmpty().as("summary") %}

{% doc.optional(() => { %}## Context

{% doc.paragraph().trim().as("context") %}
{% }) %}

## Decisions

{%
doc.scope("decisions", (decision) => {
  decision.heading(3).trim().notEmpty().as("title")
  decision.literal("\n\n")
  decision.paragraph().trim().as("rationale")
  decision.literal("\n\n")
  decision.optional(() => {
    decision.literal("**Alternatives considered:**\n\n")
    decision.list().as("alternatives")
    decision.literal("\n\n")
  })
  decision.optional(() => {
    decision.literal("**Example:**\n\n")
    decision.codeBlock().as("example")
    decision.literal("\n\n")
  })
  decision.literal("**Consequences:**\n\n")
  decision.repeat(() => {
    decision.literal("- ")
    decision.checkbox().asArray("positives")
    decision.literal(" ")
    decision.line().trim().asArray("consequences")
    decision.literal("\n")
  })
  decision.literal("\n")
})
%}

## Action items

{% doc.repeat(() => { %}- {% doc.checkbox().asArray("done") %} {% doc.line().trim().asArray("actions") %}
{% }) %}

{% doc.optional(() => { %}## References

{% doc.repeat(() => { %}- {% doc.link().asArray("references") %}
{% }) %}
{% }) %}

---

_Generated with do-md._

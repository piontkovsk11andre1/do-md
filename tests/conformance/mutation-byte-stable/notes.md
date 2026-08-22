Byte-stable scalar replacement from `release-notes` + `set --key version --value 2.0.0`.

The mutated file differs from the input only inside the `version` slot source range. Surrounding bytes, including the `# ` prefix and later lines, stay identical.

`sets` covers multiple scalar splices (`version` then `date`) applied to the original source in descending offset order. Unmutated bytes, including the list body, stay identical.

Reuse the `release-notes` template as-is (`date` is `until(".")`, not `line()`).

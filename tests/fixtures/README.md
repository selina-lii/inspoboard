# Test fixtures

`vault/` is a frozen vault in format 1. Do not change it.

Every app version must load it with no errors and write it back byte for byte
(see `tests/format.test.ts`). This guards backwards compatibility (docs/SPEC.md section 3.1).

To test a newer format, add a new fixture folder next to it. Do not edit this one.

`attention.pdf` is a public paper ("Attention Is All You Need", arXiv 1706.03762v7) for PDF tests: the text model,
paragraphs, and translation. It has figures, tables, formulas, and footnotes.

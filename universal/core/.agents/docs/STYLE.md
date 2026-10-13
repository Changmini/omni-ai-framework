# Document style

Rules for every document written in this repository, by people or agents.

## Structure
- The first paragraph says what the document is for, who reads it, and who decides.
- Use the template for the document type (`.agents/docs/templates/`). Keep its section order.
- One topic per section. Use tables for comparisons and option lists, numbered lists for steps.
- Keep a document under 300 lines. Split by topic and link instead of growing one file.
- A document longer than 100 lines starts with a short table of contents.

## Claims and evidence
- Mark every claim about external software, services, or standards as **verified** (with a link to the official source) or **unverified**.
- Quote exact error messages, commands, and versions; do not paraphrase them.
- Separate facts from recommendations. Recommendations say which option and why, in one or two sentences.

## Language
- Write in the project's documentation language. Keep code, commands, paths, and identifiers in their original form.
- Short sentences, active voice, no filler. Define a term once and use it the same way throughout.
- Absolute dates (`YYYY-MM-DD`), never "recently", "soon", or "next week".

## Links and files
- Link with relative paths that exist. Do not link to files outside the repository unless they are public URLs.
- File names: lowercase, hyphen-separated (`export-csv.md`). Decision records: `NNNN-title.md`, numbered in order.

---
paths:
  - "**/*.test.*"
  - "**/*_test.*"
  - "**/test_*.py"
  - "tests/**"
---

# Testing rules

<!-- Loaded only when Claude reads or edits a matching file. Replace with your project's rules. -->

- Prefer real collaborators over mocks unless the dependency is slow or external.
- Every bug fix starts with a failing test that reproduces it.
- Name tests after the behavior they verify.

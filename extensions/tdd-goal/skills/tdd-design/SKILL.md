---
name: tdd-design
description: Guidelines for designing integration tests in TDD mode
---

# TDD Test Design Guidelines

When designing integration tests for a feature:

1. **Focus on behavior, not implementation.** The tests should specify *what* the system does, not *how*.
2. **Use realistic inputs** and assert on observable outcomes (outputs, side effects, state changes).
3. **Cover happy path and edge cases:** errors, boundaries, empty/null inputs, race conditions.
4. **Keep tests readable:** use descriptive test names and clear arrange/act/assert structure.
5. **Make them deterministic:** avoid randomness or dependence on external state that isn't controlled in the test.
6. **Integration level:** test the feature through its public API or boundary, not individual private helpers.
7. **Iterate with the user:** propose test cases, explain why they matter, and refine based on feedback.

During the DESIGN phase, do not write production code. Only create or modify integration test files.

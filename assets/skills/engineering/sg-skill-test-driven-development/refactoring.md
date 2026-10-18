# Refactoring Candidates

After the TDD cycle, look for:

- **Duplication** → extract a function/class
- **Long methods** → split into private helpers (keep tests at the public interface)
- **Shallow modules** → merge or deepen
- **Feature envy** → move the logic to where the data lives
- **Primitive obsession** → introduce value objects
- **Problems in existing code revealed by the new code**

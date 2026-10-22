# manage/

Tools to manage the project. Not part of the app: the app build does not use this folder.

- `features.md`: every feature in one line: what it does, its tests, what to check by hand, its SPEC section.
  Change it with each feature change (a new feature gets a row; a new test goes in the Tests column).
- `features.mjs`: the manager.
  - `node manage/features.mjs list [query]`: the features.
  - `node manage/features.mjs check`: problems in the list, features with no automated test, tests no feature names.
  - `node manage/features.mjs test <query…>`: runs the tests of the matching features (`--dry`: only the commands).
  - `node manage/features.mjs manual <query…>`: a checklist of the checks by hand.

A query is an ID (`pdf.text`), the start of IDs (`pdf`), or a word of the name or text (`formula`).

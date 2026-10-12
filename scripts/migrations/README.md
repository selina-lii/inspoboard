# Vault migrations

One-time scripts that change a vault to a new format. See docs/SPEC.md sections 3.1 and 3.3.
The app reads all older formats: run a migration when you want the new format, not because the app needs it.

## inside-links.mjs (format 1 → 2)

Small items inside pages and saved web pages (SPEC 1.1):

- Comments and notes of a page become "inside" links. Their hidden cards next to the page go. The items, their texts, and their replies stay.
- Each link object gets its own copy of its saved web page or PDF (`web/<link object ID>.html`, `.pdf`). Two link objects with the same address get two copies.
- The old highlights and scribbles of an address go to its oldest link object. Its old comments and notes become vault items inside it. The report lists each address with more than one link object: move items to another one with the link bench.
- Nothing is deleted. The old shared files (`web/<hash>.*`) stay. A second run finds nothing to do.

Steps:

1. Close Inspoboard.
2. Dry run (writes nothing; shows the plan and the files it would write):

   ```sh
   node scripts/migrations/inside-links.mjs "/path/to/your vault"
   ```

3. Read the report. Then:

   ```sh
   node scripts/migrations/inside-links.mjs "/path/to/your vault" --apply
   ```

   It copies the whole vault into its `.backup` folder first (`.backup/<time>_before-migration`), writes the changes (each file atomically), reads the vault again, and checks it. If the check finds a problem, it says so, and your data is in the backup.

4. Open the vault in the app. When all is well, delete the backup: the backup button in the top bar lists all backups, with their sizes.

The script needs the app repository (it uses the code of the app, with `npm install` done).

// Codes for items that the user leaves without a name. All letters are capitals.

export type Random = () => number;

const DIGITS = "0123456789";
const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** The four code formats: 3 digits, 4 digits, 2 letters + 2 digits, 3 letters. */
const FORMATS: readonly string[][] = [
  [DIGITS, DIGITS, DIGITS],
  [DIGITS, DIGITS, DIGITS, DIGITS],
  [LETTERS, LETTERS, DIGITS, DIGITS],
  [LETTERS, LETTERS, LETTERS],
];

const MAX_TRIES = 50;

/** One random code in a random format. */
export function randomCode(random: Random = Math.random): string {
  const format = FORMATS[Math.floor(random() * FORMATS.length)]!;
  return format.map((characters) => characters[Math.floor(random() * characters.length)]!).join("");
}

/** A random code that is not in `taken`. After many tries it accepts a used code (names need not be unique). */
export function uniqueCode(taken: ReadonlySet<string>, random: Random = Math.random): string {
  let code = randomCode(random);
  for (let attempt = 1; attempt < MAX_TRIES && taken.has(code); attempt += 1) code = randomCode(random);
  return code;
}

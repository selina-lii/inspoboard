// Words that the core writes into documents (exports), for example "See: {0}" or "Comment".
// The UI gives a function in the UI language (t of src/ui/i18n). Without one, the words are English.

export type Words = (text: string, ...values: (string | number)[]) => string;

/** English: the text with its places ("{0}", "{t0}") filled. */
export const ENGLISH: Words = (text, ...values) =>
  text.replace(/\{t?(\d)\}/g, (whole, index: string) => {
    const value = values[Number(index)];
    return value === undefined ? whole : String(value);
  });

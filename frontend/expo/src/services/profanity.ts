// Trap Chat — Profanity Filter
// Masks words on the way to the screen. On by default.
//
// This is a display preference, so it is applied where messages are rendered
// rather than where they are sent: two people in a room can have different
// settings, and censoring at the sender would impose one person's choice on
// the other.
//
// It masks rather than deletes, so the shape of what was said survives and
// nobody is left wondering whether a message failed to arrive.
//
// Deliberately small and deliberately not clever. Aggressive matching censors
// ordinary words -- the Scunthorpe problem -- which is worse than missing
// one, so this matches whole words only.

const WORDS = [
  'fuck', 'fucking', 'fucker', 'shit', 'shitty', 'bitch', 'bastard',
  'cunt', 'dick', 'piss', 'prick', 'slut', 'whore', 'wanker', 'twat',
  'nigger', 'nigga', 'faggot', 'fag', 'retard', 'retarded', 'spastic',
  // Deliberate misspellings, spelled out rather than matched fuzzily:
  // fuzzy matching is what censors Scunthorpe.
  'fck', 'fuk', 'phuck', 'biatch', 'azz', 'byatch',
];

// Letters people substitute to slip past a filter. Kept short: every entry
// here is another way to censor an innocent word by accident.
const LEETS: Record<string, string> = {
  '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't',
  '@': 'a', '$': 's', '!': 'i', '*': '',
};

function normalise(word: string): string {
  return word
    .toLowerCase()
    .split('')
    .map((ch) => (ch in LEETS ? LEETS[ch] : ch))
    // Collapse runs: "fuuuuck" and "fuck" are the same word.
    .join('')
    .replace(/(.)\1{2,}/g, '$1');
}

const LOOKUP = new Set(WORDS.map(normalise));

/** Is this single word one of them? Exported for the tests. */
export function isProfane(word: string): boolean {
  // Two readings, because the substitutions cut both ways. "sh1t" only
  // matches once 1 becomes i, and "fuck!" only matches when the ! is dropped
  // rather than read as an i. A word is profane if either reading says so.
  const substituted = normalise(word).replace(/[^a-z]/g, '');
  const literal = word.toLowerCase().replace(/[^a-z]/g, '').replace(/(.)\1{2,}/g, '$1');
  return (
    (substituted.length > 0 && LOOKUP.has(substituted)) ||
    (literal.length > 0 && LOOKUP.has(literal))
  );
}

/**
 * Mask any profanity in `text`, preserving everything else exactly: spacing,
 * punctuation and case all survive, because a filtered message should still
 * read like the sentence somebody wrote.
 */
export function clean(text: string): string {
  return text.replace(/[\p{L}\p{N}@$!*]+/gu, (word) =>
    isProfane(word) ? '*'.repeat(word.length) : word,
  );
}

/** Apply the filter only if it is on. The call site stays a one-liner. */
export function filterIf(on: boolean, text: string): string {
  return on ? clean(text) : text;
}

// Test seam, matching the other pure services.
declare global {
  // eslint-disable-next-line no-var
  var __trapChatProfanity:
    | { clean: typeof clean; isProfane: typeof isProfane; filterIf: typeof filterIf }
    | undefined;
}
if (typeof globalThis !== 'undefined') {
  globalThis.__trapChatProfanity = { clean, isProfane, filterIf };
}

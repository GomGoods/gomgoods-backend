import { ValidateBy } from 'class-validator';

export const MAX_MESSAGE_CODE_POINTS = 2000;

// Count Unicode scalar values, like PostgreSQL char_length under UTF8, not
// UTF-16 code units or grapheme clusters. Never trim, normalize or truncate.
export function isChatMessageText(value: unknown): value is string {
  if (typeof value !== 'string' || !/\S/u.test(value)) return false;
  let count = 0;
  for (const character of value) {
    const point = character.codePointAt(0)!;
    // PostgreSQL text cannot store NUL, and lone surrogates are not valid UTF-8.
    if (point === 0 || (point >= 0xd800 && point <= 0xdfff)) return false;
    if (++count > MAX_MESSAGE_CODE_POINTS) return false;
  }
  return count > 0;
}

export function IsChatMessageText() {
  return ValidateBy({
    name: 'isChatMessageText',
    validator: {
      validate: isChatMessageText,
      defaultMessage: () =>
        'content must contain non-whitespace text of 1–2000 Unicode code points, without NUL or unpaired surrogates',
    },
  });
}

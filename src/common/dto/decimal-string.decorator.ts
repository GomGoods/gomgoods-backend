import { Matches } from 'class-validator';

export function IsMoneyString() {
  return Matches(/^(0|[1-9]\d*)(\.\d{1,2})?$/, {
    message:
      'price must be a non-negative decimal string with at most 2 decimal places',
  });
}

import { expect, test } from 'vitest';
import { todoTime } from '../src/shared/todo-time.js';

test('todoTimesPreserveSourceClockWithoutGuessingNumericUnits', () => {
  expect(todoTime('2026-11-17 04:21:15')).toEqual({
    value: 1794889275000,
    clock: 'source',
  });
  expect(todoTime('2026-11-17T13:21:15+09:00')).toEqual({
    value: 1794889275000,
    clock: 'instant',
  });
  expect(todoTime('2026-11-17T04:21:15.125Z')?.value).toBe(1794889275125);
  for (const value of [
    null,
    1794889275,
    '1794889275',
    '2026-02-30 04:21:15',
    '2026-11-17 25:00:00',
    '2026-11-17',
    'not a timestamp',
  ])
    expect(todoTime(value)).toBeNull();
});

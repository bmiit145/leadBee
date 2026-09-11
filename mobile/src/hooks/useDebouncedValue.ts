import { useEffect, useState } from 'react';

/**
 * `value`, once it has stopped changing for `delayMs`.
 *
 * Search boxes feed query keys; without this every keystroke is a request, and
 * on a mobile network the responses land out of order.
 */
export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}

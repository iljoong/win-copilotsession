import type { StoreChange } from '../shared/contracts.js';

export async function apiRequest<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body) headers.set('content-type', 'application/json');
  const response = await fetch(path, {
    ...init,
    headers,
    credentials: 'same-origin',
  });
  if (response.status === 401)
    throw new Error('Local access expired. Reopen the startup access URL.');
  const result = await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(result?.error ?? `Request failed (${response.status}).`);
  return result as T;
}

export function subscribeChanges(
  onChange: (change: StoreChange) => void,
  onReconnect: () => void,
  onStatus?: (connected: boolean) => void,
): () => void {
  if (typeof EventSource === 'undefined') {
    onStatus?.(false);
    return () => {};
  }
  const source = new EventSource('/api/events');
  source.onopen = () => {
    onStatus?.(true);
    onReconnect();
  };
  source.onerror = () => onStatus?.(false);
  source.addEventListener('change', (event) => {
    try {
      onChange(JSON.parse((event as MessageEvent).data) as StoreChange);
    } catch {
      onReconnect();
    }
  });
  return () => source.close();
}

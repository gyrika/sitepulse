import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Loads data and optionally keeps it fresh.
 *
 * - loading is true only until the first answer, so polling never flashes a spinner.
 * - data is kept when a refresh fails, and `error` says so: old data with a warning is
 *   more useful than a blank page during a brief network problem.
 * - Polling stops while the tab is hidden and refreshes as soon as it is visible again.
 * - A slow old response can never overwrite a newer one.
 */
export function useResource(fetcher, deps = [], { pollMs } = {}) {
  const [state, setState] = useState({ data: null, error: null, loading: true, refreshing: false });
  const latestRequest = useRef(0);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const reload = useCallback(async () => {
    latestRequest.current += 1;
    const requestId = latestRequest.current;
    setState((current) => ({ ...current, refreshing: true }));

    try {
      const data = await fetcherRef.current();
      if (requestId === latestRequest.current) {
        setState({ data, error: null, loading: false, refreshing: false });
      }
    } catch (error) {
      if (requestId === latestRequest.current) {
        setState((current) => ({ ...current, error, loading: false, refreshing: false }));
      }
    }
  }, []);

  useEffect(() => {
    reload();
  }, deps);

  useEffect(() => {
    if (!pollMs) return undefined;

    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') reload();
    }, pollMs);
    const onVisible = () => {
      if (document.visibilityState === 'visible') reload();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [pollMs, reload]);

  return { ...state, reload };
}

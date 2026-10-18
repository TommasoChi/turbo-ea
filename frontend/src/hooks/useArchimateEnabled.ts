/**
 * useArchimateEnabled — module-level singleton caching the ArchiMate module
 * flag (Admin → Settings → ArchiMate). Unlike the other module flags it is
 * OFF by default (initial state, failed request, bootstrap without the field):
 * the module is being rolled out and stays hidden until an admin opts in.
 */
import { useState, useEffect, useCallback } from "react";
import { api } from "@/api/client";

let _cached: boolean | null = null;
let _inflight: Promise<void> | null = null;
let _listeners: Array<(v: boolean) => void> = [];

function _notify(v: boolean) {
  _cached = v;
  _listeners.forEach((fn) => fn(v));
}

/** Prime the cache from outside the hook (`/settings/bootstrap`, Settings toggle). */
export function invalidateArchimateEnabled(v: boolean) {
  _notify(v);
}

// Every caller has just seen (or set) `_cached === null`.
function _fetch(): Promise<void> {
  if (_inflight) return _inflight;
  _inflight = (async () => {
    try {
      const res = await api.get<{ enabled: boolean }>("/settings/archimate-enabled");
      _notify(res.enabled);
    } catch {
      // default to disabled if the fetch fails
      if (_cached === null) _notify(false);
    }
  })().finally(() => {
    _inflight = null;
  });
  return _inflight;
}

export function useArchimateEnabled() {
  const [archimateEnabled, setEnabled] = useState<boolean>(_cached ?? false);
  const [archimateLoaded, setLoaded] = useState<boolean>(_cached !== null);

  useEffect(() => {
    const listener = (v: boolean) => {
      setEnabled(v);
      setLoaded(true);
    };
    _listeners.push(listener);
    if (_cached === null) {
      void _fetch();
    } else {
      setEnabled(_cached);
      setLoaded(true);
    }
    return () => {
      _listeners = _listeners.filter((fn) => fn !== listener);
    };
  }, []);

  const invalidateArchimate = useCallback((newVal?: boolean) => {
    if (newVal !== undefined) {
      _notify(newVal);
    } else {
      _cached = null;
      void _fetch();
    }
  }, []);

  return { archimateEnabled, archimateLoaded, invalidateArchimate };
}

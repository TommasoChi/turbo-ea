/**
 * useValueChainEnabled — module-level singleton caching the RAW value-chain
 * module flag (Admin → Settings → BPM Module). The flag the app acts on is the
 * conjunction with BPM: the Value Chain is a view over BPM data, so it is off
 * whenever BPM is. `valueChainRawEnabled` is the switch's own position, which
 * the Settings page must show even while BPM is off.
 */
import { useState, useEffect, useCallback } from "react";
import { api } from "@/api/client";
import { useBpmEnabled } from "@/hooks/useBpmEnabled";

let _cached: boolean | null = null;
let _inflight: Promise<void> | null = null;
let _listeners: Array<(v: boolean) => void> = [];

function _notify(v: boolean) {
  _cached = v;
  _listeners.forEach((fn) => fn(v));
}

/** Prime the cache from outside the hook (`/settings/bootstrap`, Settings toggle). */
export function invalidateValueChainEnabled(v: boolean) {
  _notify(v);
}

function _fetch(): Promise<void> {
  if (_cached !== null) return Promise.resolve();
  if (_inflight) return _inflight;
  _inflight = (async () => {
    try {
      const res = await api.get<{ enabled: boolean }>("/settings/value-chain-enabled");
      _notify(res.enabled);
    } catch {
      // default to enabled if the fetch fails
      if (_cached === null) _notify(true);
    }
  })().finally(() => {
    _inflight = null;
  });
  return _inflight;
}

export function useValueChainEnabled() {
  const { bpmEnabled, bpmLoaded } = useBpmEnabled();
  const [raw, setRaw] = useState<boolean>(_cached ?? true);
  const [loaded, setLoaded] = useState<boolean>(_cached !== null);

  useEffect(() => {
    const listener = (v: boolean) => {
      setRaw(v);
      setLoaded(true);
    };
    _listeners.push(listener);
    if (_cached === null) {
      void _fetch();
    } else {
      setRaw(_cached);
      setLoaded(true);
    }
    return () => {
      _listeners = _listeners.filter((fn) => fn !== listener);
    };
  }, []);

  const invalidate = useCallback((newVal?: boolean) => {
    if (newVal !== undefined) {
      _notify(newVal);
    } else {
      _cached = null;
      void _fetch();
    }
  }, []);

  return {
    valueChainEnabled: bpmEnabled && raw,
    valueChainRawEnabled: raw,
    valueChainLoaded: bpmLoaded && loaded,
    invalidateValueChain: invalidate,
  };
}

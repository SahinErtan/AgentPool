import { useEffect } from 'react';
import { store } from '../state/store';
import { useStore } from '../state/useStore';

const VISIBLE_MS = 3200;

/**
 * A short lived note at the bottom of the screen.
 *
 * The dashboard is a background thing, so it should never shout. A toast
 * appears, it says what happened and it goes away again.
 */
export function Toast() {
  const { toast } = useStore();

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => store.clearToast(toast.id), VISIBLE_MS);
    return () => window.clearTimeout(timer);
  }, [toast]);

  if (!toast) return null;

  return (
    <div className={`toast toast--${toast.kind}`} role="status">
      {toast.message}
    </div>
  );
}

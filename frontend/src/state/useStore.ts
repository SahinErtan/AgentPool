import { useSyncExternalStore } from 'react';
import { store, type StoreState } from './store';

/** Subscribe a component to the external store. */
export function useStore(): StoreState {
  return useSyncExternalStore(
    (listener) => store.subscribe(listener),
    () => store.get(),
  );
}

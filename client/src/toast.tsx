import { useSyncExternalStore } from 'react';

let message: string | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(l => l());

export function toast(text: string): void {
  message = text;
  clearTimeout(timer);
  timer = setTimeout(() => { message = null; emit(); }, 2400);
  emit();
}

export function Toast() {
  const text = useSyncExternalStore(cb => { listeners.add(cb); return () => listeners.delete(cb); }, () => message);
  return text ? <div className="toast" role="status">{text}</div> : null;
}

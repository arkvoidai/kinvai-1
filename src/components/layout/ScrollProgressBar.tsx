import { useReducedMotion } from '../../lib/motion';

/**
 * Reading progress is driven by the browser scroll timeline where supported.
 * No JavaScript scroll handler or layout reads are required.
 */
export function ScrollProgressBar() {
  const reduced = useReducedMotion();
  if (reduced) return null;

  return (
    <div aria-hidden="true" className="kv-scroll-progress fixed top-0 inset-x-0 h-[2px] z-[var(--z-tooltip)] pointer-events-none">
      <div className="kv-scroll-progress-fill h-full w-full origin-left bg-brand" />
    </div>
  );
}

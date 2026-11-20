import { bus } from './bus';

/** Sections announce themselves; the Field decides what that means. */
export function observeSections(): void {
  const visible = new Set<string>();
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        const id = (e.target as HTMLElement).dataset.section!;
        if (e.isIntersecting && !visible.has(id)) {
          visible.add(id);
          bus.emit('section:enter', { id, rect: e.boundingClientRect });
        } else if (!e.isIntersecting && visible.has(id)) {
          visible.delete(id);
          bus.emit('section:leave', { id });
        }
      }
    },
    { threshold: 0, rootMargin: '-35% 0px -35% 0px' },
  );
  document.querySelectorAll<HTMLElement>('[data-section]').forEach((el) => io.observe(el));
}

/**
 * Moving between pages without a reload, once the field is running. A full page load starts the
 * particle field from scratch (a second of building and compiling on the main thread), which froze
 * the title's glide halfway and stopped every particle on arrival. Here the next page is fetched
 * while this one stays live, then header, main and footer are swapped inside a same-document view
 * transition: titles still glide, and the field keeps running underneath throughout.
 *
 * Loaded after the field's first frame. Until then, or without it, links are ordinary links and
 * the cross-document transition in transitions.css applies. Any failure falls back to loading the
 * page normally.
 */

export type NavHooks = {
  /** The new page is in the DOM and scrolled; slug: the project whose card was clicked, if any. */
  swapped(slug: string | undefined): void;
  /** The glide has finished: a good moment for work that would stutter it. */
  settled(): void;
};

type VT = { finished: Promise<void>; updateCallbackDone: Promise<void> };
type StartVT = (cb: () => void) => VT;

const cache = new Map<string, Promise<string>>();
const KEEP = '.field-layer, body > output';

function page(url: URL): string {
  return url.pathname.replace(/\.html$/, '').replace(/\/$/, '') || '/';
}

/** A link this script may follow: same site, a page (not a file), a different page from this one. */
function eligible(a: HTMLAnchorElement | null): URL | null {
  if (!a || a.target || a.hasAttribute('download') || a.dataset.reload !== undefined) return null;
  const url = new URL(a.href, location.href);
  if (url.origin !== location.origin || /\.[a-z0-9]+$/i.test(url.pathname.replace(/\.html$/, ''))) return null;
  if (page(url) === page(new URL(location.href))) return null;
  return url;
}

function load(url: URL): Promise<string> {
  const key = page(url);
  let p = cache.get(key);
  if (!p) {
    p = fetch(url.pathname, { credentials: 'same-origin' }).then((r) => {
      if (!r.ok || !r.headers.get('content-type')?.includes('text/html')) throw new Error(`${r.status}`);
      return r.text();
    });
    p.catch(() => cache.delete(key));
    cache.set(key, p);
  }
  return p;
}

export function enableNav(hooks: NavHooks): void {
  if (!('DOMParser' in window)) return;
  const root = document.documentElement;
  const start = (document as Document & { startViewTransition?: StartVT }).startViewTransition?.bind(document);
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  history.scrollRestoration = 'manual';
  history.replaceState({ ...(history.state ?? {}), nav: 1, y: scrollY }, '');
  let busy = false;
  let current = page(new URL(location.href));

  // Fetch on hover or focus, so the page is usually here by the time of the click.
  let hoverTimer = 0;
  const warm = (e: Event) => {
    const url = eligible((e.target as Element | null)?.closest?.('a') ?? null);
    clearTimeout(hoverTimer);
    if (url) hoverTimer = window.setTimeout(() => void load(url).catch(() => {}), e.type === 'pointerover' ? 60 : 0);
  };
  document.addEventListener('pointerover', warm, { passive: true });
  document.addEventListener('focusin', warm);
  document.addEventListener('touchstart', warm, { passive: true });

  async function go(url: URL, push: boolean, y = 0, slug?: string): Promise<void> {
    if (busy) return;
    busy = true;
    let html: string;
    try {
      html = await load(url);
    } catch {
      location.href = url.href;
      return;
    }
    const doc = new DOMParser().parseFromString(html, 'text/html');
    if (push) {
      history.replaceState({ ...(history.state ?? {}), nav: 1, y: scrollY }, '');
      history.pushState({ nav: 1, y: 0 }, '', url.href);
    }
    const swap = () => {
      performance.mark('nav:swap');
      swapHead(doc);
      const body = document.body;
      for (const el of Array.from(body.children)) if (!el.matches(KEEP)) el.remove();
      for (const el of Array.from(doc.body.children)) if (el.tagName !== 'SCRIPT') body.append(document.adoptNode(el));
      const target = url.hash ? document.getElementById(decodeURIComponent(url.hash.slice(1))) : null;
      if (target) target.scrollIntoView();
      else scrollTo(0, y);
      document.querySelector<HTMLElement>('main')?.focus({ preventScroll: true });
      current = page(url);
      hooks.swapped(slug);
      performance.mark('nav:swapped');
    };
    try {
      if (start && !reduced.matches) {
        root.dataset.nav = '';
        const vt = start(swap);
        await vt.finished.catch(() => {});
        delete root.dataset.nav;
      } else swap();
    } catch {
      location.href = url.href;
      return;
    } finally {
      busy = false;
    }
    performance.mark('nav:settled');
    hooks.settled();
    performance.mark('nav:measured');
  }

  document.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = (e.target as Element | null)?.closest?.('a') ?? null;
    const url = eligible(a);
    if (!url) return;
    e.preventDefault();
    const slug = url.pathname.match(/^\/work\/([^/.]+)/)?.[1];
    // Only a card's own link carries its dots across; the slug must be a card on this page.
    const fromCard = slug && a!.closest(`[data-thread-target="${slug}"]`) ? slug : undefined;
    void go(url, true, 0, fromCard);
  });

  addEventListener('popstate', (e) => {
    const url = new URL(location.href);
    // Only the hash changed: the browser has already scrolled.
    if (page(url) === current) return;
    const y = (e.state as { y?: number } | null)?.y ?? 0;
    void go(url, false, y);
  });
}

/** Title, description, canonical, social tags and the page's inlined styles. */
function swapHead(doc: Document): void {
  document.title = doc.title;
  const sel = 'style, link[rel="stylesheet"], link[rel="canonical"], meta[name="description"], meta[property^="og:"], meta[name^="twitter:"]';
  const head = document.head;
  const old = Array.from(head.querySelectorAll(sel));
  // New styles go in before the old ones come out, so nothing is ever unstyled.
  for (const el of Array.from(doc.head.querySelectorAll(sel))) head.append(document.adoptNode(el));
  old.forEach((el) => el.remove());
}

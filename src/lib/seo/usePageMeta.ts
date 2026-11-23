import { useEffect } from 'react';

export interface PageMetaOptions {
  title: string;
  description?: string;
  noindex?: boolean;
  ogImage?: string | null;
}

function upsertMeta(selector: string, attrName: 'name' | 'property', attrValue: string, content: string): void {
  let meta = document.querySelector<HTMLMetaElement>(selector);
  if (!meta) {
    meta = document.createElement('meta');
    meta.setAttribute(attrName, attrValue);
    document.head.appendChild(meta);
  }
  meta.content = content;
}

export function usePageMeta({ title, description, noindex = false, ogImage }: PageMetaOptions): void {
  useEffect(() => {
    document.title = title;
    upsertMeta('meta[property="og:title"]', 'property', 'og:title', title);

    if (description) {
      upsertMeta('meta[name="description"]', 'name', 'description', description);
      upsertMeta('meta[property="og:description"]', 'property', 'og:description', description);
    }

    if (ogImage) {
      upsertMeta('meta[property="og:image"]', 'property', 'og:image', ogImage);
      upsertMeta('meta[name="twitter:image"]', 'name', 'twitter:image', ogImage);
    } else {
      document.querySelector('meta[property="og:image"]')?.remove();
      document.querySelector('meta[name="twitter:image"]')?.remove();
    }

    const existingRobots = document.querySelector<HTMLMetaElement>('meta[name="robots"]');
    if (noindex) {
      if (existingRobots) {
        existingRobots.content = 'noindex, nofollow';
      } else {
        const meta = document.createElement('meta');
        meta.name = 'robots';
        meta.content = 'noindex, nofollow';
        document.head.appendChild(meta);
      }
    } else if (existingRobots) {
      existingRobots.remove();
    }
  }, [title, description, noindex, ogImage]);
}

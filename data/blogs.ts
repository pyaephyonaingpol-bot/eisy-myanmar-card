/**
 * Typed contract for the file-based Guides blog.
 * Runtime content lives in data/blogs.js (consumed by
 * backend/scripts/build-blog-pages.js).
 *
 * This Express SPA deploy does not use Next.js App Router, but the SSG
 * builder mirrors:
 *   app/blog/page.tsx
 *   app/blog/[slug]/page.tsx  (generateStaticParams + generateMetadata)
 *   app/sitemap.ts
 */

export type BlogBlock =
  | { type: 'p'; text: string }
  | { type: 'note'; text: string }
  | { type: 'ul' | 'ol'; items: string[] };

export type BlogSection = {
  heading: string;
  blocks: BlogBlock[];
};

export type BlogPost = {
  slug: string;
  title: string;
  description: string;
  keywords: string[];
  locale: string;
  lang: string;
  publishedAt: string;
  updatedAt: string;
  readingMinutes: number;
  heroLabel: string;
  sections: BlogSection[];
};

export type BlogModule = {
  SITE_ORIGIN: string;
  posts: BlogPost[];
  getAllPosts: () => BlogPost[];
  getPostBySlug: (slug: string) => BlogPost | null;
  getAllSlugs: () => string[];
};

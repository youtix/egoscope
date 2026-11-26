import type { MetadataRoute } from 'next';

/**
 * /robots.txt, which answers without a session: every search engine is asked to stay
 * away from every address, since no data of the app is public (TRV-58, CL-TRV-13).
 */
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: '*', disallow: '/' } };
}

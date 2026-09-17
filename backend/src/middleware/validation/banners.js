import { z } from 'zod';
import { localizedFieldSchema } from './common.js';

// Banner validation schemas — strict: rejects unknown fields, oversized strings, invalid types
export const bannerSchema = z.object({
  title: localizedFieldSchema(150),
  subtitle: localizedFieldSchema(300).optional(),
  badgeText: localizedFieldSchema(100).optional(),
  buttonText: localizedFieldSchema(100).optional(),
  ctaText: localizedFieldSchema(100).optional(),
  link: z.string().max(300).optional(),
  ctaLink: z.string().max(300).optional(),
  image: z.string().max(500).optional(),
  placement: z.enum(['home_hero', 'home_middle', 'top_announcement', 'promo_bar', 'hero', 'homepage-strip', 'shop-top', 'sidebar', 'popup']).optional(),
  displayOrder: z.number().int().nonnegative().optional(),
  isActive: z.boolean().optional()
}).strict();

export const updateBannerSchema = z.object({
  title: localizedFieldSchema(150).optional(),
  subtitle: localizedFieldSchema(300).optional(),
  badgeText: localizedFieldSchema(100).optional(),
  buttonText: localizedFieldSchema(100).optional(),
  ctaText: localizedFieldSchema(100).optional(),
  link: z.string().max(300).optional(),
  ctaLink: z.string().max(300).optional(),
  image: z.string().max(500).optional(),
  placement: z.enum(['home_hero', 'home_middle', 'top_announcement', 'promo_bar', 'hero', 'homepage-strip', 'shop-top', 'sidebar', 'popup']).optional(),
  displayOrder: z.number().int().nonnegative().optional(),
  isActive: z.boolean().optional()
}).strict();

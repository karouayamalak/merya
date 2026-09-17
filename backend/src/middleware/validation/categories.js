import { z } from 'zod';
import { localizedFieldSchema } from './common.js';

// Category validation schemas — strict: rejects unknown fields, oversized strings, invalid types
export const categorySchema = z.object({
  name: localizedFieldSchema(100),
  description: localizedFieldSchema(1000).optional(),
  image: z.string().min(1, 'Category image URL/path is required').max(500, 'Image URL too long'),
  displayOrder: z.number().int().nonnegative().optional(),
  isActive: z.boolean().optional()
}).strict();

export const updateCategorySchema = z.object({
  name: localizedFieldSchema(100).optional(),
  description: localizedFieldSchema(1000).optional(),
  image: z.string().min(1).max(500).optional(),
  displayOrder: z.number().int().nonnegative().optional(),
  isActive: z.boolean().optional(),
  isArchived: z.boolean().optional()
}).strict();

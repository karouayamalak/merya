import { z } from 'zod';

export const validate = (schema) => (req, res, next) => {
  try {
    const parsed = schema.parse(req.body);
    req.body = parsed;
    next();
  } catch (error) {
    if (error instanceof z.ZodError) {
      const issues = error.errors.map(e => `${e.path.join('.')}: ${e.message}`);
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: issues
      });
    }
    next(error);
  }
};

export const localizedStringSchema = z.union([
  z.string(),
  z.object({
    fr: z.string().optional().default(''),
    ar: z.string().optional().default(''),
    en: z.string().optional().default('')
  })
]);

export const multilingualStringSchema = (maxLength = 150) => z.object({
  fr: z.string({ invalid_type_error: 'French translation must be a string' }).max(maxLength).nullable().optional().transform(v => (v ?? '').trim()),
  ar: z.string({ invalid_type_error: 'Arabic translation must be a string' }).max(maxLength).nullable().optional().transform(v => (v ?? '').trim()),
  en: z.string({ invalid_type_error: 'English translation must be a string' }).max(maxLength).nullable().optional().transform(v => (v ?? '').trim())
}, { invalid_type_error: 'Must be an object with language keys: fr, ar, en' });

export const localizedFieldSchema = (maxLength = 150) => z.union([
  multilingualStringSchema(maxLength),
  z.string().max(maxLength).transform(s => ({ fr: s.trim(), ar: '', en: '' })),
  z.null().transform(() => ({ fr: '', ar: '', en: '' })),
  z.undefined().transform(() => ({ fr: '', ar: '', en: '' }))
]);

export function validateVariantUniqueness(colors, ctx) {
  if (!Array.isArray(colors)) return;
  const seenColors = new Set();
  for (let i = 0; i < colors.length; i++) {
    const c = colors[i];
    const normColor = c.colorName?.trim().toLowerCase();
    if (seenColors.has(normColor)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['colors', i, 'colorName'],
        message: `Duplicate colorName "${c.colorName}". Color names must be unique (case-insensitive).`
      });
    }
    seenColors.add(normColor);

    if (Array.isArray(c.sizes)) {
      const seenSizes = new Set();
      for (let j = 0; j < c.sizes.length; j++) {
        const s = c.sizes[j];
        if (seenSizes.has(s.size)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['colors', i, 'sizes', j, 'size'],
            message: `Duplicate size "${s.size}" in color "${c.colorName}". Sizes per color must be unique.`
          });
        }
        seenSizes.add(s.size);
      }
    }
  }
}

import { Category, isCategoryFullyTranslated } from '../models/Category.js';

export const getCategoryTranslationStatus = (category) => {
  const name = typeof category?.name === 'object' && category?.name !== null ? category.name : { fr: category?.name || '' };
  const desc = typeof category?.description === 'object' && category?.description !== null ? category.description : { fr: category?.description || '' };

  const hasNameFr = Boolean(name.fr && name.fr.trim());
  const hasNameAr = Boolean(name.ar && name.ar.trim());
  const hasNameEn = Boolean(name.en && name.en.trim());

  const hasDescFr = Boolean(desc.fr && desc.fr.trim());
  const hasDescAr = Boolean(desc.ar && desc.ar.trim());
  const hasDescEn = Boolean(desc.en && desc.en.trim());

  const hasFr = hasNameFr && hasDescFr;
  const hasAr = hasNameAr && hasDescAr;
  const hasEn = hasNameEn && hasDescEn;

  return {
    fr: hasFr,
    ar: hasAr,
    en: hasEn,
    name: { fr: hasNameFr, ar: hasNameAr, en: hasNameEn },
    description: { fr: hasDescFr, ar: hasDescAr, en: hasDescEn },
    isComplete: hasFr && hasAr && hasEn,
    missing: [
      !hasFr && 'fr',
      !hasAr && 'ar',
      !hasEn && 'en'
    ].filter(Boolean),
    descComplete: Boolean(hasDescFr && hasDescAr && hasDescEn)
  };
};

const extractBaseName = (name) => {
  if (!name) return '';
  if (typeof name === 'string') return name;
  return name.fr || name.en || name.ar || '';
};

// Public: Get active, non-archived categories sorted by displayOrder.
// Defense-in-depth: enforces translation completeness so incomplete/legacy records are never exposed.
export const getCategories = async (req, res, next) => {
  try {
    const rawCategories = await Category.find({
      isActive: true,
      isArchived: false
    }).sort({ displayOrder: 1, createdAt: 1 });

    const categories = rawCategories.filter(cat => isCategoryFullyTranslated(cat));

    res.json({ success: true, count: categories.length, categories });
  } catch (error) {
    next(error);
  }
};

// Admin: Get all categories including archived/inactive with translation statuses
export const getAllCategoriesAdmin = async (req, res, next) => {
  try {
    const categories = await Category.find().sort({ displayOrder: 1, createdAt: -1 });
    const categoriesWithStatus = categories.map((cat) => {
      const catObj = cat.toObject ? cat.toObject({ getters: true }) : cat;
      return {
        ...catObj,
        translationStatus: getCategoryTranslationStatus(cat)
      };
    });
    res.json({ success: true, count: categoriesWithStatus.length, categories: categoriesWithStatus });
  } catch (error) {
    next(error);
  }
};

// Admin: Create category
export const createCategory = async (req, res, next) => {
  try {
    const { name, description, image, displayOrder, isActive } = req.body;

    const baseName = extractBaseName(name);
    if (!baseName.trim()) {
      return res.status(400).json({ success: false, message: 'Category name in at least French or default language is required' });
    }

    const baseSlug = baseName
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, '')
      .replace(/[\s_-]+/g, '-')
      .replace(/^-+|-+$/g, '') || `cat-${Date.now()}`;

    let slug = baseSlug;
    let counter = 1;
    while (await Category.findOne({ slug })) {
      slug = `${baseSlug}-${counter}`;
      counter++;
    }

    const isComplete = isCategoryFullyTranslated({ name, description });

    // Publishing requires complete French, Arabic, and English translations
    if (isActive === true && !isComplete) {
      return res.status(400).json({
        success: false,
        code: 'TRANSLATIONS_INCOMPLETE',
        message: 'Cannot publish category: complete name and description translations in French, Arabic, and English are required before publishing. Please provide all translations or save as an unpublished draft.'
      });
    }

    // When isActive is omitted: only activate if complete, otherwise safely default to inactive draft
    const effectiveIsActive = isActive !== undefined ? Boolean(isActive) : isComplete;

    const category = new Category({
      name,
      slug,
      description,
      image,
      displayOrder: displayOrder ?? 0,
      isActive: effectiveIsActive
    });

    await category.save();
    const catObj = category.toObject({ getters: true });
    catObj.translationStatus = getCategoryTranslationStatus(category);

    res.status(201).json({ success: true, category: catObj });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: 'A category with this name or slug already exists. Please choose a distinct name.'
      });
    }
    next(error);
  }
};

// Admin: Update category
export const updateCategory = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, description, image, displayOrder, isActive } = req.body;

    const category = await Category.findById(id);
    if (!category) {
      return res.status(404).json({ success: false, message: 'Category not found' });
    }

    if (name !== undefined) {
      if (typeof name === 'object' && name !== null) {
        const existingName = typeof category.name === 'object' && category.name !== null ? category.name : { fr: category.name || '', ar: '', en: '' };
        category.name = {
          fr: name.fr !== undefined ? name.fr : existingName.fr || '',
          ar: name.ar !== undefined ? name.ar : existingName.ar || '',
          en: name.en !== undefined ? name.en : existingName.en || ''
        };
      } else {
        category.name = name;
      }

      // Update slug safely with unique collision check
      const baseName = extractBaseName(category.name);
      if (baseName) {
        const baseSlug = baseName
          .toLowerCase()
          .trim()
          .replace(/[^\w\s-]/g, '')
          .replace(/[\s_-]+/g, '-')
          .replace(/^-+|-+$/g, '') || category.slug;

        if (baseSlug !== category.slug) {
          let newSlug = baseSlug;
          let counter = 1;
          while (await Category.findOne({ slug: newSlug, _id: { $ne: id } })) {
            newSlug = `${baseSlug}-${counter}`;
            counter++;
          }
          category.slug = newSlug;
        }
      }
    }

    if (description !== undefined) {
      if (typeof description === 'object' && description !== null) {
        const existingDesc = typeof category.description === 'object' && category.description !== null ? category.description : { fr: category.description || '', ar: '', en: '' };
        category.description = {
          fr: description.fr !== undefined ? description.fr : existingDesc.fr || '',
          ar: description.ar !== undefined ? description.ar : existingDesc.ar || '',
          en: description.en !== undefined ? description.en : existingDesc.en || ''
        };
      } else {
        category.description = description;
      }
    }

    if (image !== undefined) category.image = image;
    if (displayOrder !== undefined) category.displayOrder = displayOrder;
    if (isActive !== undefined) category.isActive = isActive;

    // Require complete translations if attempting to publish or remain active
    if (category.isActive === true) {
      const isComplete = isCategoryFullyTranslated(category);
      if (!isComplete) {
        return res.status(400).json({
          success: false,
          code: 'TRANSLATIONS_INCOMPLETE',
          message: 'Cannot publish category: complete name and description translations in French, Arabic, and English are required before publishing. Please provide all translations or save as an unpublished draft.'
        });
      }
    }

    await category.save();
    const catObj = category.toObject({ getters: true });
    catObj.translationStatus = getCategoryTranslationStatus(category);

    res.json({ success: true, category: catObj });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: 'A category with this name or slug already exists. Please choose a distinct name.'
      });
    }
    next(error);
  }
};

// Admin: Soft delete / archive category (preserving historical integrity)
export const archiveCategory = async (req, res, next) => {
  try {
    const { id } = req.params;
    const category = await Category.findById(id);
    if (!category) {
      return res.status(404).json({ success: false, message: 'Category not found' });
    }

    category.isArchived = true;
    category.isActive = false;
    await category.save();

    res.json({ success: true, message: 'Category archived successfully (preserved for historical orders)' });
  } catch (error) {
    next(error);
  }
};

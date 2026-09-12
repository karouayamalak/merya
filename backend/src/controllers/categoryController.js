import { Category } from '../models/Category.js';

export const getCategoryTranslationStatus = (category) => {
  const name = typeof category.name === 'object' && category.name !== null ? category.name : { fr: category.name || '' };
  const desc = typeof category.description === 'object' && category.description !== null ? category.description : { fr: category.description || '' };

  const hasFr = Boolean(name.fr && name.fr.trim());
  const hasAr = Boolean(name.ar && name.ar.trim());
  const hasEn = Boolean(name.en && name.en.trim());

  return {
    fr: hasFr,
    ar: hasAr,
    en: hasEn,
    isComplete: hasFr && hasAr && hasEn,
    missing: [
      !hasFr && 'fr',
      !hasAr && 'ar',
      !hasEn && 'en'
    ].filter(Boolean),
    descComplete: Boolean(desc.fr && desc.ar && desc.en)
  };
};

const extractBaseName = (name) => {
  if (!name) return '';
  if (typeof name === 'string') return name;
  return name.fr || name.en || name.ar || '';
};

// Public: Get active, non-archived categories sorted by displayOrder
export const getCategories = async (req, res, next) => {
  try {
    const categories = await Category.find({
      isActive: true,
      isArchived: false
    }).sort({ displayOrder: 1, createdAt: 1 });

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

    const slug = baseName
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, '')
      .replace(/[\s_-]+/g, '-')
      .replace(/^-+|-+$/g, '') || `cat-${Date.now()}`;

    const existing = await Category.findOne({ slug });
    if (existing) {
      return res.status(400).json({ success: false, message: 'Category with this name/slug already exists' });
    }

    const category = new Category({
      name,
      slug,
      description,
      image,
      displayOrder: displayOrder ?? 0,
      isActive: isActive !== undefined ? isActive : true
    });

    await category.save();
    const catObj = category.toObject({ getters: true });
    catObj.translationStatus = getCategoryTranslationStatus(category);

    res.status(201).json({ success: true, category: catObj });
  } catch (error) {
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

      // Update slug only if changed French base
      const baseName = extractBaseName(category.name);
      if (baseName) {
        category.slug = baseName
          .toLowerCase()
          .trim()
          .replace(/[^\w\s-]/g, '')
          .replace(/[\s_-]+/g, '-')
          .replace(/^-+|-+$/g, '') || category.slug;
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

    await category.save();
    const catObj = category.toObject({ getters: true });
    catObj.translationStatus = getCategoryTranslationStatus(category);

    res.json({ success: true, category: catObj });
  } catch (error) {
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

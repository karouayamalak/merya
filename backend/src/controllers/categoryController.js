import { Category } from '../models/Category.js';

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

// Admin: Get all categories including archived/inactive
export const getAllCategoriesAdmin = async (req, res, next) => {
  try {
    const categories = await Category.find().sort({ displayOrder: 1, createdAt: -1 });
    res.json({ success: true, count: categories.length, categories });
  } catch (error) {
    next(error);
  }
};

// Admin: Create category
export const createCategory = async (req, res, next) => {
  try {
    const { name, description, image, displayOrder, isActive } = req.body;

    const slug = name
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, '')
      .replace(/[\s_-]+/g, '-')
      .replace(/^-+|-+$/g, '');

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
    res.status(201).json({ success: true, category });
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

    if (name && name !== category.name) {
      category.name = name;
      category.slug = name
        .toLowerCase()
        .trim()
        .replace(/[^\w\s-]/g, '')
        .replace(/[\s_-]+/g, '-')
        .replace(/^-+|-+$/g, '');
    }

    if (description !== undefined) category.description = description;
    if (image !== undefined) category.image = image;
    if (displayOrder !== undefined) category.displayOrder = displayOrder;
    if (isActive !== undefined) category.isActive = isActive;

    await category.save();
    res.json({ success: true, category });
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

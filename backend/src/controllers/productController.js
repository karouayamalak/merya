import { Product } from '../models/Product.js';
import { Category } from '../models/Category.js';
import { Order } from '../models/Order.js';
import { ORDER_STATUS } from '../config/constants.js';

// Safely escape regex metacharacters to prevent injection / catastrophic backtracking
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function getTranslationStatus(entity) {
  const name = typeof entity?.name === 'object' && entity?.name !== null ? entity.name : { fr: entity?.name || '' };
  const desc = typeof entity?.description === 'object' && entity?.description !== null ? entity.description : { fr: entity?.description || '' };

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
    hasFr,
    hasAr,
    hasEn,
    name: { fr: hasNameFr, ar: hasNameAr, en: hasNameEn },
    description: { fr: hasDescFr, ar: hasDescAr, en: hasDescEn },
    isComplete: hasFr && hasAr && hasEn,
    missing: [!hasFr && 'fr', !hasAr && 'ar', !hasEn && 'en'].filter(Boolean)
  };
}

// Public: Get active products with filtering, search, and pagination
export const getProducts = async (req, res, next) => {
  try {
    const { category, isBestSeller, search, minPrice, maxPrice, page = 1, limit = 24, sort } = req.query;

    const filter = {
      isActive: true,
      isArchived: false
    };

    if (category) {
      // Allow filtering by either category ID or category slug
      const catDoc = await Category.findOne({
        $or: [{ _id: category.match(/^[0-9a-fA-F]{24}$/) ? category : null }, { slug: category }]
      });
      if (catDoc) {
        filter.category = catDoc._id;
      }
    }

    if (isBestSeller === 'true') {
      filter.isBestSeller = true;
    }

    if (search && search.trim()) {
      const raw = search.trim().slice(0, 100); // cap at 100 chars
      const escaped = escapeRegex(raw);
      const regex = { $regex: escaped, $options: 'i' };
      filter.$or = [
        { 'name.fr': regex },
        { 'name.ar': regex },
        { 'name.en': regex },
        { 'description.fr': regex },
        { 'description.ar': regex },
        { 'description.en': regex },
        { name: regex },
        { description: regex }
      ];
    }

    if (minPrice !== undefined || maxPrice !== undefined) {
      const min = minPrice !== undefined ? Number(minPrice) : undefined;
      const max = maxPrice !== undefined ? Number(maxPrice) : undefined;
      if (min !== undefined && (!Number.isFinite(min) || min < 0)) {
        return res.status(400).json({ success: false, message: 'minPrice must be a non-negative number.' });
      }
      if (max !== undefined && (!Number.isFinite(max) || max < 0)) {
        return res.status(400).json({ success: false, message: 'maxPrice must be a non-negative number.' });
      }
      if (min !== undefined && max !== undefined && min > max) {
        return res.status(400).json({ success: false, message: 'minPrice cannot be greater than maxPrice.' });
      }
      filter.sellingPrice = {};
      if (min !== undefined) filter.sellingPrice.$gte = min;
      if (max !== undefined) filter.sellingPrice.$lte = max;
    }

    const pageNum = Math.max(1, parseInt(page, 10));
    const limitNum = Math.min(50, Math.max(1, parseInt(limit, 10)));
    const skip = (pageNum - 1) * limitNum;

    // Server-side sorting
    let sortOption = { createdAt: -1 }; // default: newest
    if (sort === 'price-asc') {
      sortOption = { sellingPrice: 1 };
    } else if (sort === 'price-desc') {
      sortOption = { sellingPrice: -1 };
    } else if (sort === 'name-asc') {
      sortOption = { 'name.fr': 1 };
    }

    const [products, total] = await Promise.all([
      Product.find(filter)
        .select('-costPrice') // Do not expose cost price to public!
        .populate('category', 'name slug')
        .sort(sortOption)
        .skip(skip)
        .limit(limitNum),
      Product.countDocuments(filter)
    ]);

    if (typeof res.setHeader === 'function') {
      res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    }
    res.json({
      success: true,
      products,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum)
      }

    });
  } catch (error) {
    next(error);
  }
};

// Public: Get single product by slug
export const getProductBySlug = async (req, res, next) => {
  try {
    const { slug } = req.params;

    const product = await Product.findOne({ slug, isActive: true, isArchived: false })
      .select('-costPrice')
      .populate('category', 'name slug');

    if (!product) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }

    res.setHeader('Cache-Control', 'no-cache, must-revalidate');

    // Related products in the same category
    const relatedProducts = await Product.find({
      category: product.category._id,
      _id: { $ne: product._id },
      isActive: true,
      isArchived: false
    })
      .select('-costPrice')
      .limit(4);

    res.json({ success: true, product, relatedProducts });
  } catch (error) {
    next(error);
  }
};

// Admin: Get all products with costPrice and total stock calculation
export const getAllProductsAdmin = async (req, res, next) => {
  try {
    const { search, category, isActive, page = 1, limit = 50 } = req.query;

    const filter = {};
    if (search && search.trim()) {
      const raw = search.trim().slice(0, 200); // cap at 200 chars
      const escaped = escapeRegex(raw);
      const regex = { $regex: escaped, $options: 'i' };
      filter.$or = [
        { 'name.fr': regex },
        { 'name.ar': regex },
        { 'name.en': regex },
        { 'description.fr': regex },
        { 'description.ar': regex },
        { 'description.en': regex },
        { name: regex },
        { description: regex }
      ];
    }
    if (category) filter.category = category;
    if (isActive !== undefined) filter.isActive = isActive === 'true';

    const pageNum = Math.max(1, parseInt(page, 10));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
    const skip = (pageNum - 1) * limitNum;

    const [products, total] = await Promise.all([
      Product.find(filter)
        .populate('category', 'name slug')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum),
      Product.countDocuments(filter)
    ]);

    // Calculate aggregate stock across all color/size variants for quick overview
    const enrichedProducts = products.map(p => {
      const doc = p.toObject();
      let totalStock = 0;
      doc.colors.forEach(c => {
        c.sizes.forEach(s => {
          totalStock += s.stock;
        });
      });
      doc.totalStock = totalStock;
      doc.translationStatus = getTranslationStatus(doc);
      return doc;
    });

    res.json({
      success: true,
      products: enrichedProducts,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum)
      }
    });
  } catch (error) {
    next(error);
  }
};

// Admin: Get single product by ID
export const getProductByIdAdmin = async (req, res, next) => {
  try {
    const product = await Product.findById(req.params.id).populate('category', 'name slug');
    if (!product) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }
    const doc = product.toObject();
    doc.translationStatus = getTranslationStatus(doc);
    res.json({ success: true, product: doc });
  } catch (error) {
    next(error);
  }
};

// Admin: Create product
export const createProduct = async (req, res, next) => {
  try {
    const { name, description, category, sellingPrice, basePrice, costPrice, promotion, isActive, isBestSeller, colors } = req.body;
    const effectiveBasePrice = sellingPrice ?? basePrice;

    const nameForSlug = typeof name === 'object' && name ? (name.fr || name.en || name.ar || '') : (name || '');
    const baseSlug = String(nameForSlug)
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, '')
      .replace(/[\s_-]+/g, '-')
      .replace(/^-+|-+$/g, '') || `product-${Date.now()}`;

    let slug = baseSlug;
    let counter = 1;
    while (await Product.findOne({ slug })) {
      slug = `${baseSlug}-${counter}`;
      counter++;
    }

    // Strip any client-provided stock values — inventory boundary enforcement.
    // All new variants always start at stock = 0.
    // Stock must be set through the inventory adjustment endpoint (POST /admin/inventory/adjust).
    const sanitizedColors = (colors || []).map(color => ({
      colorName: color.colorName,
      colorDisplayName: color.colorDisplayName || { fr: '', ar: '', en: '' },
      colorCode: color.colorCode,
      images: color.images || [],
      sizes: (color.sizes || []).map(s => ({
        size: s.size,
        stock: 0   // always zero regardless of what the client sends
      }))
    }));

    if (typeof effectiveBasePrice !== 'number' || !Number.isInteger(effectiveBasePrice) || effectiveBasePrice <= 0) {
      return res.status(400).json({ success: false, message: 'sellingPrice must be a positive integer in DZD.' });
    }
    if (typeof costPrice !== 'number' || !Number.isInteger(costPrice) || costPrice < 0) {
      return res.status(400).json({ success: false, message: 'costPrice must be a non-negative integer in DZD.' });
    }

    let parsedPromotion = { active: false, promotionalPrice: null };
    if (promotion && promotion.active === true) {
      const pPrice = promotion.promotionalPrice;
      if (typeof pPrice !== 'number' || !Number.isInteger(pPrice) || pPrice <= 0) {
        return res.status(400).json({ success: false, message: 'promotionalPrice must be a positive integer in DZD when promotion is active.' });
      }
      if (pPrice >= effectiveBasePrice) {
        return res.status(400).json({ success: false, message: 'Promotional price must be strictly lower than base price.' });
      }
      parsedPromotion = { active: true, promotionalPrice: pPrice };
    }

    const isComplete = Boolean(
      name && typeof name === 'object' && name.fr?.trim() && name.ar?.trim() && name.en?.trim() &&
      description && typeof description === 'object' && description.fr?.trim() && description.ar?.trim() && description.en?.trim()
    );

    // Publishing requires complete French, Arabic, and English translations for both name and description
    if (isActive === true && !isComplete) {
      return res.status(400).json({
        success: false,
        code: 'TRANSLATIONS_INCOMPLETE',
        message: 'Cannot publish product: complete name and description translations in French, Arabic, and English are required before publishing. Please provide all translations or save as an unpublished draft.'
      });
    }

    const effectiveIsActive = isActive !== undefined ? Boolean(isActive) : true;

    const product = new Product({
      name,
      slug,
      description,
      category,
      sellingPrice: effectiveBasePrice,
      costPrice,
      promotion: parsedPromotion,
      isActive: effectiveIsActive,
      isBestSeller: !!isBestSeller,
      colors: sanitizedColors
    });

    await product.save();
    res.status(201).json({ success: true, product });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: 'A product with this name or slug already exists. Please choose a distinct name.'
      });
    }
    next(error);
  }
};


// Admin: Update product
export const updateProduct = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, description, category, sellingPrice, basePrice, costPrice, promotion, isActive, isBestSeller, isArchived, colors } = req.body;

    const product = await Product.findById(id);
    if (!product) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }

    if (name !== undefined) {
      const oldFr = typeof product.name === 'object' ? product.name.fr : product.name;
      if (typeof name === 'object' && name !== null) {
        const currentName = typeof product.name === 'object' ? product.name : { fr: product.name || '', ar: '', en: '' };
        product.name = {
          fr: name.fr !== undefined ? name.fr : (currentName.fr || ''),
          ar: name.ar !== undefined ? name.ar : (currentName.ar || ''),
          en: name.en !== undefined ? name.en : (currentName.en || '')
        };
      } else if (typeof name === 'string') {
        const currentName = typeof product.name === 'object' ? product.name : {};
        product.name = {
          ...currentName,
          fr: name.trim()
        };
      }

      const newFr = typeof product.name === 'object' ? product.name.fr : product.name;
      if (newFr && newFr !== oldFr) {
        const baseSlug = String(newFr)
          .toLowerCase()
          .trim()
          .replace(/[^\w\s-]/g, '')
          .replace(/[\s_-]+/g, '-')
          .replace(/^-+|-+$/g, '') || `product-${Date.now()}`;

        let newSlug = baseSlug;
        let counter = 1;
        while (await Product.findOne({ slug: newSlug, _id: { $ne: product._id } })) {
          newSlug = `${baseSlug}-${counter}`;
          counter++;
        }
        product.slug = newSlug;
      }
    }

    // Require complete translations (name + description) if attempting to publish
    if (isActive === true) {
      const candidateName = product.name;
      const candidateDesc = product.description;
      const isComplete = Boolean(
        candidateName && typeof candidateName === 'object' &&
        candidateName.fr?.trim() && candidateName.ar?.trim() && candidateName.en?.trim() &&
        candidateDesc && typeof candidateDesc === 'object' &&
        candidateDesc.fr?.trim() && candidateDesc.ar?.trim() && candidateDesc.en?.trim()
      );
      if (!isComplete) {
        return res.status(400).json({
          success: false,
          code: 'TRANSLATIONS_INCOMPLETE',
          message: 'Cannot publish product: complete name and description translations in French, Arabic, and English are required before publishing. Please provide all translations or save as an unpublished draft.'
        });
      }
    }

    if (description !== undefined) {
      if (typeof description === 'object' && description !== null) {
        const currentDesc = typeof product.description === 'object' ? product.description : { fr: product.description || '', ar: '', en: '' };
        product.description = {
          fr: description.fr !== undefined ? description.fr : (currentDesc.fr || ''),
          ar: description.ar !== undefined ? description.ar : (currentDesc.ar || ''),
          en: description.en !== undefined ? description.en : (currentDesc.en || '')
        };
      } else if (typeof description === 'string') {
        const currentDesc = typeof product.description === 'object' ? product.description : {};
        product.description = {
          ...currentDesc,
          fr: description.trim()
        };
      }
    }
    if (category !== undefined) product.category = category;

    const incomingPrice = sellingPrice ?? basePrice;
    if (incomingPrice !== undefined) {
      if (typeof incomingPrice !== 'number' || !Number.isInteger(incomingPrice) || incomingPrice <= 0) {
        return res.status(400).json({ success: false, message: 'sellingPrice must be a positive integer in DZD.' });
      }
      product.sellingPrice = incomingPrice;
    }

    if (promotion !== undefined) {
      if (promotion.active === true) {
        const promoPrice = promotion.promotionalPrice !== undefined ? promotion.promotionalPrice : product.promotion?.promotionalPrice;
        if (typeof promoPrice !== 'number' || !Number.isInteger(promoPrice) || promoPrice <= 0) {
          return res.status(400).json({ success: false, message: 'promotionalPrice must be a positive integer in DZD when promotion is active.' });
        }
        if (promoPrice >= product.sellingPrice) {
          return res.status(400).json({ success: false, message: 'Promotional price must be strictly lower than base price.' });
        }
        product.promotion = { active: true, promotionalPrice: promoPrice };
      } else {
        // Deactivate promotion: restore regular price and clear promotionalPrice
        product.promotion = { active: false, promotionalPrice: null };
      }
    } else if (incomingPrice !== undefined && product.promotion && product.promotion.active) {
      if (product.promotion.promotionalPrice >= product.sellingPrice) {
        return res.status(400).json({ success: false, message: 'Base price cannot be reduced below or equal to the active promotional price. Update or deactivate promotion first.' });
      }
    }

    if (costPrice !== undefined) {
      if (typeof costPrice !== 'number' || !Number.isInteger(costPrice) || costPrice < 0) {
        return res.status(400).json({ success: false, message: 'costPrice must be a non-negative integer in DZD.' });
      }
      product.costPrice = costPrice;
    }
    if (isActive !== undefined) product.isActive = isActive;
    if (isBestSeller !== undefined) product.isBestSeller = isBestSeller;
    if (isArchived === true && !product.isArchived) {
      const activeOrders = await Order.find({
        "items.productId": product._id,
        status: {
          $in: [
            ORDER_STATUS.PENDING,
            ORDER_STATUS.CONFIRMED,
            ORDER_STATUS.ON_THE_WAY,
            ORDER_STATUS.AT_AGENCY
          ]
        }
      }).lean();

      if (activeOrders.length > 0) {
        return res.status(409).json({
          success: false,
          message: 'Cannot archive product: There are active undelivered orders referencing this product.'
        });
      }
      product.isArchived = true;
    } else if (isArchived !== undefined) {
      product.isArchived = isArchived;
    }

    if (colors !== undefined) {
      // 1. Protect active orders from destructive variant removal or rename
      const activeOrders = await Order.find({
        "items.productId": product._id,
        status: {
          $in: [
            ORDER_STATUS.PENDING,
            ORDER_STATUS.CONFIRMED,
            ORDER_STATUS.ON_THE_WAY,
            ORDER_STATUS.AT_AGENCY
          ]
        }
      }).lean();

      for (const order of activeOrders) {
        for (const item of order.items) {
          if (item.productId.toString() === product._id.toString()) {
            const incomingColor = colors.find(c => c.colorName === item.colorName);
            const incomingSize = incomingColor?.sizes?.find(s => s.size === item.size);
            if (!incomingColor || !incomingSize) {
              return res.status(409).json({
                success: false,
                message: `Cannot remove variant: ${item.colorName} / ${item.size}. There are active orders referencing this variant.`
              });
            }
          }
        }
      }

      // 2. Prevent stock mutation through product update endpoint:
      // Authoritative stock MUST be preserved from the database for existing variants.
      // Brand new variants default to 0 stock until set via adjustVariantStock / setStockAtomic.
      product.colors = colors.map(incomingColor => {
        const existingColor = product.colors.find(c => c.colorName === incomingColor.colorName);
        return {
          colorName: incomingColor.colorName,
          colorDisplayName: incomingColor.colorDisplayName !== undefined
            ? incomingColor.colorDisplayName
            : (existingColor?.colorDisplayName || { fr: '', ar: '', en: '' }),
          colorCode: incomingColor.colorCode,
          images: incomingColor.images || [],
          sizes: (incomingColor.sizes || []).map(incomingSize => {
            const existingSize = existingColor?.sizes?.find(s => s.size === incomingSize.size);
            return {
              size: incomingSize.size,
              stock: existingSize ? existingSize.stock : 0
            };
          })
        };
      });
    }

    await product.save();
    res.json({ success: true, product });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: 'A product with this name or slug already exists. Please choose a distinct name.'
      });
    }
    next(error);
  }
};

// Admin: Delete product from database
export const archiveProduct = async (req, res, next) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }

    const activeOrders = await Order.find({
      "items.productId": product._id,
      status: {
        $in: [
          ORDER_STATUS.PENDING,
          ORDER_STATUS.CONFIRMED,
          ORDER_STATUS.ON_THE_WAY,
          ORDER_STATUS.AT_AGENCY
        ]
      }
    }).lean();

    if (activeOrders.length > 0) {
      return res.status(409).json({
        success: false,
        message: 'Cannot delete product: There are active undelivered orders referencing this product.'
      });
    }

    await Product.findByIdAndDelete(req.params.id);

    res.json({ success: true, message: 'Product deleted successfully' });
  } catch (error) {
    next(error);
  }
};

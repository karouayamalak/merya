import { Product, isProductFullyTranslated } from '../models/Product.js';
import { Category } from '../models/Category.js';
import { Order } from '../models/Order.js';
import { ORDER_STATUS } from '../config/constants.js';
import { parsePaginationParams } from '../utils/pagination.js';
import { withTransactionRetry } from '../utils/transactionRetry.js';

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
    const { category, isBestSeller, search, minPrice, maxPrice, sort } = req.query;

    // Strict pagination validation — rejects NaN, Infinity, negatives, decimals
    const pagination = parsePaginationParams(req.query, { defaultLimit: 24, maxLimit: 50 });
    if (!pagination.valid) {
      return res.status(400).json({ success: false, message: pagination.error });
    }
    const { pageNum, limitNum, skip } = pagination;

    const filter = {
      isActive: true,
      isArchived: false,
      'name.fr': { $regex: /\S/ },
      'name.ar': { $regex: /\S/ },
      'name.en': { $regex: /\S/ },
      'description.fr': { $regex: /\S/ },
      'description.ar': { $regex: /\S/ },
      'description.en': { $regex: /\S/ }
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

    const isPriceSort = sort === 'price-asc' || sort === 'price-desc';

    let products, total;

    if (isPriceSort) {
      // Server-authoritative effective price sorting via aggregation:
      // effectivePrice = promotionalPrice if promotion is active and valid, else sellingPrice.
      // This guarantees globally correct price ordering across all pages.
      const sortDir = sort === 'price-asc' ? 1 : -1;
      const pipeline = [
        { $match: filter },
        {
          $addFields: {
            effectivePrice: {
              $cond: {
                if: {
                  $and: [
                    { $eq: ['$promotion.active', true] },
                    { $gt: ['$promotion.promotionalPrice', 0] },
                    { $lt: ['$promotion.promotionalPrice', '$sellingPrice'] }
                  ]
                },
                then: '$promotion.promotionalPrice',
                else: '$sellingPrice'
              }
            }
          }
        },
        { $sort: { effectivePrice: sortDir, _id: 1 } },
        { $skip: skip },
        { $limit: limitNum },
        { $project: { costPrice: 0 } }  // Do not expose cost price to public!
      ];

      const countPipeline = [{ $match: filter }, { $count: 'total' }];
      const [aggProducts, countResult] = await Promise.all([
        Product.aggregate(pipeline),
        Product.aggregate(countPipeline)
      ]);

      // Populate category manually after aggregation
      await Product.populate(aggProducts, { path: 'category', select: 'name slug' });
      products = aggProducts;
      total = countResult[0]?.total || 0;
    } else {
      // Default sorting (non-price): use regular find query
      let sortOption = { createdAt: -1 }; // default: newest
      if (sort === 'name-asc') {
        sortOption = { 'name.fr': 1 };
      }

      [products, total] = await Promise.all([
        Product.find(filter)
          .select('-costPrice') // Do not expose cost price to public!
          .populate('category', 'name slug')
          .sort(sortOption)
          .skip(skip)
          .limit(limitNum),
        Product.countDocuments(filter)
      ]);
    }

    if (typeof res.setHeader === 'function') {
      res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    }
    // Defense-in-depth: guarantee no incomplete products are ever serialized
    products = products.filter(p => isProductFullyTranslated(p));

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

    const product = await Product.findOne({
      slug,
      isActive: true,
      isArchived: false,
      'name.fr': { $regex: /\S/ },
      'name.ar': { $regex: /\S/ },
      'name.en': { $regex: /\S/ },
      'description.fr': { $regex: /\S/ },
      'description.ar': { $regex: /\S/ },
      'description.en': { $regex: /\S/ }
    })
      .select('-costPrice')
      .populate('category', 'name slug');

    if (!product || !isProductFullyTranslated(product)) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }

    res.setHeader('Cache-Control', 'no-cache, must-revalidate');

    // Related products in the same category (active, unarchived, and fully translated)
    const rawRelated = await Product.find({
      category: product.category._id,
      _id: { $ne: product._id },
      isActive: true,
      isArchived: false,
      'name.fr': { $regex: /\S/ },
      'name.ar': { $regex: /\S/ },
      'name.en': { $regex: /\S/ },
      'description.fr': { $regex: /\S/ },
      'description.ar': { $regex: /\S/ },
      'description.en': { $regex: /\S/ }
    })
      .select('-costPrice')
      .limit(4);

    const relatedProducts = rawRelated.filter(p => isProductFullyTranslated(p));

    res.json({ success: true, product, relatedProducts });
  } catch (error) {
    next(error);
  }
};

// Admin: Get all products with costPrice and total stock calculation
export const getAllProductsAdmin = async (req, res, next) => {
  try {
    const { search, category, isActive } = req.query;

    // Strict pagination validation
    const pagination = parsePaginationParams(req.query, { defaultLimit: 50, maxLimit: 100 });
    if (!pagination.valid) {
      return res.status(400).json({ success: false, message: pagination.error });
    }
    const { pageNum, limitNum, skip } = pagination;

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

    // When isActive is omitted: automatically use false unless the product is fully translated
    const effectiveIsActive = isActive !== undefined ? Boolean(isActive) : (isComplete ? true : false);

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
    const {
      name,
      description,
      category,
      sellingPrice,
      basePrice,
      costPrice,
      promotion,
      isActive,
      isBestSeller,
      isArchived,
      colors,
      expectedVersion
    } = req.body;

    const product = await Product.findById(id);
    if (!product) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }

    if (expectedVersion !== undefined && product.__v !== expectedVersion) {
      return res.status(409).json({
        success: false,
        code: 'CONCURRENT_CONFLICT',
        message: 'CONCURRENT_CONFLICT: Product was modified concurrently. Please refresh and retry.'
      });
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

    // Final-state check: If product is active (whether newly set or remaining active), require complete translations
    if (product.isActive === true) {
      const isComplete = isProductFullyTranslated(product);
      if (!isComplete) {
        return res.status(400).json({
          success: false,
          code: 'TRANSLATIONS_INCOMPLETE',
          message: 'Cannot publish product: complete name and description translations in French, Arabic, and English are required before publishing. Please provide all translations or save as an unpublished draft.'
        });
      }
    }
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

    // Build the atomic metadata update object from in-memory mutations.
    // This MUST be constructed after all the in-memory product mutations above
    // so that findOneAndUpdate writes the intended values (not an undefined reference).
    const metaUpdate = {};
    if (name !== undefined) metaUpdate.name = product.name;
    if (description !== undefined) metaUpdate.description = product.description;
    if (name !== undefined && product.slug) metaUpdate.slug = product.slug;
    if (category !== undefined) metaUpdate.category = product.category;
    if (incomingPrice !== undefined) metaUpdate.sellingPrice = product.sellingPrice;
    if (promotion !== undefined) metaUpdate.promotion = product.promotion;
    if (costPrice !== undefined) metaUpdate.costPrice = product.costPrice;
    if (isActive !== undefined) metaUpdate.isActive = product.isActive;
    if (isBestSeller !== undefined) metaUpdate.isBestSeller = product.isBestSeller;
    if (isArchived !== undefined || isArchived === true) metaUpdate.isArchived = product.isArchived;

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

      // Atomic stock-preserving color update with optimistic concurrency control (CAS):
      // Reads live stock directly from DB inside transaction and verifies __v so no concurrent
      // checkout or adjustment between read and write can be clobbered.
      const colorsUpdate = await withTransactionRetry(async (session) => {
        const live = await Product.findById(product._id, 'colors __v', session ? { session } : {}).lean();
        if (!live) {
          throw Object.assign(new Error('Product not found during atomic color update'), { statusCode: 404 });
        }

        if (expectedVersion !== undefined && live.__v !== expectedVersion) {
          throw Object.assign(
            new Error('CONCURRENT_CONFLICT: Product was modified concurrently. Please refresh and retry.'),
            { statusCode: 409, code: 'CONCURRENT_CONFLICT' }
          );
        }

        const mergedColors = product.colors.map((col) => {
          const liveCol = (live.colors || []).find(c => c.colorName === col.colorName);
          return {
            colorName: col.colorName,
            colorDisplayName: col.colorDisplayName,
            colorCode: col.colorCode,
            images: col.images,
            sizes: col.sizes.map((sz) => {
              const liveSz = liveCol?.sizes?.find(s => s.size === sz.size);
              return { size: sz.size, stock: liveSz !== undefined ? liveSz.stock : 0 };
            })
          };
        });

        // Single atomic mutation: update colors AND metadata together with version guard
        const updated = await Product.findOneAndUpdate(
          { _id: product._id, __v: live.__v },
          {
            $set: { colors: mergedColors, ...metaUpdate },
            $inc: { __v: 1 }
          },
          { new: true, ...(session ? { session } : {}) }
        );

        if (!updated) {
          throw Object.assign(
            new Error('CONCURRENT_CONFLICT: Product was modified concurrently. Please refresh and retry.'),
            { statusCode: 409, code: 'CONCURRENT_CONFLICT' }
          );
        }
        return updated;
      });

      return res.json({ success: true, product: colorsUpdate });
    }

    // No colors change — save metadata directly with version-guarded CAS
    const query = { _id: product._id };
    if (expectedVersion !== undefined) {
      query.__v = expectedVersion;
    }

    const finalProduct = await Product.findOneAndUpdate(
      query,
      { $set: metaUpdate, $inc: { __v: 1 } },
      { new: true }
    );

    if (!finalProduct && expectedVersion !== undefined) {
      return res.status(409).json({
        success: false,
        code: 'CONCURRENT_CONFLICT',
        message: 'CONCURRENT_CONFLICT: Product was modified concurrently. Please refresh and retry.'
      });
    }

    res.json({ success: true, product: finalProduct });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: 'A product with this name or slug already exists. Please choose a distinct name.'
      });
    }
    if (error.code === 'CONCURRENT_CONFLICT' || error.statusCode === 409 || error.message?.includes('CONCURRENT_CONFLICT')) {
      return res.status(409).json({
        success: false,
        code: 'CONCURRENT_CONFLICT',
        message: error.message || 'CONCURRENT_CONFLICT: Product was modified concurrently. Please refresh and retry.'
      });
    }
    next(error);
  }
};

// Admin: Delete or soft-archive product
// Physical deletion is only safe if NO orders (active or historical) ever referenced this product.
// If any historical order references the product, soft-archive instead to preserve order history.
export const archiveProduct = async (req, res, next) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }

    // Block on active/in-flight orders first
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
        message: 'Cannot delete product: There are active undelivered orders referencing this product. Archive it instead once all orders are resolved.'
      });
    }

    // Check for ANY historical order (delivered, returned, cancelled, etc.) that references this product.
    // Physical deletion would orphan those order line items and break historical record integrity.
    const historicalOrderCount = await Order.countDocuments({ "items.productId": product._id });

    if (historicalOrderCount > 0) {
      // Soft-archive: hide from storefront and admin listings, but preserve data for order history
      product.isArchived = true;
      product.isActive = false;
      await product.save();
      return res.json({
        success: true,
        archived: true,
        message: `Product soft-archived (${historicalOrderCount} historical order(s) reference this product; physical deletion would break order history).`
      });
    }

    // No orders ever referenced this product — physical deletion is safe
    await Product.findByIdAndDelete(req.params.id);
    res.json({ success: true, archived: false, message: 'Product permanently deleted.' });
  } catch (error) {
    next(error);
  }
};

import { Product } from '../models/Product.js';

/**
 * Atomically deduct stock for multiple items.
 *
 * When `session` is provided every Product operation runs inside that session,
 * making it part of the caller's MongoDB transaction.  If any variant has
 * insufficient stock the function throws; the caller is responsible for
 * aborting the transaction (no manual compensating rollback is performed here
 * when a session is active, because `abortTransaction` undoes everything).
 *
 * When `session` is NOT provided (e.g. the legacy checkout path) the function
 * performs its own per-item compensating rollback for backward compatibility.
 *
 * @param {Array}           items   - Order items with { productId, colorName, size, quantity }
 * @param {ClientSession}  [session] - Optional Mongoose/MongoDB session
 * @returns {{ success: true, count: number }}
 * @throws  Error if any item has insufficient stock or variant is not found
 */
export async function deductStockAtomic(items, session = null) {
  // Track deductions only when running WITHOUT a session (compensating rollback path)
  const deductionsMade = [];

  for (const item of items) {
    const { productId, colorName, size, quantity } = item;

    // Atomic conditional update: only decrement if current stock >= quantity
    const queryOpts = session ? { session, new: true } : { new: true };

    const updated = await Product.findOneAndUpdate(
      {
        _id: productId,
        isActive: true,
        isArchived: false,
        colors: {
          $elemMatch: {
            colorName: colorName,
            sizes: {
              $elemMatch: {
                size: size,
                stock: { $gte: quantity }
              }
            }
          }
        }
      },
      {
        $inc: {
          'colors.$[c].sizes.$[s].stock': -quantity
        }
      },
      {
        ...queryOpts,
        arrayFilters: [
          { 'c.colorName': colorName },
          { 's.size': size }
        ]
      }
    );

    if (!updated) {
      if (session) {
        // Transaction caller will abortTransaction() — no manual rollback
        throw new Error(`Insufficient stock for item: ${colorName} - Size ${size}`);
      }

      // Non-session path: roll back previous deductions made in this batch
      console.warn(`[Inventory] Insufficient stock for ${productId} / ${colorName} / ${size}. Rolling back.`);
      for (const ded of deductionsMade) {
        await Product.updateOne(
          { _id: ded.productId },
          { $inc: { 'colors.$[c].sizes.$[s].stock': ded.quantity } },
          { arrayFilters: [{ 'c.colorName': ded.colorName }, { 's.size': ded.size }] }
        );
      }
      throw new Error(`Insufficient stock for item: ${colorName} - Size ${size}`);
    }

    deductionsMade.push({ productId, colorName, size, quantity });
  }

  return { success: true, count: deductionsMade.length };
}

/**
 * Restore (increment) stock for multiple items.
 *
 * When `session` is provided every Product operation runs inside that session.
 * If the product/variant is not found the function throws immediately so the
 * caller's transaction can abort cleanly — no partial state is left.
 *
 * @param {Array}           items   - Order items with { productId, colorName, size, quantity }
 * @param {ClientSession}  [session] - Optional Mongoose/MongoDB session
 * @returns {{ success: true }}
 * @throws  Error if a variant cannot be matched (matchedCount === 0)
 */
export async function restoreStockAtomic(items, session = null) {
  for (const item of items) {
    const { productId, colorName, size, quantity } = item;

    const updateOpts = session
      ? {
          arrayFilters: [{ 'c.colorName': colorName }, { 's.size': size }],
          session
        }
      : {
          arrayFilters: [{ 'c.colorName': colorName }, { 's.size': size }]
        };

    const result = await Product.updateOne(
      {
        _id: productId,
        'colors.colorName': colorName,
        'colors.sizes.size': size
      },
      {
        $inc: {
          'colors.$[c].sizes.$[s].stock': quantity
        }
      },
      updateOpts
    );

    // Guard: treat a zero-match as a hard error so callers cannot silently
    // restore stock into a non-existent variant.
    if (result.matchedCount === 0) {
      throw new Error(
        `[Inventory] restoreStockAtomic: product/variant not found — ` +
        `productId=${productId}, color=${colorName}, size=${size}`
      );
    }
  }

  return { success: true };
}

/**
 * Adjust stock to a specific number (Admin function, not part of order lifecycle).
 */
export async function setStockAtomic(productId, colorName, size, newStock) {
  if (newStock < 0) {
    throw new Error('Stock cannot be negative');
  }

  const updated = await Product.findOneAndUpdate(
    {
      _id: productId,
      'colors.colorName': colorName,
      'colors.sizes.size': size
    },
    {
      $set: {
        'colors.$[c].sizes.$[s].stock': newStock
      }
    },
    {
      arrayFilters: [
        { 'c.colorName': colorName },
        { 's.size': size }
      ],
      new: true
    }
  );

  if (!updated) {
    throw new Error('Product or variant not found');
  }

  return updated;
}

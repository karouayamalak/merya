import { Product } from '../models/Product.js';

/**
 * Atomically deduct stock for multiple items.
 * If any variant has insufficient stock, any previously deducted items are rolled back.
 * Returns { success: true } or throws an Error.
 */
export async function deductStockAtomic(items) {
  const deductionsMade = [];

  for (const item of items) {
    const { productId, colorName, size, quantity } = item;

    // Atomic conditional update: only decrement if current stock >= quantity
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
          "colors.$[c].sizes.$[s].stock": -quantity
        }
      },
      {
        arrayFilters: [
          { "c.colorName": colorName },
          { "s.size": size }
        ],
        new: true
      }
    );

    if (!updated) {
      // Roll back previous deductions made in this batch
      console.warn(`[Inventory] Insufficient stock for ${productId} / ${colorName} / ${size}. Rolling back.`);
      for (const ded of deductionsMade) {
        await Product.updateOne(
          { _id: ded.productId },
          { $inc: { "colors.$[c].sizes.$[s].stock": ded.quantity } },
          { arrayFilters: [{ "c.colorName": ded.colorName }, { "s.size": ded.size }] }
        );
      }
      throw new Error(`Insufficient stock for item: ${colorName} - Size ${size}`);
    }

    deductionsMade.push({ productId, colorName, size, quantity });
  }

  return { success: true, count: deductionsMade.length };
}

/**
 * Atomically restore stock (e.g. for cancelled orders or order edits).
 */
export async function restoreStockAtomic(items) {
  for (const item of items) {
    const { productId, colorName, size, quantity } = item;

    await Product.updateOne(
      {
        _id: productId,
        "colors.colorName": colorName,
        "colors.sizes.size": size
      },
      {
        $inc: {
          "colors.$[c].sizes.$[s].stock": quantity
        }
      },
      {
        arrayFilters: [
          { "c.colorName": colorName },
          { "s.size": size }
        ]
      }
    );
  }
  return { success: true };
}

/**
 * Adjust stock to a specific number (Admin function).
 */
export async function setStockAtomic(productId, colorName, size, newStock) {
  if (newStock < 0) {
    throw new Error('Stock cannot be negative');
  }

  const updated = await Product.findOneAndUpdate(
    {
      _id: productId,
      "colors.colorName": colorName,
      "colors.sizes.size": size
    },
    {
      $set: {
        "colors.$[c].sizes.$[s].stock": newStock
      }
    },
    {
      arrayFilters: [
        { "c.colorName": colorName },
        { "s.size": size }
      ],
      new: true
    }
  );

  if (!updated) {
    throw new Error('Product or variant not found');
  }

  return updated;
}

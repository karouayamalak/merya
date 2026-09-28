import { StoreSetting } from '../models/StoreSetting.js';

/**
 * Public GET: Fetch store settings (logo variant, social links, delivery notice days)
 */
export const getStoreSettings = async (req, res, next) => {
  try {
    const setting = await StoreSetting.getSingleton();
    res.json({
      success: true,
      settings: {
        logoVariant: setting?.logoVariant || 'white',
        deliveryNoticeDays: setting?.deliveryNoticeDays ?? 3,
        socialLinks: {
          facebook: setting?.socialLinks?.facebook || '',
          instagram: setting?.socialLinks?.instagram || '',
          tiktok: setting?.socialLinks?.tiktok || ''
        },
        updatedAt: setting?.updatedAt
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Admin PUT: Update store settings (requires authenticated admin/owner)
 */
export const updateStoreSettings = async (req, res, next) => {
  try {
    const { logoVariant, socialLinks, deliveryNoticeDays } = req.body;

    const updateFields = {
      updatedBy: req.admin?._id
    };

    if (logoVariant !== undefined) {
      if (logoVariant !== 'white' && logoVariant !== 'original') {
        return res.status(400).json({
          success: false,
          message: 'Invalid logoVariant: must be either "white" or "original".'
        });
      }
      updateFields.logoVariant = logoVariant;
    }

    if (deliveryNoticeDays !== undefined) {
      const days = Number(deliveryNoticeDays);
      if (!Number.isInteger(days) || days < 1 || days > 30) {
        return res.status(400).json({
          success: false,
          message: 'Invalid deliveryNoticeDays: must be an integer between 1 and 30.'
        });
      }
      updateFields.deliveryNoticeDays = days;
    }

    if (socialLinks !== undefined) {
      if (typeof socialLinks !== 'object' || socialLinks === null) {
        return res.status(400).json({
          success: false,
          message: 'Invalid socialLinks: must be an object with facebook, instagram, and tiktok keys.'
        });
      }

      const sanitizeUrl = (val) => {
        if (typeof val !== 'string') return '';
        const trimmed = val.trim();
        if (!trimmed) return '';
        if (trimmed.length > 300) throw new Error('Social link URL cannot exceed 300 characters.');
        // Prevent javascript: or data: URIs
        if (/^(javascript|data|vbscript):/i.test(trimmed)) {
          throw new Error('Social link contains an unsafe protocol.');
        }
        return trimmed;
      };

      try {
        updateFields.socialLinks = {
          facebook: sanitizeUrl(socialLinks.facebook),
          instagram: sanitizeUrl(socialLinks.instagram),
          tiktok: sanitizeUrl(socialLinks.tiktok)
        };
      } catch (err) {
        return res.status(400).json({
          success: false,
          message: err.message
        });
      }
    }

    // Atomic upsert for singleton
    const updated = await StoreSetting.findOneAndUpdate(
      { singletonKey: 'default' },
      { $set: updateFields },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
    );

    res.json({
      success: true,
      message: 'Store settings updated successfully',
      settings: {
        logoVariant: updated.logoVariant,
        deliveryNoticeDays: updated.deliveryNoticeDays,
        socialLinks: {
          facebook: updated.socialLinks?.facebook || '',
          instagram: updated.socialLinks?.instagram || '',
          tiktok: updated.socialLinks?.tiktok || ''
        },
        updatedAt: updated.updatedAt
      }
    });
  } catch (error) {
    next(error);
  }
};

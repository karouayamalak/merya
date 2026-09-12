import { Banner } from '../models/Banner.js';

export const getBannerTranslationStatus = (banner) => {
  const title = typeof banner.title === 'object' && banner.title !== null ? banner.title : { fr: banner.title || '' };
  const hasFr = Boolean(title.fr && title.fr.trim());
  const hasAr = Boolean(title.ar && title.ar.trim());
  const hasEn = Boolean(title.en && title.en.trim());

  return {
    fr: hasFr,
    ar: hasAr,
    en: hasEn,
    isComplete: hasFr && hasAr && hasEn,
    missing: [
      !hasFr && 'fr',
      !hasAr && 'ar',
      !hasEn && 'en'
    ].filter(Boolean)
  };
};

// Public: Get active banners by placement or all active
export const getBanners = async (req, res, next) => {
  try {
    const { placement } = req.query;
    const query = { isActive: true };
    if (placement) {
      query.placement = placement;
    }

    const banners = await Banner.find(query).sort({ displayOrder: 1, createdAt: -1 });
    res.json({ success: true, count: banners.length, banners });
  } catch (error) {
    next(error);
  }
};

// Admin: Get all banners with translation status
export const getAllBannersAdmin = async (req, res, next) => {
  try {
    const banners = await Banner.find().sort({ placement: 1, displayOrder: 1, createdAt: -1 });
    const bannersWithStatus = banners.map((banner) => {
      const bObj = banner.toObject ? banner.toObject({ getters: true }) : banner;
      return {
        ...bObj,
        translationStatus: getBannerTranslationStatus(banner)
      };
    });
    res.json({ success: true, count: bannersWithStatus.length, banners: bannersWithStatus });
  } catch (error) {
    next(error);
  }
};

// Admin: Create banner
export const createBanner = async (req, res, next) => {
  try {
    const {
      title,
      subtitle,
      badgeText,
      buttonText,
      link,
      image,
      placement,
      isActive,
      displayOrder
    } = req.body;

    const banner = new Banner({
      title,
      subtitle,
      badgeText,
      buttonText,
      link: link || '/shop',
      image: image || '',
      placement: placement || 'top_announcement',
      isActive: isActive !== undefined ? isActive : true,
      displayOrder: displayOrder ?? 0
    });

    await banner.save();
    const bObj = banner.toObject({ getters: true });
    bObj.translationStatus = getBannerTranslationStatus(banner);

    res.status(201).json({ success: true, banner: bObj });
  } catch (error) {
    next(error);
  }
};

// Admin: Update banner
export const updateBanner = async (req, res, next) => {
  try {
    const { id } = req.params;
    const {
      title,
      subtitle,
      badgeText,
      buttonText,
      link,
      image,
      placement,
      isActive,
      displayOrder
    } = req.body;

    const banner = await Banner.findById(id);
    if (!banner) {
      return res.status(404).json({ success: false, message: 'Banner not found' });
    }

    const mergeField = (incoming, existingField) => {
      if (incoming === undefined) return existingField;
      if (typeof incoming === 'object' && incoming !== null) {
        const existing = typeof existingField === 'object' && existingField !== null ? existingField : { fr: existingField || '', ar: '', en: '' };
        return {
          fr: incoming.fr !== undefined ? incoming.fr : existing.fr || '',
          ar: incoming.ar !== undefined ? incoming.ar : existing.ar || '',
          en: incoming.en !== undefined ? incoming.en : existing.en || ''
        };
      }
      return incoming;
    };

    if (title !== undefined) banner.title = mergeField(title, banner.title);
    if (subtitle !== undefined) banner.subtitle = mergeField(subtitle, banner.subtitle);
    if (badgeText !== undefined) banner.badgeText = mergeField(badgeText, banner.badgeText);
    if (buttonText !== undefined) banner.buttonText = mergeField(buttonText, banner.buttonText);

    if (link !== undefined) banner.link = link;
    if (image !== undefined) banner.image = image;
    if (placement !== undefined) banner.placement = placement;
    if (isActive !== undefined) banner.isActive = isActive;
    if (displayOrder !== undefined) banner.displayOrder = displayOrder;

    await banner.save();
    const bObj = banner.toObject({ getters: true });
    bObj.translationStatus = getBannerTranslationStatus(banner);

    res.json({ success: true, banner: bObj });
  } catch (error) {
    next(error);
  }
};

// Admin: Delete banner
export const deleteBanner = async (req, res, next) => {
  try {
    const { id } = req.params;
    const banner = await Banner.findByIdAndDelete(id);
    if (!banner) {
      return res.status(404).json({ success: false, message: 'Banner not found' });
    }
    res.json({ success: true, message: 'Banner deleted successfully' });
  } catch (error) {
    next(error);
  }
};

import { Banner, isBannerFullyTranslated } from '../models/Banner.js';

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

// Public: Get active banners by placement or all active.
// Defense-in-depth: enforces translation completeness so incomplete/legacy records are never exposed.
export const getBanners = async (req, res, next) => {
  try {
    const { placement } = req.query;
    const query = { isActive: true };
    if (placement) {
      if (placement === 'hero' || placement === 'home_hero') {
        query.placement = { $in: ['hero', 'home_hero'] };
      } else if (placement === 'homepage-strip' || placement === 'home_middle') {
        query.placement = { $in: ['homepage-strip', 'home_middle'] };
      } else if (placement === 'top_announcement' || placement === 'promo_bar') {
        query.placement = { $in: ['top_announcement', 'promo_bar'] };
      } else {
        query.placement = placement;
      }
    }

    const rawBanners = await Banner.find(query).sort({ displayOrder: 1, createdAt: -1 });
    // Apply getters to ensure localized fields are properly formatted before translation check
    const banners = rawBanners
      .map(b => b.toObject({ getters: true }))
      .filter(b => isBannerFullyTranslated(b));
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
      ctaText,
      link,
      ctaLink,
      image,
      placement,
      isActive,
      displayOrder
    } = req.body;

    const isComplete = Boolean(
      title && typeof title === 'object' && title.fr?.trim() && title.ar?.trim() && title.en?.trim()
    );

    // Publishing requires complete French, Arabic, and English translations
    if (isActive === true && !isComplete) {
      return res.status(400).json({
        success: false,
        code: 'TRANSLATIONS_INCOMPLETE',
        message: 'Cannot publish banner: complete translations in French, Arabic, and English are required before publishing. Please provide all translations or save as an unpublished draft.'
      });
    }

    // When isActive is omitted: only activate if complete, otherwise safely default to inactive draft
    const effectiveIsActive = isActive !== undefined ? Boolean(isActive) : isComplete;
    const effectiveButton = buttonText !== undefined ? buttonText : ctaText;
    const effectiveLink = link !== undefined ? link : (ctaLink || '/shop');

    const banner = new Banner({
      title,
      subtitle,
      badgeText,
      buttonText: effectiveButton,
      link: effectiveLink,
      image: image || '',
      placement: placement || 'top_announcement',
      isActive: effectiveIsActive,
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
      ctaText,
      link,
      ctaLink,
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
    const incomingBtn = buttonText !== undefined ? buttonText : ctaText;
    if (incomingBtn !== undefined) banner.buttonText = mergeField(incomingBtn, banner.buttonText);

    const incomingLink = link !== undefined ? link : ctaLink;
    if (incomingLink !== undefined) banner.link = incomingLink;
    if (image !== undefined) banner.image = image;
    if (placement !== undefined) banner.placement = placement;
    if (isActive !== undefined) banner.isActive = isActive;
    if (displayOrder !== undefined) banner.displayOrder = displayOrder;

    // Final-state check: If banner is active (newly set or remaining active), require complete translations
    if (banner.isActive === true) {
      const isComplete = isBannerFullyTranslated(banner);
      if (!isComplete) {
        return res.status(400).json({
          success: false,
          code: 'TRANSLATIONS_INCOMPLETE',
          message: 'Cannot publish banner: complete translations in French, Arabic, and English are required before publishing. Please provide all translations or save as an unpublished draft.'
        });
      }
    }

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

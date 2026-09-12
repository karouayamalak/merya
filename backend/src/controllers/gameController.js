import { Game } from '../models/Game.js';

export const getGameTranslationStatus = (game) => {
  const title = typeof game.title === 'object' && game.title !== null ? game.title : { fr: game.title || '' };
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

const extractBaseTitle = (title) => {
  if (!title) return '';
  if (typeof title === 'string') return title;
  return title.fr || title.en || title.ar || '';
};

// Public: Get active, fully-translated games
export const getGames = async (req, res, next) => {
  try {
    const games = await Game.find({
      isActive: true,
      'title.fr': { $exists: true, $ne: '' },
      'title.ar': { $exists: true, $ne: '' },
      'title.en': { $exists: true, $ne: '' }
    }).sort({ displayOrder: 1, createdAt: 1 });
    res.json({ success: true, count: games.length, games });
  } catch (error) {
    next(error);
  }
};

// Public: Get game by slug
export const getGameBySlug = async (req, res, next) => {
  try {
    const { slug } = req.params;
    const game = await Game.findOne({
      slug,
      isActive: true,
      'title.fr': { $exists: true, $ne: '' },
      'title.ar': { $exists: true, $ne: '' },
      'title.en': { $exists: true, $ne: '' }
    });
    if (!game) {
      return res.status(404).json({ success: false, message: 'Game not found' });
    }
    res.json({ success: true, game });
  } catch (error) {
    next(error);
  }
};

// Admin: Get all games with translation status
export const getAllGamesAdmin = async (req, res, next) => {
  try {
    const games = await Game.find().sort({ displayOrder: 1, createdAt: -1 });
    const gamesWithStatus = games.map((game) => {
      const gObj = game.toObject ? game.toObject({ getters: true }) : game;
      return {
        ...gObj,
        translationStatus: getGameTranslationStatus(game)
      };
    });
    res.json({ success: true, count: gamesWithStatus.length, games: gamesWithStatus });
  } catch (error) {
    next(error);
  }
};

// Admin: Create game
export const createGame = async (req, res, next) => {
  try {
    const {
      title,
      type,
      gameType,
      description,
      instructions,
      rules,
      winnerMessage,
      loserMessage,
      reward,
      questions,
      coverImage,
      isActive,
      displayOrder
    } = req.body;

    const baseTitle = extractBaseTitle(title);
    if (!baseTitle.trim()) {
      return res.status(400).json({ success: false, message: 'Game title in at least one language is required' });
    }

    let slug = baseTitle
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, '')
      .replace(/[\s_-]+/g, '-')
      .replace(/^-+|-+$/g, '') || `game-${Date.now()}`;

    const baseSlug = slug;
    let counter = 1;
    while (await Game.findOne({ slug })) {
      slug = `${baseSlug}-${counter}`;
      counter++;
    }

    const isComplete = Boolean(
      title && typeof title === 'object' && title.fr?.trim() && title.ar?.trim() && title.en?.trim()
    );

    // Publishing requires complete French, Arabic, and English translations
    if (isActive === true && !isComplete) {
      return res.status(400).json({
        success: false,
        code: 'TRANSLATIONS_INCOMPLETE',
        message: 'Cannot publish game: complete translations in French, Arabic, and English are required before publishing. Please provide all translations or save as an unpublished draft.'
      });
    }

    const effectiveIsActive = isActive !== undefined ? Boolean(isActive) : false;
    const finalType = type || gameType || 'wheel';

    const game = new Game({
      title,
      slug,
      type: finalType,
      gameType: finalType,
      coverImage: coverImage || '',
      description,
      instructions: instructions || rules,
      rules: rules || instructions,
      winnerMessage,
      loserMessage,
      reward,
      questions: questions || [],
      isActive: effectiveIsActive,
      displayOrder: displayOrder ?? 0
    });

    await game.save();
    const gObj = game.toObject({ getters: true });
    gObj.translationStatus = getGameTranslationStatus(game);

    res.status(201).json({ success: true, game: gObj });
  } catch (error) {
    next(error);
  }
};

// Admin: Update game
export const updateGame = async (req, res, next) => {
  try {
    const { id } = req.params;
    const {
      title,
      type,
      gameType,
      description,
      instructions,
      rules,
      winnerMessage,
      loserMessage,
      reward,
      questions,
      coverImage,
      isActive,
      displayOrder
    } = req.body;

    const game = await Game.findById(id);
    if (!game) {
      return res.status(404).json({ success: false, message: 'Game not found' });
    }

    if (title !== undefined) {
      if (typeof title === 'object' && title !== null) {
        const existingTitle = typeof game.title === 'object' && game.title !== null ? game.title : { fr: game.title || '', ar: '', en: '' };
        game.title = {
          fr: title.fr !== undefined ? title.fr : existingTitle.fr || '',
          ar: title.ar !== undefined ? title.ar : existingTitle.ar || '',
          en: title.en !== undefined ? title.en : existingTitle.en || ''
        };
      } else {
        game.title = title;
      }
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

    if (description !== undefined) game.description = mergeField(description, game.description);
    if (instructions !== undefined) game.instructions = mergeField(instructions, game.instructions);
    if (rules !== undefined) game.rules = mergeField(rules, game.rules);
    if (winnerMessage !== undefined) game.winnerMessage = mergeField(winnerMessage, game.winnerMessage);
    if (loserMessage !== undefined) game.loserMessage = mergeField(loserMessage, game.loserMessage);

    if (coverImage !== undefined) game.coverImage = coverImage;
    if (type !== undefined || gameType !== undefined) {
      const selectedType = type || gameType;
      game.type = selectedType;
      game.gameType = selectedType;
    }
    if (reward !== undefined) game.reward = { ...game.reward, ...reward };
    if (questions !== undefined) game.questions = questions;

    // Require complete translations if attempting to publish
    if (isActive === true) {
      const candidateTitle = game.title;
      const isComplete = Boolean(
        candidateTitle && typeof candidateTitle === 'object' &&
        candidateTitle.fr?.trim() && candidateTitle.ar?.trim() && candidateTitle.en?.trim()
      );
      if (!isComplete) {
        return res.status(400).json({
          success: false,
          code: 'TRANSLATIONS_INCOMPLETE',
          message: 'Cannot publish game: complete translations in French, Arabic, and English are required before publishing. Please provide all translations or save as an unpublished draft.'
        });
      }
    }

    if (isActive !== undefined) game.isActive = isActive;
    if (displayOrder !== undefined) game.displayOrder = displayOrder;

    await game.save();
    const gObj = game.toObject({ getters: true });
    gObj.translationStatus = getGameTranslationStatus(game);

    res.json({ success: true, game: gObj });
  } catch (error) {
    next(error);
  }
};

// Admin: Delete game
export const deleteGame = async (req, res, next) => {
  try {
    const { id } = req.params;
    const game = await Game.findByIdAndDelete(id);
    if (!game) {
      return res.status(404).json({ success: false, message: 'Game not found' });
    }
    res.json({ success: true, message: 'Game deleted successfully' });
  } catch (error) {
    next(error);
  }
};

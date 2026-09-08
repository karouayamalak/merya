import { processAndSaveImage } from '../middleware/upload.js';

export const handleImageUpload = async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No image file uploaded' });
    }

    const imageUrl = await processAndSaveImage(req.file.buffer);

    res.status(201).json({
      success: true,
      url: imageUrl,
      message: 'Image processed and optimized to WebP successfully'
    });
  } catch (error) {
    next(error);
  }
};

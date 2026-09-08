import multer from 'multer';
import sharp from 'sharp';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';

const uploadDir = path.resolve('uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Memory storage so sharp can inspect and re-encode the image safely
const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  const allowedMimes = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'];
  if (allowedMimes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Only JPEG, PNG, WEBP, and AVIF image formats are allowed!'), false);
  }
};

export const uploadMiddleware = multer({
  storage,
  limits: {
    fileSize: 8 * 1024 * 1024 // 8 MB max
  },
  fileFilter
});

/**
 * Process uploaded image: convert to webp, resize to standard dimensions, strip metadata
 */
export const processAndSaveImage = async (buffer) => {
  const filename = `${uuidv4()}.webp`;
  const filepath = path.join(uploadDir, filename);

  await sharp(buffer)
    .resize(1200, 1600, {
      fit: 'inside',
      withoutEnlargement: true
    })
    .webp({ quality: 85 })
    .toFile(filepath);

  return `/uploads/${filename}`;
};

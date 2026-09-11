import multer from 'multer';
import sharp from 'sharp';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { v2 as cloudinary } from 'cloudinary';

const uploadDir = path.resolve('uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Memory storage so sharp can inspect and re-encode the image safely
const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  const allowedMimes = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'];
  const allowedExts = ['.jpg', '.jpeg', '.png', '.webp', '.avif'];
  const ext = path.extname(file.originalname || '').toLowerCase();

  if (allowedMimes.includes(file.mimetype) && allowedExts.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file format. Only JPEG, PNG, WEBP, and AVIF images are permitted!'), false);
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
 * Process uploaded image: convert to webp, resize to standard dimensions, strip metadata.
 * If Cloudinary environment variables exist, uploads directly to Cloudinary CDN for persistent cloud hosting.
 * Otherwise, saves locally to uploads/ folder.
 */
export const processAndSaveImage = async (buffer) => {
  const optimizedBuffer = await sharp(buffer)
    .resize(1200, 1600, {
      fit: 'inside',
      withoutEnlargement: true
    })
    .webp({ quality: 85 })
    .toBuffer();

  const isCloudinaryConfigured = !!(
    process.env.CLOUDINARY_CLOUD_NAME &&
    process.env.CLOUDINARY_API_KEY &&
    process.env.CLOUDINARY_API_SECRET
  );

  if (isCloudinaryConfigured) {
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
      secure: true
    });

    return new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder: 'merya_dz',
          format: 'webp',
          resource_type: 'image'
        },
        (error, result) => {
          if (error) {
            console.error('[Cloudinary Upload Error]', error);
            return reject(new Error('Failed to upload image to Cloudinary storage'));
          }
          resolve(result.secure_url);
        }
      );
      uploadStream.end(optimizedBuffer);
    });
  }

  // In production, NEVER silently fall back to ephemeral disk on platforms like Render or Railway
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'Image upload rejected: Cloudinary cloud storage (CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET) is required in production to ensure image persistence. Ephemeral local disk storage is disabled.'
    );
  }

  // Local filesystem fallback ONLY for local development / offline testing
  const filename = `${uuidv4()}.webp`;
  const filepath = path.join(uploadDir, filename);
  await fs.promises.writeFile(filepath, optimizedBuffer);
  return `/uploads/${filename}`;
};

export const errorHandler = (err, req, res, next) => {
  console.error(`[Error] ${req.method} ${req.originalUrl}:`, err);

  const statusCode = res.statusCode === 200 ? 500 : res.statusCode;

  // In production, avoid leaking internal MongoDB/system details
  const isProduction = process.env.NODE_ENV === 'production';
  const message = isProduction && statusCode === 500
    ? 'An unexpected server error occurred. Please try again later.'
    : err.message || 'Internal Server Error';

  res.status(statusCode).json({
    success: false,
    message,
    ...(isProduction ? {} : { stack: err.stack })
  });
};

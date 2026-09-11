export const errorHandler = (err, req, res, next) => {
  const statusCode = res.statusCode === 200 ? 500 : res.statusCode;
  const isProduction = process.env.NODE_ENV === 'production';
  const timestamp = new Date().toISOString();

  // Structured logging for production observability (without exposing customer PII, secrets, or tokens)
  if (isProduction) {
    console.error(JSON.stringify({
      level: 'ERROR',
      timestamp,
      method: req.method,
      url: req.originalUrl,
      statusCode,
      errorName: err.name,
      message: err.message
    }));
  } else {
    console.error(`[Error] [${timestamp}] ${req.method} ${req.originalUrl}:`, err);
  }

  // In production, avoid leaking internal MongoDB/system stack traces to public clients
  const message = isProduction && statusCode === 500
    ? 'An unexpected server error occurred. Please try again later.'
    : err.message || 'Internal Server Error';

  res.status(statusCode).json({
    success: false,
    message,
    ...(isProduction ? {} : { stack: err.stack })
  });
};

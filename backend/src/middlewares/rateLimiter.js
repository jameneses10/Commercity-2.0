const { rateLimit } = require('express-rate-limit');

const WINDOW_MS = 15 * 60 * 1000;
const LIMIT = 5;

const handler = (req, res) => {
  return res.status(429).json({
    ok: false,
    message: "Demasiados intentos. Intenta nuevamente más tarde.",
    errors: []
  });
};

const forgotPasswordLimiter = rateLimit({
  windowMs: WINDOW_MS,
  limit: LIMIT,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  validate: true,
  handler
});

const resetPasswordLimiter = rateLimit({
  windowMs: WINDOW_MS,
  limit: LIMIT,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  validate: true,
  handler
});

const loginLimiter = rateLimit({
  windowMs: WINDOW_MS,
  limit: LIMIT,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  validate: true,
  skipSuccessfulRequests: true,
  handler
});

module.exports = {
  loginLimiter,
  forgotPasswordLimiter,
  resetPasswordLimiter
};

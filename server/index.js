require("dotenv").config();
const express    = require("express");
const cors       = require("cors");
const path       = require("path");
const helmet     = require("helmet");
const { rateLimit, ipKeyGenerator } = require("express-rate-limit");

const eventsRouter        = require("./routes/events");
const transactionsRouter  = require("./routes/transactions");
const reportsRouter       = require("./routes/reports");
const announcementsRouter = require("./routes/announcements");
const adminRouter         = require("./routes/admin");
const unitsRouter         = require("./routes/units");
const curriculumRouter    = require("./routes/curriculum");
const enrollmentRouter    = require("./routes/enrollment");
const { router: notificationsRouter } = require("./routes/notifications");
const publicRouter        = require("./routes/public");
const feedbackRouter      = require("./routes/feedback");
const cvRouter            = require("./routes/cv");
const authMiddleware      = require("./middleware/auth");
const keepAlive           = require("./lib/keepAlive");

const app  = express();
const PORT = process.env.PORT || 3000;

// Trust the first proxy hop (Render/Vercel) so req.ip reflects the real client
// IP - required for per-IP rate limiting to work behind a reverse proxy.
app.set('trust proxy', 1);

// =============================================
// Security: Helmet (sets 11+ security headers)
// =============================================
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:   ["'self'"],
      scriptSrc:    ["'self'", "'unsafe-inline'",
                     "https://cdn.jsdelivr.net",
                     "https://cdnjs.cloudflare.com",
                     "https://fonts.googleapis.com",
                     "https://apis.google.com",
                     "https://accounts.google.com"],
      styleSrc:     ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc:      ["'self'", "https://fonts.gstatic.com"],
      imgSrc:       ["'self'", "data:", "https://hchkfunaofyoualrdnkk.supabase.co", "https://lh3.googleusercontent.com"],
      connectSrc:   ["'self'",
                     "https://hchkfunaofyoualrdnkk.supabase.co",
                     "wss://hchkfunaofyoualrdnkk.supabase.co",
                     "https://api.brevo.com",
                     "https://api.sendinblue.com",
                     "https://api.iconify.design",
                     "https://accounts.google.com",
                     "https://identitytoolkit.googleapis.com"],
      frameSrc:     ["https://accounts.google.com"],
      objectSrc:    ["'none'"],
    }
  },
  crossOriginEmbedderPolicy: false, // needed for Supabase realtime
  referrerPolicy: {
    policy: 'strict-origin-when-cross-origin',
  },
  permissionsPolicy: {
    features: {
      camera:      [],
      microphone:  [],
      geolocation: [],
    },
  },
}));

// =============================================
// CORS - strict allowlist only
// =============================================
const ALLOWED_ORIGINS = [
  'http://localhost:3000',
  'https://lgu-system-eight.vercel.app',
  'https://lgu-system.onrender.com',
  'https://coelgu.tech',
  'https://www.coelgu.tech',
  'https://coelgu-system.engineer',
  'https://www.coelgu-system.engineer',
];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (ALLOWED_ORIGINS.includes(origin) || origin.endsWith('.vercel.app')) {
      return callback(null, true);
    }
    callback(new Error(`CORS blocked: ${origin}`));
  },
  credentials: true,
}));

// =============================================
// Body parsing - with size limits (prevents DoS)
// =============================================
app.use(express.json({ limit: '50kb' }));
app.use(express.urlencoded({ extended: true, limit: '50kb' }));

// =============================================
// Rate Limiting
// =============================================
// Global cap - 5000 req / 15 min per IP (calibrated for shared campus Wi-Fi NAT gateways with 500+ students)
const globalLimiter = rateLimit({
  windowMs:         15 * 60 * 1000, // 15 minutes
  max:              5000,
  standardHeaders:  true,
  legacyHeaders:    false,
  message:          { error: 'Too many requests from this network. Please wait a few minutes and try again.' },
  skip: (req) => req.originalUrl === '/api/health', // exempt health check
});
app.use('/api/', globalLimiter);

// Sensitive operations with high blast radius (email blasts, bulk imports,
// role changes, budget transfers) - tight per-IP cap, applied before auth.
// Note: req.path here is stripped of the '/api' mount prefix.
const sensitiveLimiter = rateLimit({
  windowMs:         10 * 60 * 1000, // 10 minutes
  max:              20,
  standardHeaders:  true,
  legacyHeaders:    false,
  message:          { error: 'Too many sensitive operations. Please slow down.' },
  skip: (req) => !(
    (req.method === 'POST' && ['/events', '/announcements', '/transactions/bulk', '/admin/budget-transfer'].includes(req.path)) ||
    (req.method === 'PATCH' && /^\/admin\/users\/[^/]+\/role$/.test(req.path))
  ),
});
app.use('/api/', sensitiveLimiter);

// Write cap - 100 mutating requests / 5 min, keyed by authenticated user
// (falls back to IP). Only counts POST/PATCH/DELETE; mounted after auth.
const writeLimiter = rateLimit({
  windowMs:        5 * 60 * 1000, // 5 minutes
  max:             100,
  standardHeaders: true,
  legacyHeaders:   false,
  message:         { error: 'Too many write requests. Slow down.' },
  keyGenerator:    (req) => req.user?.id || ipKeyGenerator(req),
});

// Wrapper so a limiter only counts mutating requests (GET/HEAD/OPTIONS pass through).
function onlyWrites(limiter) {
  return (req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    return limiter(req, res, next);
  };
}

// =============================================
// Serve static frontend files
// =============================================
app.use(express.static(path.join(__dirname, "../client")));

// Standalone portal pages - static handler can't resolve extensionless
// directory paths to their .html files, so route them explicitly.
const feedbackDir = path.join(__dirname, "../client/feedback");
app.get(["/feedback", "/feedback/"],        (req, res) => res.sendFile(path.join(feedbackDir, "index.html")));
app.get(["/feedback/view", "/feedback/view/"], (req, res) => res.sendFile(path.join(feedbackDir, "view", "index.html")));

// =============================================
// Public Routes
// =============================================
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});
app.use("/api/public", publicRouter);
app.use("/api/feedback", feedbackRouter);

// =============================================
// Protected API Routes
// =============================================
app.use("/api/events",        authMiddleware, onlyWrites(writeLimiter), eventsRouter);
app.use("/api/transactions",  authMiddleware, onlyWrites(writeLimiter), transactionsRouter);
app.use("/api/reports",       authMiddleware, onlyWrites(writeLimiter), reportsRouter);
app.use("/api/announcements", authMiddleware, onlyWrites(writeLimiter), announcementsRouter);
app.use("/api/admin",         authMiddleware, onlyWrites(writeLimiter), adminRouter);
app.use("/api/units",         authMiddleware, onlyWrites(writeLimiter), unitsRouter);
app.use("/api/curriculum",    authMiddleware, onlyWrites(writeLimiter), curriculumRouter);
app.use("/api/enrollment",    authMiddleware, onlyWrites(writeLimiter), enrollmentRouter);
app.use("/api/notifications", authMiddleware, onlyWrites(writeLimiter), notificationsRouter);
app.use("/api/cv",            onlyWrites(writeLimiter), cvRouter);

// =============================================
// SPA Fallback
// =============================================
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "../client/index.html"));
});

// =============================================
// Global Error Handler - never leak stack traces
// =============================================
app.use((err, req, res, next) => {
  // Log full error internally, never expose to client
  console.error("[Server Error]", err.message);
  res.status(err.status || 500).json({
    error: process.env.NODE_ENV === 'production'
      ? 'An internal server error occurred.'
      : err.message,
  });
});

app.listen(PORT, () => {
  console.log(`COE Budget System Server running on http://localhost:${PORT}`);
  const serverUrl = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
  keepAlive.start(serverUrl);
});

module.exports = app;

/**
 * AI4Botswana – Gallery Backend
 * ─────────────────────────────
 * A lightweight Express server that handles:
 *   • Photo uploads (multipart/form-data via multer)
 *   • Serving approved photos via REST API
 *   • Simple admin approval workflow
 *
 * SETUP
 * ─────
 *   1.  npm install express multer cors
 *   2.  node gallery-backend.js
 *   3.  Server runs at http://localhost:3001
 *
 * ENDPOINTS
 * ─────────
 *   GET  /api/gallery          → returns approved photos (used by index.html)
 *   POST /api/gallery/upload   → upload a new photo (pending review)
 *   GET  /api/admin/pending    → list photos awaiting approval
 *   POST /api/admin/approve/:id → approve a photo so it appears in gallery
 *   POST /api/admin/reject/:id  → delete a photo from pending
 *   GET  /uploads/:filename    → serve uploaded image files
 *
 * CONNECTING TO REGISTRATION / STARTUP FORMS
 * ───────────────────────────────────────────
 *   Replace the placeholder URLs below with your actual Google Form links.
 *   The front-end already calls openStartupForm() which uses the link in index.html.
 */

const express  = require('express');
const multer   = require('multer');
const cors     = require('cors');
const path     = require('path');
const fs       = require('fs');
const crypto   = require('crypto');

const app  = express();
const PORT = 3001;

// ── Directories ──────────────────────────────────────────────────────────────
const UPLOAD_DIR  = path.join(__dirname, 'uploads');
const PENDING_DIR = path.join(__dirname, 'uploads', 'pending');
const DATA_FILE   = path.join(__dirname, 'gallery-data.json');

[UPLOAD_DIR, PENDING_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// ── Persistent JSON store ─────────────────────────────────────────────────────
function readData() {
  if (!fs.existsSync(DATA_FILE)) return { approved: [], pending: [] };
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
  catch { return { approved: [], pending: [] }; }
}

function writeData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// ── Multer configuration ──────────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, PENDING_DIR),
  filename:    (req, file, cb) => {
    const ext  = path.extname(file.originalname).toLowerCase();
    const name = crypto.randomBytes(10).toString('hex') + ext;
    cb(null, name);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB max
  fileFilter: (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error('Only image files are allowed (jpg, png, webp, gif)'));
  }
});

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve uploaded files statically
app.use('/uploads', express.static(UPLOAD_DIR));

// ── PUBLIC ROUTES ─────────────────────────────────────────────────────────────

/**
 * GET /api/gallery
 * Returns all approved photos for display in index.html
 */
app.get('/api/gallery', (req, res) => {
  const { approved } = readData();
  res.json(approved);
});

/**
 * POST /api/gallery/upload
 * Accepts a photo + metadata, saves it for admin review.
 *
 * Form fields:
 *   file      (required) — image file
 *   caption   (optional) — short description
 *   category  (optional) — highlights | speakers | networking
 *   uploader  (optional) — name of person uploading
 */
app.post('/api/gallery/upload', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded.' });
  }

  const id = crypto.randomUUID();
  const photo = {
    id,
    filename:  req.file.filename,
    url:       `/uploads/pending/${req.file.filename}`,
    caption:   (req.body.caption  || '').slice(0, 200),
    category:  (req.body.category || 'highlights').toLowerCase(),
    uploader:  (req.body.uploader || 'Anonymous').slice(0, 100),
    uploadedAt: new Date().toISOString(),
    wide:      false
  };

  const data = readData();
  data.pending.push(photo);
  writeData(data);

  console.log(`📸  New photo pending review: ${photo.filename} by ${photo.uploader}`);
  res.status(201).json({
    message: 'Photo uploaded successfully. It will appear in the gallery after review.',
    id
  });
});

// ── ADMIN ROUTES ──────────────────────────────────────────────────────────────
// NOTE: In production, protect these routes with proper authentication.
// For now, they are open for easy local use.

/**
 * GET /api/admin/pending
 * Lists all photos awaiting approval.
 */
app.get('/api/admin/pending', (req, res) => {
  const { pending } = readData();
  res.json(pending);
});

/**
 * POST /api/admin/approve/:id
 * Moves a photo from pending → approved, making it public.
 * Body (optional): { wide: true } to mark as a wide/featured photo
 */
app.post('/api/admin/approve/:id', (req, res) => {
  const data = readData();
  const idx  = data.pending.findIndex(p => p.id === req.params.id);

  if (idx === -1) return res.status(404).json({ error: 'Photo not found in pending list.' });

  const photo = data.pending.splice(idx, 1)[0];

  // Move file from pending/ to uploads/
  const oldPath = path.join(PENDING_DIR, photo.filename);
  const newPath = path.join(UPLOAD_DIR,  photo.filename);
  if (fs.existsSync(oldPath)) fs.renameSync(oldPath, newPath);

  photo.url      = `/uploads/${photo.filename}`;
  photo.wide     = req.body.wide === true || req.body.wide === 'true';
  photo.approvedAt = new Date().toISOString();

  data.approved.push(photo);
  writeData(data);

  console.log(`✅  Approved: ${photo.filename}`);
  res.json({ message: 'Photo approved and now live in the gallery.', photo });
});

/**
 * POST /api/admin/reject/:id
 * Removes a photo from pending and deletes the file.
 */
app.post('/api/admin/reject/:id', (req, res) => {
  const data = readData();
  const idx  = data.pending.findIndex(p => p.id === req.params.id);

  if (idx === -1) return res.status(404).json({ error: 'Photo not found.' });

  const photo  = data.pending.splice(idx, 1)[0];
  const filePath = path.join(PENDING_DIR, photo.filename);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

  writeData(data);
  console.log(`🗑️   Rejected: ${photo.filename}`);
  res.json({ message: 'Photo rejected and deleted.' });
});

/**
 * DELETE /api/admin/approved/:id
 * Remove an already-approved photo from the gallery.
 */
app.delete('/api/admin/approved/:id', (req, res) => {
  const data = readData();
  const idx  = data.approved.findIndex(p => p.id === req.params.id);

  if (idx === -1) return res.status(404).json({ error: 'Photo not found.' });

  const photo = data.approved.splice(idx, 1)[0];
  const filePath = path.join(UPLOAD_DIR, photo.filename);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

  writeData(data);
  res.json({ message: 'Photo removed from gallery.' });
});

// ── Error handler ─────────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error(err.message);
  res.status(500).json({ error: err.message || 'Server error.' });
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`
  ╔═══════════════════════════════════════════╗
  ║   AI4Botswana · Gallery Backend           ║
  ║   Running at http://localhost:${PORT}         ║
  ╠═══════════════════════════════════════════╣
  ║   GET  /api/gallery           (public)    ║
  ║   POST /api/gallery/upload    (public)    ║
  ║   GET  /api/admin/pending     (admin)     ║
  ║   POST /api/admin/approve/:id (admin)     ║
  ║   POST /api/admin/reject/:id  (admin)     ║
  ╚═══════════════════════════════════════════╝
  `);
});

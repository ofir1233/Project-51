import { Router } from 'express';
import express from 'express';
import { paths } from '../paths.mjs';

export const staticRouter = Router();

// Serve the existing static site (p51/, root assets) AND the new lab files.
// Cache-bust friendly: no-cache on HTML so reloads are immediate during dev.
const noCacheHtml = (req, res, next) => {
  if (req.path.endsWith('.html') || req.path === '/' || req.path.endsWith('/')) {
    res.set('Cache-Control', 'no-cache');
  }
  next();
};

staticRouter.use(noCacheHtml);

// Default route: redirect / to the synthesis page (matches vercel.json behavior locally)
staticRouter.get('/', (req, res) => res.redirect('/p51/synthesis.html'));
staticRouter.get('/p51', (req, res) => res.redirect('/p51/synthesis.html'));
staticRouter.get('/p51/index', (req, res) => res.redirect('/p51/synthesis.html'));

// Clean URLs for existing pages (mimics vercel cleanUrls: true locally)
const cleanUrlMap = {
  '/p51/synthesis': '/p51/synthesis.html',
  '/p51/library':   '/p51/library.html',
  '/p51/work':      '/p51/work.html',
  '/p51/lab':       '/p51/lab.html',
  '/p51-design-system': '/p51-design-system.html',
};
for (const [from, to] of Object.entries(cleanUrlMap)) {
  staticRouter.get(from, (req, res) => res.redirect(to));
}

// Static file serving for everything else (relative to repo root)
staticRouter.use(express.static(paths.publicDir, {
  extensions: ['html'],
  index: false,
  setHeaders(res, path) {
    if (path.endsWith('.html')) res.set('Cache-Control', 'no-cache');
  },
}));

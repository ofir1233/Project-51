import { Router } from 'express';
import express from 'express';
import { paths } from '../paths.mjs';

export const labAssetsRouter = Router();

// Serve binaries under .lab/. Read-only, no listing.
labAssetsRouter.use('/lab-assets/generations', express.static(paths.generations, {
  fallthrough: false,
  index: false,
  immutable: true,
  maxAge: '1d',
}));
labAssetsRouter.use('/lab-assets/snapshots', express.static(paths.snapshots, {
  fallthrough: false,
  index: false,
  maxAge: '1d',
}));
labAssetsRouter.use('/lab-assets/refs', express.static(paths.refs, {
  fallthrough: false,
  index: false,
  maxAge: '1d',
}));

import { Router } from 'express';

export const downloadsRouter = Router();

// Stubbed for Prompt 7 (Signed private storage downloads)
downloadsRouter.all('*', (_req, res) => {
  res.status(501).json({
    error: 'Signed download routes are scheduled for the digital delivery phase.',
  });
});

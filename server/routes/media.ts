// The admin image workflow is the single source of truth for Gemini image generation.
// Mounting it here preserves the /api/media/generate route without a second implementation.
export { adminImageRouter as mediaRouter } from './adminImage.ts';

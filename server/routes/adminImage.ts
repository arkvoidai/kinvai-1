import express, { Router } from 'express';
import { z } from 'zod';
import { createRateLimitMiddleware } from '../lib/rateLimit.ts';
import { assertSameOrigin } from '../lib/requestSecurity.ts';
import { getSupabaseAdmin } from '../services/supabaseAdmin.ts';
import { requireAdmin } from '../middleware/requireAdmin.ts';
import { GeminiServiceError, generateProductCoverImage } from '../services/gemini.ts';

export const adminImageRouter = Router();

// Allow larger JSON bodies on this route specifically for optional referenceImageBase64 edits
adminImageRouter.use(express.json({ limit: '10mb' }));

// Shared database-backed limit, keyed to the verified admin identity across instances.
const imageGenerationLimiter = createRateLimitMiddleware({
  windowMs: 60_000,
  maxRequests: 6,
  keyPrefix: 'admin-image',
  keyGenerator: (_req, res) => {
    const adminUserId = res.locals.adminUserId;
    return typeof adminUserId === 'string' ? `admin:${adminUserId}` : 'admin:unknown';
  },
});

const GenerateImageBodySchema = z.object({
  productId: z.string().uuid('A valid product id is required.'),
  prompt: z.string().trim().min(10, 'Prompt must be at least 10 characters.').max(3000),
  model: z.string().trim().min(3).max(120).optional(),
  referenceImageBase64: z.string().trim().min(16).max(8_500_000).optional(),
  edit: z.boolean().optional().default(false),
});

adminImageRouter.post('/generate', requireAdmin, imageGenerationLimiter, async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  if (!assertSameOrigin(req, res)) return;

  const parsed = GenerateImageBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: 'Invalid image generation request.',
      details: parsed.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
    return;
  }

  const admin = getSupabaseAdmin();
  if (!admin) {
    res.status(503).json({ error: 'The catalogue service is not configured.' });
    return;
  }

  try {
    const { data: product, error: productError } = await admin
      .from('products')
      .select('id')
      .eq('id', parsed.data.productId)
      .maybeSingle();

    if (productError) {
      res.status(503).json({ error: 'The product could not be checked. Please retry.' });
      return;
    }
    if (!product) {
      res.status(404).json({ error: 'The product no longer exists.' });
      return;
    }

    const result = await generateProductCoverImage({
      prompt: parsed.data.prompt,
      model: parsed.data.model,
      referenceImageBase64: parsed.data.referenceImageBase64,
      edit: parsed.data.edit,
    });

    res.status(200).json({
      imageBase64: result.imageBase64,
      mimeType: result.mimeType,
      modelUsed: result.modelUsed,
    });
  } catch (err) {
    if (err instanceof GeminiServiceError) {
      res.status(err.statusCode).json({
        error: err.message,
        code: err.code,
      });
      return;
    }

    console.error(JSON.stringify({
      event: 'admin_image_generation_failed',
      productId: parsed.data.productId,
      reason: err instanceof Error ? err.name : 'unknown',
    }));
    res.status(500).json({
      error: 'Unable to generate image right now. Please try again.',
    });
  }
});

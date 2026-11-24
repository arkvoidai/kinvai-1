import { Router } from 'express';
import { z } from 'zod';
import { createRateLimitMiddleware } from '../lib/rateLimit.ts';
import { assertSameOrigin } from '../lib/requestSecurity.ts';
import { getSupabaseAdmin } from '../services/supabaseAdmin.ts';

export const formsRouter = Router();

const NewsletterBodySchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address.').max(254, 'Email address is too long.'),
  website: z.string().max(120).optional().default(''),
});

const ContactBodySchema = z.object({
  name: z.string().trim().min(2, 'Enter a name.').max(100, 'Name is too long.'),
  email: z.string().trim().toLowerCase().email('Enter a valid email address.').max(254, 'Email address is too long.'),
  subject: z.string().trim().max(140, 'Subject is too long.').optional().default(''),
  message: z.string().trim().min(10, 'Add a little more detail (at least 10 characters).').max(5000, 'Message is too long.'),
  website: z.string().max(120).optional().default(''),
});

const newsletterLimiter = createRateLimitMiddleware({ windowMs: 60_000, maxRequests: 5, keyPrefix: 'newsletter' });
const contactLimiter = createRateLimitMiddleware({ windowMs: 60 * 60_000, maxRequests: 5, keyPrefix: 'contact' });

export function validateNewsletterPayload(input: unknown) {
  return NewsletterBodySchema.safeParse(input);
}

export function validateContactPayload(input: unknown) {
  return ContactBodySchema.safeParse(input);
}

formsRouter.post('/newsletter', newsletterLimiter, async (req, res) => {
  if (!assertSameOrigin(req, res)) return;
  const parsed = NewsletterBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message || 'Enter a valid email address.' });
    return;
  }
  if (parsed.data.website.trim()) {
    res.status(204).end();
    return;
  }
  const supabaseAdmin = getSupabaseAdmin();
  if (!supabaseAdmin) {
    res.status(503).json({ error: "That didn't work. Try again, or write to heyarkvoid@gmail.com." });
    return;
  }
  try {
    const { error } = await supabaseAdmin.from('newsletter_subscribers').insert({ email: parsed.data.email });
    if (error) {
      if (error.code === '23505' || /duplicate key/i.test(error.message || '')) {
        res.status(200).json({ ok: true, duplicate: true, message: "You're already subscribed — no need to sign up twice." });
        return;
      }
      res.status(500).json({ error: "That didn't work. Try again, or write to heyarkvoid@gmail.com." });
      return;
    }
    res.status(201).json({ ok: true, duplicate: false, message: "You're on the list. Expect quiet notes when new systems ship." });
  } catch {
    res.status(500).json({ error: "That didn't work. Try again, or write to heyarkvoid@gmail.com." });
  }
});

formsRouter.post('/contact', contactLimiter, async (req, res) => {
  if (!assertSameOrigin(req, res)) return;
  const parsed = ContactBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message || 'Check the form and try again.' });
    return;
  }
  // Quietly discard bot submissions; do not create an inbox record.
  if (parsed.data.website.trim()) {
    res.status(204).end();
    return;
  }
  const supabaseAdmin = getSupabaseAdmin();
  if (!supabaseAdmin) {
    res.status(503).json({ error: "The message could not be sent. Please email heyarkvoid@gmail.com instead." });
    return;
  }
  try {
    const { error } = await supabaseAdmin.from('contact_messages').insert({
      name: parsed.data.name,
      email: parsed.data.email,
      subject: parsed.data.subject || null,
      message: parsed.data.message,
    });
    if (error) {
      res.status(500).json({ error: "The message could not be sent. Please email heyarkvoid@gmail.com instead." });
      return;
    }
    res.status(201).json({ ok: true, message: 'Message received. Thank you for writing.' });
  } catch {
    res.status(500).json({ error: "The message could not be sent. Please email heyarkvoid@gmail.com instead." });
  }
});

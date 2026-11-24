import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent, type DragEvent } from 'react';
import { z } from 'zod';
import { ArrowDown, ArrowUp, FileImage, Plus, Search, Sparkles, Trash2, UploadCloud } from 'lucide-react';
import { Button, Checkbox, Input, Sheet, Skeleton, TagPill, Tile, useToast } from '../../components/primitives';
import { useAuth } from '../../lib/auth/AuthProvider';
import { getSupabaseBrowserClient } from '../../lib/supabase/client';
import { getProductMediaSrcSet, getProductMediaVariantPath } from '../../lib/media/imagePipeline';
import { getPublicConfig } from '../../lib/config';
import type { Collection, Product, ProductMedia, ProductFile } from '../../lib/data/types';
import {
  ImageUploadSchema,
  ProductDraftSchema,
  base64ToBlob,
  buildCoverPrompt,
  emptyProductDraft,
  formatUsd,
  generateAdminImage,
  productToDraft,
  slugify,
  storeProductImage,
  toProductPayload,
  type ProductDraft,
} from './adminHelpers';

const fieldClass = 'w-full min-h-[44px] rounded-[14px] border border-line bg-surface px-4 py-2.5 text-base text-ink placeholder:text-ink-3 focus:border-ink focus:outline-2 focus:outline-brand';
const areaClass = 'w-full min-h-[112px] rounded-[14px] border border-line bg-surface px-4 py-3 text-base text-ink placeholder:text-ink-3 focus:border-ink focus:outline-2 focus:outline-brand';
const statusTone: Record<string, string> = {
  published: 'bg-[#E6F2EB] text-[#1E7A4F]',
  draft: 'bg-stone text-ink-2',
  review: 'bg-[#FFF2D8] text-[#946315]',
  archived: 'bg-[#F8E7E7] text-[#9F2626]',
};

function imageUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  return getProductMediaSrcSet(path)?.src || null;
}

function ErrorText({ children }: { children: string }) {
  return <p role="alert" className="text-sm text-error mt-1">{children}</p>;
}

function FieldLabel({ children, hint }: { children: string; hint?: string }) {
  return <div className="flex items-baseline justify-between gap-3"><label className="text-sm font-medium text-ink">{children}</label>{hint ? <span className="text-xs text-ink-3">{hint}</span> : null}</div>;
}

function AdminProductCard({ product, files, onEdit, onFeature, onStatus }: {
  product: Product;
  files: ProductFile[];
  onEdit: () => void;
  onFeature: () => void;
  onStatus: (status: Product['status']) => void;
}) {
  const src = imageUrl(product.cover_path);
  return (
    <article className="rounded-[24px] border border-line bg-surface p-3 flex gap-3 items-start">
      <button type="button" onClick={onEdit} className="w-[92px] aspect-[4/5] rounded-[16px] overflow-hidden bg-stone shrink-0 focus-visible:outline-2 focus-visible:outline-brand" aria-label={'Edit ' + product.name}>
        {src ? <img src={src} alt="" className="w-full h-full object-cover" /> : <div className="h-full flex items-center justify-center text-ink-3"><FileImage size={24} /></div>}
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs font-mono text-ink-3">{product.sku}</p>
            <button type="button" onClick={onEdit} className="text-left text-[15px] font-semibold text-ink leading-snug hover:underline underline-offset-4">{product.name}</button>
          </div>
          <span className={'rounded-full px-2.5 py-1 text-[11px] font-medium capitalize shrink-0 ' + (statusTone[product.status] || 'bg-stone')}>{product.status}</span>
        </div>
        <p className="text-sm text-ink-2 mt-1">{formatUsd(product.price_cents)}</p>
        <div className="flex items-center flex-wrap gap-2 mt-3">
          <label className="inline-flex items-center gap-2 text-xs text-ink-2 min-h-[36px]">
            <input type="checkbox" checked={product.is_featured} onChange={onFeature} className="accent-[#111111] w-4 h-4" /> Featured
          </label>
          <select aria-label={'Status for ' + product.name} value={product.status} onChange={(event) => onStatus(event.target.value as Product['status'])} className="h-9 rounded-full border border-line bg-surface px-3 text-xs capitalize">
            <option value="draft">Draft</option><option value="review">Review</option><option value="published">Published</option><option value="archived">Archived</option>
          </select>
          <span className="text-xs text-ink-3">{files.filter((file) => file.product_id === product.id && file.is_active).length} active files</span>
          <button type="button" onClick={onEdit} className="ml-auto text-xs font-medium underline underline-offset-4 min-h-[36px]">Edit</button>
        </div>
      </div>
    </article>
  );
}

function ProductEditor({ initialProduct, collections, onClose, onSaved }: {
  initialProduct: Product | null;
  collections: Collection[];
  onClose: () => void;
  onSaved: (product: Product) => void;
}) {
  const client = getSupabaseBrowserClient();
  const { toast } = useToast();
  const [product, setProduct] = useState<Product | null>(initialProduct);
  const [draft, setDraft] = useState<ProductDraft>(() => initialProduct ? productToDraft(initialProduct) : emptyProductDraft(collections[0]?.id || ''));
  const [activeTab, setActiveTab] = useState<'details' | 'images' | 'files'>('details');
  const [saving, setSaving] = useState(false);
  const [slugState, setSlugState] = useState<'idle' | 'checking' | 'available' | 'taken'>('idle');
  const [files, setFiles] = useState<ProductFile[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [formError, setFormError] = useState('');
  const savedSnapshot = useRef(JSON.stringify(draft));
  const isDirty = JSON.stringify(draft) !== savedSnapshot.current;

  useEffect(() => {
    if (!product || !client) return;
    let active = true;
    setFilesLoading(true);
    client.from('product_files').select('*').eq('product_id', product.id).order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (!active) return;
        if (error) toast({ title: 'Files could not be loaded', description: error.message, tone: 'error' });
        setFiles((data || []) as ProductFile[]);
        setFilesLoading(false);
      });
    return () => { active = false; };
  }, [client, product?.id, toast]);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!isDirty) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [isDirty]);

  const persist = useCallback(async (statusOverride?: ProductDraft['status'], silent = false): Promise<Product | null> => {
    if (!client) {
      setFormError('Connect Supabase before editing the catalogue.');
      return null;
    }
    const candidate = { ...draft, status: statusOverride || draft.status };
    const parsed = ProductDraftSchema.safeParse(candidate);
    if (!parsed.success) {
      const message = parsed.error.issues[0]?.message || 'Check the product fields and try again.';
      setFormError(message);
      if (!silent) toast({ title: 'Product needs attention', description: message, tone: 'error' });
      return null;
    }
    setSaving(true);
    setFormError('');
    try {
      const duplicateQuery = client.from('products').select('id').eq('slug', parsed.data.slug);
      const { data: duplicate, error: duplicateError } = product
        ? await duplicateQuery.neq('id', product.id).maybeSingle()
        : await duplicateQuery.maybeSingle();
      if (duplicateError) throw duplicateError;
      if (duplicate) throw new Error('That slug is already in use. Choose a unique slug.');
      const payload = toProductPayload(parsed.data);
      const result = product
        ? await client.from('products').update(payload).eq('id', product.id).select('*').single()
        : await client.from('products').insert(payload).select('*').single();
      if (result.error || !result.data) throw result.error || new Error('The product could not be saved.');
      const saved = result.data as Product;
      setProduct(saved);
      setDraft(productToDraft(saved));
      savedSnapshot.current = JSON.stringify(productToDraft(saved));
      onSaved(saved);
      if (!silent) toast({ title: statusOverride === 'published' ? 'Product published' : 'Product saved', tone: 'success' });
      return saved;
    } catch (error) {
      const raw = error instanceof Error ? error.message : 'The product could not be saved.';
      const friendly = /Attach at least one active file before publishing/i.test(raw)
        ? 'Attach at least one active file before publishing.'
        : raw;
      setFormError(friendly);
      if (!silent) toast({ title: 'Could not save product', description: friendly, tone: 'error' });
      return null;
    } finally {
      setSaving(false);
    }
  }, [client, draft, product, onSaved, toast]);

  useEffect(() => {
    if (!product || product.status !== 'draft' || !isDirty) return;
    const timer = window.setTimeout(() => { void persist('draft', true); }, 1400);
    return () => window.clearTimeout(timer);
  }, [product, draft, isDirty, persist]);

  const close = () => {
    if (isDirty && !window.confirm('There are unsaved changes. Close this editor?')) return;
    onClose();
  };

  const update = <K extends keyof ProductDraft>(key: K, value: ProductDraft[K]) => {
    setDraft((previous) => ({ ...previous, [key]: value }));
    setFormError('');
  };

  const verifySlug = async () => {
    if (!client || !draft.slug) return;
    const valid = /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(draft.slug);
    if (!valid) { setSlugState('taken'); return; }
    setSlugState('checking');
    let query = client.from('products').select('id').eq('slug', draft.slug);
    if (product) query = query.neq('id', product.id);
    const { data, error } = await query.maybeSingle();
    setSlugState(error ? 'idle' : data ? 'taken' : 'available');
  };

  return (
    <Sheet open onClose={close} title={product ? 'Edit product' : 'New product'} description="Catalogue changes save through the signed-in owner session and Supabase RLS." widthClass="md:max-w-[1040px]">
      <div className="space-y-5">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex gap-2" role="tablist" aria-label="Product editor sections">
            {(['details', 'images', 'files'] as const).map((tab) => (
              <button key={tab} type="button" role="tab" aria-selected={activeTab === tab} onClick={() => setActiveTab(tab)} className={'rounded-full px-4 min-h-[40px] text-sm capitalize ' + (activeTab === tab ? 'bg-ink text-white' : 'bg-stone text-ink-2')}>{tab}</button>
            ))}
          </div>
          <div className="text-xs text-ink-3" aria-live="polite">{saving ? 'Saving…' : isDirty ? 'Unsaved changes' : 'All changes saved'}</div>
        </div>
        {activeTab === 'details' && (
          <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_320px] gap-6">
            <form className="space-y-4 min-w-0" onSubmit={(event: FormEvent) => { event.preventDefault(); void persist(); }}>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Input label="Product name" value={draft.name} onChange={(e) => update('name', e.target.value)} required maxLength={120} />
                <div className="space-y-1.5">
                  <FieldLabel hint={slugState === 'available' ? 'Available' : slugState === 'taken' ? 'Already used or invalid' : 'Unique URL segment'}>Slug</FieldLabel>
                  <div className="flex gap-2"><input className={fieldClass} value={draft.slug} onChange={(e) => { update('slug', e.target.value); setSlugState('idle'); }} onBlur={() => void verifySlug()} required /><button type="button" onClick={() => { update('slug', slugify(draft.name)); setSlugState('idle'); }} className="rounded-full border border-line px-3 text-xs min-h-[44px]">Make</button></div>
                  {slugState === 'taken' ? <ErrorText>Slug is invalid or already in use.</ErrorText> : slugState === 'available' ? <p className="text-xs text-success">This slug is available.</p> : null}
                </div>
                <Input label="SKU" value={draft.sku} onChange={(e) => update('sku', e.target.value)} required maxLength={64} />
                <Input label="Tagline" value={draft.tagline} onChange={(e) => update('tagline', e.target.value)} maxLength={180} />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Input label="Short description" value={draft.short_description} onChange={(e) => update('short_description', e.target.value)} required maxLength={320} />
                <div className="space-y-1.5"><FieldLabel>Collection</FieldLabel><select className={fieldClass} value={draft.collection_id} onChange={(e) => update('collection_id', e.target.value)} required><option value="">Choose a collection</option>{collections.map((collection) => <option key={collection.id} value={collection.id}>{collection.name}</option>)}</select></div>
              </div>
              <div className="space-y-1.5"><FieldLabel hint="Shown on the product page">Long description</FieldLabel><textarea className={areaClass} value={draft.description} onChange={(e) => update('description', e.target.value)} maxLength={12000} rows={6} /></div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Input label="Price (USD)" inputMode="decimal" value={draft.price_usd} onChange={(e) => update('price_usd', e.target.value)} required hint="Stored as integer USD cents." />
                <Input label="Formats" value={draft.file_formats} onChange={(e) => update('file_formats', e.target.value)} hint="Comma separated: XLSX, PDF, ZIP" />
                <Input label="Tags" value={draft.tags} onChange={(e) => update('tags', e.target.value)} hint="Comma separated" />
                <Input label="Audience" value={draft.audience} onChange={(e) => update('audience', e.target.value)} hint="Comma separated" />
              </div>
              <div className="space-y-1.5"><FieldLabel>What's included</FieldLabel><textarea className={areaClass} value={draft.includes} onChange={(e) => update('includes', e.target.value)} rows={4} placeholder="One item per line" /></div>
              <div className="space-y-1.5"><FieldLabel>First hour</FieldLabel><textarea className={areaClass} value={draft.first_hour} onChange={(e) => update('first_hour', e.target.value)} rows={3} placeholder="One step per line" /></div>
              <div className="space-y-1.5"><FieldLabel>Requirements</FieldLabel><textarea className={areaClass} value={draft.requirements} onChange={(e) => update('requirements', e.target.value)} rows={2} /></div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5"><FieldLabel hint={draft.seo_title.length + '/70'}>SEO title</FieldLabel><input className={fieldClass} value={draft.seo_title} onChange={(e) => update('seo_title', e.target.value.slice(0, 70))} maxLength={70} /></div>
                <div className="space-y-1.5"><FieldLabel hint={draft.seo_description.length + '/180'}>SEO description</FieldLabel><textarea className={areaClass + ' min-h-[44px]'} rows={2} value={draft.seo_description} onChange={(e) => update('seo_description', e.target.value.slice(0, 180))} maxLength={180} /></div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
                <label className="space-y-1.5 text-sm"><FieldLabel>Featured rank</FieldLabel><input className={fieldClass} value={draft.featured_rank} onChange={(e) => update('featured_rank', e.target.value)} inputMode="numeric" placeholder="0" /></label>
                <div className="sm:col-span-2 flex flex-wrap gap-4"><Checkbox label="Featured product" checked={draft.is_featured} onChange={(e) => update('is_featured', e.target.checked)} /><label className="space-y-1.5 text-sm flex-1 min-w-[160px]"><FieldLabel>Status</FieldLabel><select className={fieldClass} value={draft.status} onChange={(e) => update('status', e.target.value as ProductDraft['status'])}><option value="draft">Draft</option><option value="review">Review</option><option value="published">Published</option><option value="archived">Archived</option></select></label></div>
              </div>
              {formError ? <ErrorText>{formError}</ErrorText> : null}
              <div className="flex flex-wrap gap-2 pt-2">
                <Button type="submit" loading={saving}>Save changes</Button>
                <Button type="button" variant="secondary" disabled={saving} onClick={() => void persist('draft')}>Save draft</Button>
                <Button type="button" variant="secondary" disabled={saving || !product} onClick={() => void persist('published')}>Publish</Button>
              </div>
              {draft.status === 'published' && !files.some((file) => file.is_active) ? <p className="text-sm text-ink-2">Publishing requires one active deliverable. Add it in Files first.</p> : null}
            </form>
            <aside className="hidden xl:block space-y-3">
              <p className="text-xs uppercase tracking-[0.08em] text-ink-3 font-medium">Live preview</p>
              <Tile variant="white" padding="sm" radius="lg" className="space-y-3">
                <div className="aspect-[4/5] rounded-[20px] overflow-hidden bg-stone">
                  {product?.cover_path && imageUrl(product.cover_path) ? <img src={imageUrl(product.cover_path) || ''} alt="" className="w-full h-full object-cover" /> : <div className="h-full flex items-center justify-center text-ink-3"><FileImage size={30} /></div>}
                </div>
                <div><p className="text-xs text-ink-3">{collections.find((item) => item.id === draft.collection_id)?.name || 'Collection'}</p><h3 className="font-semibold text-ink text-lg mt-1">{draft.name || 'Product title'}</h3><p className="text-sm text-ink-2 mt-1 line-clamp-2">{draft.tagline || draft.short_description || 'Product tagline preview'}</p><p className="font-mono text-sm mt-3">{draft.price_usd ? '$' + draft.price_usd : '$0.00'}</p></div>
              </Tile>
              <Tile variant="soft" padding="md"><p className="text-xs uppercase tracking-[0.08em] text-ink-3">Product page cover</p><div className="aspect-[4/5] rounded-[18px] overflow-hidden bg-stone mt-3">{product?.cover_path && imageUrl(product.cover_path) ? <img src={imageUrl(product.cover_path) || ''} alt="" className="w-full h-full object-cover" /> : <p className="h-full flex items-center justify-center text-sm text-ink-3">Cover not set</p>}</div></Tile>
            </aside>
          </div>
        )}
        {activeTab === 'images' ? product ? <ImageStudio product={product} collection={collections.find((item) => item.id === product.collection_id) || null} onProductUpdate={(updated) => { setProduct(updated); onSaved(updated); }} /> : <Tile variant="soft" padding="lg"><p className="text-sm text-ink-2">Save this draft first. Image files need a product ID for their storage path.</p><Button onClick={() => void persist('draft')}>Create product draft</Button></Tile> : null}
        {activeTab === 'files' ? product ? <FilesManager product={product} files={files} loading={filesLoading} onFilesChange={setFiles} /> : <Tile variant="soft" padding="lg"><p className="text-sm text-ink-2">Save this draft first. Deliverables are attached to a product record.</p><Button onClick={() => void persist('draft')}>Create product draft</Button></Tile> : null}
      </div>
    </Sheet>
  );
}

function ImageStudio({ product, collection, onProductUpdate }: {
  product: Product;
  collection: Collection | null;
  onProductUpdate: (product: Product) => void;
}) {
  const client = getSupabaseBrowserClient();
  const { toast } = useToast();
  const { user } = useAuth();
  const [media, setMedia] = useState<ProductMedia[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploadAlt, setUploadAlt] = useState(product.name + ' product cover');
  const [setUploadAsCover, setSetUploadAsCover] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [prompt, setPrompt] = useState(product.image_prompt || buildCoverPrompt(product, collection));
  const [model, setModel] = useState<'fast' | 'best'>('fast');
  const [generating, setGenerating] = useState(false);
  const [generationStep, setGenerationStep] = useState(0);
  const [options, setOptions] = useState<Array<{ id: string; imageBase64: string; mimeType: string; modelUsed: string }>>([]);
  const [refineId, setRefineId] = useState<string | null>(null);
  const [refineNote, setRefineNote] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const refreshMedia = useCallback(async () => {
    if (!client) return;
    setLoading(true);
    const { data, error } = await client.from('product_media').select('*').eq('product_id', product.id).order('sort_order', { ascending: true });
    if (error) toast({ title: 'Images could not be loaded', description: error.message, tone: 'error' });
    setMedia((data || []) as ProductMedia[]);
    setLoading(false);
  }, [client, product.id, toast]);

  useEffect(() => { void refreshMedia(); }, [refreshMedia]);

  const makeCover = async (item: ProductMedia) => {
    if (!client) return;
    const { error: clearError } = await client.from('product_media').update({ kind: 'gallery' }).eq('product_id', product.id).eq('kind', 'cover');
    if (clearError) { toast({ title: 'Cover was not changed', description: clearError.message, tone: 'error' }); return; }
    const { error } = await client.from('product_media').update({ kind: 'cover' }).eq('id', item.id);
    if (error) { toast({ title: 'Cover was not changed', description: error.message, tone: 'error' }); return; }
    const { error: updateError } = await client.from('products').update({ cover_path: item.storage_path }).eq('id', product.id);
    if (updateError) { toast({ title: 'Cover was not changed', description: updateError.message, tone: 'error' }); return; }
    onProductUpdate({ ...product, cover_path: item.storage_path });
    await refreshMedia();
    toast({ title: 'Cover updated across the storefront', tone: 'success' });
  };

  const removeMedia = async (item: ProductMedia) => {
    if (!client || !window.confirm('Delete this image from the product?')) return;
    const paths = [480, 960, 1600].map((width) => getProductMediaVariantPath(item.storage_path, width as 480 | 960 | 1600));
    const { error: storageError } = await client.storage.from('product-media').remove(paths);
    if (storageError) { toast({ title: 'Image could not be deleted', description: storageError.message, tone: 'error' }); return; }
    const { error } = await client.from('product_media').delete().eq('id', item.id);
    if (error) { toast({ title: 'Image record could not be deleted', description: error.message, tone: 'error' }); return; }
    if (product.cover_path === item.storage_path) {
      await client.from('products').update({ cover_path: null }).eq('id', product.id);
      onProductUpdate({ ...product, cover_path: null });
    }
    await refreshMedia();
    toast({ title: 'Image removed', tone: 'success' });
  };

  const saveAlt = async (item: ProductMedia, alt: string) => {
    if (!client) return;
    if (!alt.trim()) { toast({ title: 'Alt text is required', tone: 'error' }); return; }
    const { error } = await client.from('product_media').update({ alt: alt.trim() }).eq('id', item.id);
    if (error) toast({ title: 'Alt text could not be saved', description: error.message, tone: 'error' });
    else toast({ title: 'Alt text saved', tone: 'success' });
  };

  const reorder = async (item: ProductMedia, direction: -1 | 1) => {
    if (!client) return;
    const index = media.findIndex((entry) => entry.id === item.id);
    const swap = media[index + direction];
    if (!swap) return;
    const { error } = await client.from('product_media').update({ sort_order: swap.sort_order }).eq('id', item.id);
    const { error: swapError } = await client.from('product_media').update({ sort_order: item.sort_order }).eq('id', swap.id);
    if (error || swapError) toast({ title: 'Image order did not save', description: (error || swapError)?.message, tone: 'error' });
    else await refreshMedia();
  };

  const saveImage = async (blob: Blob, alt: string, source: 'upload' | 'gemini', asCover: boolean) => {
    if (!client) throw new Error('Supabase is not configured.');
    const saved = await storeProductImage(client, product, blob, alt, source, asCover);
    if (asCover) onProductUpdate({ ...product, cover_path: saved.storage_path });
    await refreshMedia();
    return saved;
  };

  const acceptUpload = async (file: File | undefined) => {
    if (!file) return;
    const validation = ImageUploadSchema.safeParse(file);
    if (!validation.success) { toast({ title: 'Unsupported image', description: validation.error.issues[0]?.message, tone: 'error' }); return; }
    if (!uploadAlt.trim()) { toast({ title: 'Add alt text before uploading', tone: 'error' }); return; }
    setUploading(true);
    try {
      await saveImage(file, uploadAlt, 'upload', setUploadAsCover);
      toast({ title: setUploadAsCover ? 'Cover uploaded' : 'Image added to gallery', tone: 'success' });
    } catch (error) {
      toast({ title: 'Image upload failed', description: error instanceof Error ? error.message : 'Try again.', tone: 'error' });
    } finally { setUploading(false); }
  };

  const handleUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    await acceptUpload(file);
  };

  const handleImageDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    void acceptUpload(event.dataTransfer.files?.[0]);
  };

  const savePrompt = async () => {
    if (!client) return;
    const { error } = await client.from('products').update({ image_prompt: prompt }).eq('id', product.id);
    if (error) toast({ title: 'Art direction could not be saved', description: error.message, tone: 'error' });
    else { onProductUpdate({ ...product, image_prompt: prompt }); toast({ title: 'Art direction saved', tone: 'success' }); }
  };

  const requestGeneration = async (referenceImageBase64?: string, note?: string) => {
    if (!client || !user) throw new Error('Sign in again before generating images.');
    const { data: sessionData, error } = await client.auth.getSession();
    if (error || !sessionData.session?.access_token) throw new Error('Your session expired. Sign in again.');
    const artDirection = prompt.trim() + (note ? '\nRefinement: ' + note.trim() : '');
    return generateAdminImage(
      sessionData.session.access_token,
      product.id,
      artDirection,
      model === 'best' ? 'gemini-3-pro-image' : undefined,
      referenceImageBase64
    );
  };

  const generateThree = async () => {
    setGenerating(true);
    setGenerationStep(0);
    setOptions([]);
    try {
      for (let index = 0; index < 3; index += 1) {
        setGenerationStep(index + 1);
        const result = await requestGeneration();
        setOptions((previous) => [...previous, { id: crypto.randomUUID(), ...result }]);
      }
      toast({ title: 'Three cover options are ready', tone: 'success' });
    } catch (error) {
      toast({ title: 'Image generation stopped', description: error instanceof Error ? error.message : 'Try again.', tone: 'error' });
    } finally { setGenerating(false); }
  };

  const refine = async (option: { id: string; imageBase64: string; mimeType: string; modelUsed: string }) => {
    if (!refineNote.trim()) { toast({ title: 'Add a short refinement note', tone: 'error' }); return; }
    try {
      const reference = 'data:' + option.mimeType + ';base64,' + option.imageBase64;
      const result = await requestGeneration(reference, refineNote);
      setOptions((previous) => previous.map((entry) => entry.id === option.id ? { ...entry, ...result } : entry));
      setRefineId(null);
      setRefineNote('');
      toast({ title: 'Refined option is ready', tone: 'success' });
    } catch (error) {
      toast({ title: 'Refinement failed', description: error instanceof Error ? error.message : 'Try again.', tone: 'error' });
    }
  };

  const saveOption = async (option: { id: string; imageBase64: string; mimeType: string; modelUsed: string }, asCover: boolean) => {
    setUploading(true);
    try {
      const blob = base64ToBlob(option.imageBase64, option.mimeType);
      const alt = product.name + ' — generated product cover';
      await saveImage(blob, alt, 'gemini', asCover);
      setOptions((previous) => previous.filter((entry) => entry.id !== option.id));
      toast({ title: asCover ? 'Generated cover applied' : 'Generated image added to gallery', tone: 'success' });
    } catch (error) {
      toast({ title: 'Could not save generated image', description: error instanceof Error ? error.message : 'Try again.', tone: 'error' });
    } finally { setUploading(false); }
  };

  const cover = media.find((item) => item.kind === 'cover') || media.find((item) => item.storage_path === product.cover_path);
  const gallery = media.filter((item) => item.id !== cover?.id);

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <div className="flex justify-between items-center gap-3"><h3 className="font-semibold text-ink">Current cover and gallery</h3><span className="text-xs text-ink-3">{media.length} images</span></div>
        {loading ? <Skeleton className="h-44 w-full" rounded="lg" /> : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {cover ? <MediaTile key={cover.id} item={cover} isCover onCover={() => void makeCover(cover)} onDelete={() => void removeMedia(cover)} onAltSave={saveAlt} onMove={(direction) => void reorder(cover, direction)} /> : <div className="aspect-[4/5] rounded-[18px] border border-dashed border-line-strong flex flex-col items-center justify-center gap-2 text-center p-3"><FileImage size={24} className="text-ink-3" /><span className="text-sm text-ink-2">No cover set</span></div>}
            {gallery.map((item) => <MediaTile key={item.id} item={item} onCover={() => void makeCover(item)} onDelete={() => void removeMedia(item)} onAltSave={saveAlt} onMove={(direction) => void reorder(item, direction)} />)}
          </div>
        )}
      </section>
      <section className="rounded-[24px] bg-page border border-line p-4 sm:p-5 space-y-3">
        <h3 className="font-semibold text-ink">Upload my own</h3>
        <p className="text-sm text-ink-2">JPG, PNG, WebP or AVIF. Up to 10 MB. Images are converted to responsive WebP files.</p>
        <Input label="Required alt text" value={uploadAlt} onChange={(event) => setUploadAlt(event.target.value)} placeholder="Describe the image" />
        <Checkbox label="Set this upload as the cover" checked={setUploadAsCover} onChange={(event) => setSetUploadAsCover(event.target.checked)} />
        <div
          onDragOver={(event) => event.preventDefault()}
          onDrop={handleImageDrop}
          className="rounded-[18px] border border-dashed border-line-strong bg-page p-4 sm:p-6 text-center space-y-2"
        >
          <UploadCloud size={24} className="mx-auto text-ink-3" aria-hidden="true" />
          <p className="text-sm font-medium text-ink">Drop an image here</p>
          <p className="text-xs text-ink-3">or choose a file from this device</p>
          <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp,image/avif" className="sr-only" onChange={(event) => void handleUpload(event)} />
          <Button loading={uploading} onClick={() => inputRef.current?.click()}>Choose image</Button>
        </div>
      </section>
      <section className="rounded-[24px] border border-line bg-surface p-4 sm:p-5 space-y-4">
        <div className="flex flex-wrap justify-between items-center gap-3"><div><h3 className="font-semibold text-ink">Generate with Gemini</h3><p className="text-sm text-ink-2 mt-1">Three concepts, returned one at a time.</p></div><TagPill tone="brand">Image generation</TagPill></div>
        <div className="space-y-1.5"><FieldLabel>Art direction</FieldLabel><textarea className={areaClass} rows={5} value={prompt} onChange={(event) => setPrompt(event.target.value)} /><div className="flex flex-wrap items-center justify-between gap-2"><Button variant="secondary" size="sm" onClick={() => void savePrompt()}>Save art direction</Button><label className="flex items-center gap-2 text-sm text-ink-2"><span>Model</span><select value={model} onChange={(event) => setModel(event.target.value as 'fast' | 'best')} className="min-h-[40px] rounded-full bg-page border border-line px-3 text-sm"><option value="fast">Fast · gemini-3.1-flash-image</option><option value="best">Best · gemini-3-pro-image</option></select></label></div></div>
        <Button disabled={generating || uploading} loading={generating} onClick={() => void generateThree()} icon={<Sparkles size={18} />}>Generate 3 options</Button>
        {generating ? <div className="space-y-2" aria-live="polite"><p className="text-sm text-ink-2">Generating option {generationStep} of 3…</p><div className="grid grid-cols-3 gap-3">{[0,1,2].map((i) => options[i] ? <div key={options[i].id} className="aspect-[4/5] rounded-[16px] overflow-hidden bg-stone"><img src={'data:' + options[i].mimeType + ';base64,' + options[i].imageBase64} alt="Generated option" className="w-full h-full object-cover" /></div> : <Skeleton key={i} className="aspect-[4/5] w-full" rounded="lg" />)}</div></div> : null}
        {options.length > 0 ? <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">{options.map((option, index) => <article key={option.id} className="rounded-[18px] border border-line p-2.5 space-y-2"><div className="aspect-[4/5] rounded-[14px] overflow-hidden bg-stone"><img src={'data:' + option.mimeType + ';base64,' + option.imageBase64} alt={'Generated cover option ' + (index + 1)} className="w-full h-full object-cover" /></div><p className="text-xs text-ink-3">Option {index + 1} · {option.modelUsed}</p><div className="flex flex-wrap gap-2"><Button size="sm" onClick={() => void saveOption(option, true)} disabled={uploading}>Use as cover</Button><Button size="sm" variant="secondary" onClick={() => void saveOption(option, false)} disabled={uploading}>Add to gallery</Button></div><button type="button" onClick={() => { setRefineId(refineId === option.id ? null : option.id); setRefineNote(''); }} className="text-sm underline underline-offset-4 min-h-[36px]">Refine…</button><button type="button" onClick={() => setOptions((previous) => previous.filter((entry) => entry.id !== option.id))} className="text-sm text-ink-2 underline underline-offset-4 min-h-[36px] ml-3">Discard</button>{refineId === option.id ? <div className="space-y-2"><textarea className={areaClass} rows={2} value={refineNote} onChange={(event) => setRefineNote(event.target.value)} placeholder="What should change?" /><Button size="sm" onClick={() => void refine(option)}>Refine image</Button></div> : null}</article>)}</div> : null}
        <p className="text-xs text-ink-3">Generated images carry an invisible SynthID watermark.</p>
      </section>
    </div>
  );
}

function MediaTile({ item, isCover = false, onCover, onDelete, onAltSave, onMove }: {
  item: ProductMedia;
  isCover?: boolean;
  onCover: () => void;
  onDelete: () => void;
  onAltSave: (item: ProductMedia, alt: string) => Promise<void>;
  onMove: (direction: -1 | 1) => void;
}) {
  const [alt, setAlt] = useState(item.alt || '');
  const src = imageUrl(item.storage_path);
  return (
    <article className="rounded-[18px] border border-line bg-surface p-2 space-y-2">
      <div className="aspect-[4/5] rounded-[12px] overflow-hidden bg-stone relative">{src ? <img src={src} alt={item.alt || ''} className="w-full h-full object-cover" /> : null}{isCover ? <span className="absolute left-2 top-2 rounded-full bg-ink text-white px-2 py-1 text-[10px]">Cover</span> : null}</div>
      <label className="block text-xs text-ink-2">Alt text<input className="mt-1 w-full rounded-[10px] border border-line px-2.5 py-2 text-sm" value={alt} onChange={(event) => setAlt(event.target.value)} onBlur={() => void onAltSave(item, alt)} /></label>
      <div className="flex flex-wrap gap-1.5"><button type="button" onClick={onCover} disabled={isCover} className="rounded-full bg-stone px-2.5 py-2 text-xs disabled:opacity-50">{isCover ? 'Current cover' : 'Set as cover'}</button><button type="button" onClick={() => onMove(-1)} aria-label="Move image earlier" title="Move earlier" className="w-8 h-8 inline-flex items-center justify-center rounded-full border border-line"><ArrowUp size={14} /></button><button type="button" onClick={() => onMove(1)} aria-label="Move image later" title="Move later" className="w-8 h-8 inline-flex items-center justify-center rounded-full border border-line"><ArrowDown size={14} /></button><button type="button" onClick={onDelete} aria-label="Delete image" title="Delete image" className="w-8 h-8 inline-flex items-center justify-center rounded-full border border-line text-error ml-auto"><Trash2 size={14} /></button></div>
    </article>
  );
}

function FilesManager({ product, files, loading, onFilesChange }: {
  product: Product;
  files: ProductFile[];
  loading: boolean;
  onFilesChange: (files: ProductFile[]) => void;
}) {
  const client = getSupabaseBrowserClient();
  const { toast } = useToast();
  const uploadRef = useRef<{ abort: (shouldTerminate?: boolean) => Promise<void>; start: () => void } | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [version, setVersion] = useState(product.version || '1.0');
  const [progress, setProgress] = useState(0);
  const [uploadState, setUploadState] = useState<'idle' | 'uploading' | 'paused' | 'error'>('idle');
  const [uploadError, setUploadError] = useState('');
  const [isReplacing, setIsReplacing] = useState(false);

  const chooseFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] || null;
    event.target.value = '';
    if (!file) return;
    const schema = zFileSchema.safeParse({ name: file.name, size: file.size, type: file.type });
    if (!schema.success) { toast({ title: 'File not accepted', description: schema.error.issues[0]?.message, tone: 'error' }); return; }
    setSelectedFile(file);
    setProgress(0);
    setUploadError('');
  };

  const startUpload = async () => {
    if (!client || !selectedFile) return;
    const { data: sessionData, error: sessionError } = await client.auth.getSession();
    if (sessionError || !sessionData.session?.access_token) { setUploadError('The sign-in session has expired. Sign in again.'); setUploadState('error'); return; }
    const cfg = getPublicConfig();
    const projectMatch = cfg.supabaseUrl.match(/^https:\/\/([a-z0-9-]+)\.supabase\.co/i);
    const endpoint = projectMatch
      ? 'https://' + projectMatch[1] + '.storage.supabase.co/storage/v1/upload/resumable'
      : cfg.supabaseUrl.replace(/\/+$/, '') + '/storage/v1/upload/resumable';
    const fileId = crypto.randomUUID();
    const objectPath = 'products/' + product.id + '/' + fileId + '/' + selectedFile.name.replace(/[^a-zA-Z0-9._-]/g, '-');
    const checksumBuffer = await crypto.subtle.digest('SHA-256', await selectedFile.arrayBuffer());
    const checksum = Array.from(new Uint8Array(checksumBuffer)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
    const { Upload } = await import('tus-js-client');
    const upload = new Upload(selectedFile, {
      endpoint,
      retryDelays: [0, 3000, 5000, 10000, 20000],
      headers: {
        authorization: 'Bearer ' + sessionData.session.access_token,
        apikey: cfg.supabasePublishableKey,
        'x-upsert': 'false',
      },
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      chunkSize: 6 * 1024 * 1024,
      metadata: {
        bucketName: 'product-files',
        objectName: objectPath,
        contentType: selectedFile.type || 'application/octet-stream',
        cacheControl: '3600',
      },
      onError: (error) => {
        setUploadState('error');
        setUploadError(error.message || 'The resumable upload failed. Retry it.');
      },
      onProgress: (uploaded, total) => setProgress(total > 0 ? Math.round((uploaded / total) * 100) : 0),
      onSuccess: async () => {
        try {
          const { data, error } = await client.from('product_files').insert({
            id: fileId,
            product_id: product.id,
            storage_path: objectPath,
            file_name: selectedFile.name,
            mime_type: selectedFile.type || null,
            size_bytes: selectedFile.size,
            version: version.trim() || '1.0',
            checksum_sha256: checksum,
            is_active: true,
          }).select('*').single();
          if (error || !data) throw error || new Error('File metadata could not be saved.');
          onFilesChange(isReplacing ? [data as ProductFile, ...files.map((item) => ({ ...item, is_active: false }))] : [data as ProductFile, ...files]);
          if (isReplacing) {
            const { error: deactivateError } = await client.from('product_files').update({ is_active: false }).eq('product_id', product.id).neq('id', fileId);
            if (deactivateError) toast({ title: 'New version uploaded; previous files remain active', description: deactivateError.message, tone: 'error' });
          }
          toast({ title: 'Product file uploaded', tone: 'success' });
          setUploadState('idle');
          setSelectedFile(null);
        } catch (error) {
          setUploadState('error');
          setUploadError(error instanceof Error ? error.message : 'File metadata could not be saved.');
        }
      },
    });
    uploadRef.current = upload;
    setUploadState('uploading');
    setUploadError('');
    upload.findPreviousUploads().then((previous) => {
      if (previous.length) upload.resumeFromPreviousUpload(previous[0]);
      upload.start();
    }).catch(() => upload.start());
  };

  const pauseUpload = async () => {
    await uploadRef.current?.abort(false);
    setUploadState('paused');
  };

  const toggleActive = async (file: ProductFile) => {
    if (!client) return;
    const next = !file.is_active;
    onFilesChange(files.map((item) => item.id === file.id ? { ...item, is_active: next } : item));
    const { error } = await client.from('product_files').update({ is_active: next }).eq('id', file.id);
    if (error) {
      onFilesChange(files);
      toast({ title: 'File status was not changed', description: error.message, tone: 'error' });
    }
  };

  const testDownload = async (file: ProductFile) => {
    if (!client) return;
    const { data } = await client.auth.getSession();
    const token = data.session?.access_token;
    if (!token) { toast({ title: 'Sign in again to test downloads', tone: 'error' }); return; }
    try {
      const response = await fetch('/api/admin/test-download/' + product.id + '/' + file.id, {
        headers: { Authorization: 'Bearer ' + token },
      });
      const body = await response.json();
      if (!response.ok || !body.url) throw new Error(body.error || 'A signed test download could not be created.');
      window.location.assign(body.url);
    } catch (error) {
      toast({ title: 'Test download failed', description: error instanceof Error ? error.message : 'Try again.', tone: 'error' });
    }
  };

  return (
    <div className="space-y-5">
      <section className="rounded-[24px] border border-line bg-page p-4 sm:p-5 space-y-3">
        <h3 className="font-semibold text-ink">Upload deliverable</h3>
        <p className="text-sm text-ink-2">Resumable transfer with SHA-256 integrity metadata. The storage object stays private.</p>
        <input type="file" onChange={chooseFile} className="block w-full text-sm text-ink-2 file:mr-3 file:rounded-full file:border file:border-line file:bg-surface file:px-4 file:py-2.5 file:text-sm file:font-medium" />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3"><Input label="Version" value={version} onChange={(event) => setVersion(event.target.value)} /><Checkbox label="Replace active versions after upload" checked={isReplacing} onChange={(event) => setIsReplacing(event.target.checked)} /></div>
        {selectedFile ? <div className="rounded-[14px] bg-surface border border-line p-3"><p className="font-medium text-sm break-all">{selectedFile.name}</p><p className="text-xs text-ink-3 mt-1">{(selectedFile.size / 1024 / 1024).toFixed(2)} MB · {selectedFile.type || 'Unknown MIME'}</p></div> : null}
        {uploadState !== 'idle' ? <div><div className="flex justify-between text-xs text-ink-2"><span>{uploadState === 'uploading' ? 'Uploading' : uploadState === 'paused' ? 'Paused' : 'Upload error'}</span><span>{progress}%</span></div><div className="h-2 rounded-full bg-stone mt-2 overflow-hidden"><div className="h-full bg-ink transition-[width]" style={{ width: progress + '%' }} /></div></div> : null}
        {uploadError ? <p role="alert" className="text-sm text-error">{uploadError}</p> : null}
        <div className="flex flex-wrap gap-2"><Button disabled={!selectedFile || uploadState === 'uploading'} onClick={() => void startUpload()} loading={uploadState === 'uploading'}>{uploadState === 'error' ? 'Retry upload' : uploadState === 'paused' ? 'Resume upload' : 'Upload file'}</Button>{uploadState === 'uploading' ? <Button variant="secondary" onClick={() => void pauseUpload()}>Pause</Button> : null}</div>
      </section>
      <section className="space-y-3"><div className="flex items-center justify-between gap-3"><h3 className="font-semibold text-ink">File versions</h3>{loading ? <span className="text-xs text-ink-3">Loading…</span> : <span className="text-xs text-ink-3">{files.length} total</span>}</div>
        {files.length === 0 && !loading ? <Tile variant="soft" padding="md"><p className="text-sm text-ink-2">No deliverables attached. At least one active file is required before publishing.</p></Tile> : null}
        {files.map((file) => <article key={file.id} className="rounded-[18px] border border-line bg-surface p-3 sm:p-4 flex flex-col sm:flex-row sm:items-center gap-3"><div className="min-w-0 flex-1"><div className="flex flex-wrap gap-2 items-center"><p className="font-medium text-sm break-all">{file.file_name}</p><span className={'text-[11px] rounded-full px-2 py-1 ' + (file.is_active ? 'bg-[#E6F2EB] text-[#1E7A4F]' : 'bg-stone text-ink-2')}>{file.is_active ? 'Active' : 'Inactive'}</span></div><p className="text-xs text-ink-3 mt-1">v{file.version || '1.0'} · {file.size_bytes ? (file.size_bytes / 1024 / 1024).toFixed(2) + ' MB' : 'Size unknown'}</p><p className="text-[11px] font-mono text-ink-3 mt-1 break-all">SHA-256 {file.checksum_sha256 || 'not recorded'}</p></div><div className="flex flex-wrap gap-2"><Button size="sm" variant="secondary" onClick={() => void testDownload(file)}>Test download</Button><Button size="sm" variant="secondary" onClick={() => void toggleActive(file)}>{file.is_active ? 'Deactivate' : 'Activate'}</Button></div></article>)}
      </section>
    </div>
  );
}

const zFileSchema = z.object({ name: z.string().trim().min(1).max(255), size: z.number().int().positive(), type: z.string().max(255) });

export function AdminProductsPage() {
  const client = getSupabaseBrowserClient();
  const { toast } = useToast();
  const [products, setProducts] = useState<Product[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [files, setFiles] = useState<ProductFile[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState<Product | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);

  const load = useCallback(async () => {
    if (!client) { setLoading(false); return; }
    setLoading(true);
    const [productsResult, collectionsResult, filesResult] = await Promise.all([
      client.from('products').select('*').order('updated_at', { ascending: false }),
      client.from('collections').select('*').order('sort_order', { ascending: true }),
      client.from('product_files').select('id,product_id,is_active'),
    ]);
    const error = productsResult.error || collectionsResult.error || filesResult.error;
    if (error) toast({ title: 'Catalogue could not be loaded', description: error.message, tone: 'error' });
    setProducts((productsResult.data || []) as Product[]);
    setCollections((collectionsResult.data || []) as Collection[]);
    setFiles((filesResult.data || []) as ProductFile[]);
    setLoading(false);
  }, [client, toast]);

  useEffect(() => { void load(); }, [load]);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return products.filter((product) => !term || [product.name, product.slug, product.sku, ...(product.tags || [])].join(' ').toLowerCase().includes(term));
  }, [products, search]);

  const saveProduct = (saved: Product) => {
    setProducts((previous) => {
      const index = previous.findIndex((item) => item.id === saved.id);
      if (index < 0) return [saved, ...previous];
      const next = [...previous];
      next[index] = saved;
      return next;
    });
  };

  const quickUpdate = async (product: Product, patch: Partial<Product>) => {
    if (!client) return;
    const before = products;
    setProducts((previous) => previous.map((item) => item.id === product.id ? { ...item, ...patch } : item));
    const { error } = await client.from('products').update(patch).eq('id', product.id);
    if (error) {
      setProducts(before);
      const friendly = /Attach at least one active file before publishing/i.test(error.message) ? 'Attach at least one active file before publishing.' : error.message;
      toast({ title: 'Product was not updated', description: friendly, tone: 'error' });
    } else toast({ title: 'Product updated', tone: 'success' });
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3"><div className="flex-1 relative"><Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-ink-3" /><input className={fieldClass + ' pl-11'} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by name, SKU or slug" /></div><Button onClick={() => { setActive(null); setEditorOpen(true); }} icon={<Plus size={18} />}>New product</Button></div>
      <div className="flex flex-wrap gap-2 text-xs text-ink-2"><span className="rounded-full bg-surface border border-line px-3 py-2">{products.length} products</span><span className="rounded-full bg-surface border border-line px-3 py-2">{products.filter((item) => item.status === 'published').length} published</span><span className="rounded-full bg-surface border border-line px-3 py-2">{products.filter((item) => item.status === 'draft').length} drafts</span></div>
      {loading ? <div className="grid grid-cols-1 md:grid-cols-2 gap-3"><Skeleton className="h-40" rounded="lg" /><Skeleton className="h-40" rounded="lg" /></div> : null}
      {!loading && visible.length === 0 ? <Tile variant="white" padding="lg"><p className="text-sm text-ink-2">{products.length ? 'No products match that search.' : 'No products yet. Create the first catalogue item.'}</p></Tile> : null}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 md:hidden">{visible.map((product) => <AdminProductCard key={product.id} product={product} files={files} onEdit={() => { setActive(product); setEditorOpen(true); }} onFeature={() => void quickUpdate(product, { is_featured: !product.is_featured })} onStatus={(status) => void quickUpdate(product, { status })} />)}</div>
      <div className="hidden md:block overflow-x-auto rounded-[24px] border border-line bg-surface"><table className="w-full text-left text-sm"><thead className="bg-page text-xs uppercase tracking-[0.08em] text-ink-3"><tr><th className="p-4">Product</th><th className="p-4">Price</th><th className="p-4">Status</th><th className="p-4">Files</th><th className="p-4">Featured</th><th className="p-4"></th></tr></thead><tbody>{visible.map((product) => <tr key={product.id} className="border-t border-line"><td className="p-3"><div className="flex items-center gap-3"><div className="w-12 h-14 rounded-[10px] overflow-hidden bg-stone shrink-0">{imageUrl(product.cover_path) ? <img src={imageUrl(product.cover_path) || ''} alt="" className="w-full h-full object-cover" /> : null}</div><div className="min-w-0"><p className="font-semibold text-ink">{product.name}</p><p className="text-xs text-ink-3 font-mono">{product.sku} · /{product.slug}</p></div></div></td><td className="p-4 font-mono">{formatUsd(product.price_cents)}</td><td className="p-4"><select aria-label={'Status for ' + product.name} value={product.status} onChange={(event) => void quickUpdate(product, { status: event.target.value as Product['status'] })} className="rounded-full border border-line px-3 py-2 bg-surface capitalize"><option value="draft">Draft</option><option value="review">Review</option><option value="published">Published</option><option value="archived">Archived</option></select></td><td className="p-4">{files.filter((file) => file.product_id === product.id && file.is_active).length} active</td><td className="p-4"><input type="checkbox" aria-label={'Feature ' + product.name} checked={product.is_featured} onChange={() => void quickUpdate(product, { is_featured: !product.is_featured })} className="w-4 h-4 accent-[#111111]" /></td><td className="p-4"><button type="button" onClick={() => { setActive(product); setEditorOpen(true); }} className="underline underline-offset-4 font-medium">Edit</button></td></tr>)}</tbody></table></div>
      {editorOpen ? <ProductEditor key={active?.id || 'new'} initialProduct={active} collections={collections} onClose={() => setEditorOpen(false)} onSaved={saveProduct} /> : null}
    </div>
  );
}

export function AdminImagesPage() {
  const client = getSupabaseBrowserClient();
  const { toast } = useToast();
  const { user } = useAuth();
  const [products, setProducts] = useState<Product[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [loading, setLoading] = useState(true);
  const [autoSet, setAutoSet] = useState(false);
  const [bulkRunning, setBulkRunning] = useState(false);
  const [bulkProgress, setBulkProgress] = useState({ done: 0, total: 0, failed: 0, current: '' });
  const cancelRef = useRef(false);

  useEffect(() => {
    if (!client) return;
    let active = true;
    Promise.all([
      client.from('products').select('*').order('name'),
      client.from('collections').select('*'),
      client.from('site_settings').select('value').eq('key', 'admin_auto_set_generated_covers').maybeSingle(),
    ]).then(([p, c, s]) => {
      if (!active) return;
      if (p.error || c.error) toast({ title: 'Image catalogue could not be loaded', description: (p.error || c.error)?.message, tone: 'error' });
      const productRows = (p.data || []) as Product[];
      setProducts(productRows);
      setCollections((c.data || []) as Collection[]);
      setSelectedId(productRows[0]?.id || '');
      const value = s.data?.value as { enabled?: boolean } | boolean | null;
      setAutoSet(typeof value === 'boolean' ? value : Boolean(value?.enabled));
      setLoading(false);
    });
    return () => { active = false; };
  }, [client, toast]);

  const selectedProduct = products.find((item) => item.id === selectedId) || null;
  const saveAutoSet = async (enabled: boolean) => {
    if (!client) return;
    const before = autoSet;
    setAutoSet(enabled);
    const { error } = await client.from('site_settings').upsert({ key: 'admin_auto_set_generated_covers', value: { enabled }, is_public: false });
    if (error) { setAutoSet(before); toast({ title: 'Preference was not saved', description: error.message, tone: 'error' }); }
  };

  const runBulk = async () => {
    if (!client || !user) return;
    const missing = products.filter((item) => !item.cover_path);
    if (!missing.length) { toast({ title: 'Every product already has a cover', tone: 'success' }); return; }
    const { data: session } = await client.auth.getSession();
    if (!session.session?.access_token) { toast({ title: 'Sign in again before generating', tone: 'error' }); return; }
    cancelRef.current = false;
    setBulkRunning(true);
    setBulkProgress({ done: 0, total: missing.length, failed: 0, current: '' });
    let failed = 0;
    for (let index = 0; index < missing.length; index += 1) {
      if (cancelRef.current) break;
      const item = missing[index];
      setBulkProgress({ done: index, total: missing.length, failed, current: item.name });
      try {
        const collection = collections.find((entry) => entry.id === item.collection_id) || null;
        const result = await generateAdminImage(session.session.access_token, item.id, buildCoverPrompt(item, collection));
        const savedMedia = await storeProductImage(client, item, base64ToBlob(result.imageBase64, result.mimeType), item.name + ' product cover', 'gemini', autoSet);
        if (autoSet) setProducts((previous) => previous.map((row) => row.id === item.id ? { ...row, cover_path: savedMedia.storage_path } : row));
      } catch (error) {
        failed += 1;
        toast({ title: 'Could not generate ' + item.name, description: error instanceof Error ? error.message : 'The next product will continue.', tone: 'error' });
      }
      setBulkProgress({ done: index + 1, total: missing.length, failed, current: '' });
    }
    setBulkRunning(false);
    toast({ title: cancelRef.current ? 'Bulk generation cancelled' : 'Bulk generation complete', description: failed + ' failed. ' + (autoSet ? 'Generated covers were applied.' : 'Generated images are gallery candidates for review.'), tone: failed ? 'default' : 'success' });
  };

  return (
    <div className="space-y-5">
      <Tile variant="white" padding="md" radius="lg" className="space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3"><div><h3 className="font-semibold text-ink">Generate missing covers</h3><p className="text-sm text-ink-2 mt-1">One product at a time. Failed products do not stop the queue.</p></div><TagPill>{products.filter((item) => !item.cover_path).length} missing</TagPill></div>
        <Checkbox label="Auto-set generated covers" description="Off by default: generated results are stored in the gallery for review." checked={autoSet} onChange={(event) => void saveAutoSet(event.target.checked)} />
        {bulkRunning ? <div className="space-y-2"><p className="text-sm text-ink-2">Working on: {bulkProgress.current || 'Saving image'} · {bulkProgress.done}/{bulkProgress.total} · {bulkProgress.failed} failed</p><div className="h-2 rounded-full bg-stone overflow-hidden"><div className="h-full bg-ink" style={{ width: (bulkProgress.total ? (bulkProgress.done / bulkProgress.total) * 100 : 0) + '%' }} /></div><Button variant="secondary" size="sm" onClick={() => { cancelRef.current = true; }}>Cancel queue</Button></div> : <Button onClick={() => void runBulk()} disabled={loading || products.length === 0} icon={<Sparkles size={18} />}>Generate missing covers</Button>}
      </Tile>
      <div className="flex flex-col sm:flex-row gap-3 sm:items-end"><label className="flex-1 space-y-1.5"><FieldLabel>Choose product</FieldLabel><select className={fieldClass} value={selectedId} onChange={(event) => setSelectedId(event.target.value)}><option value="">Select a product</option>{products.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><Button variant="secondary" to="/admin/products">Open product editor</Button></div>
      {loading ? <Skeleton className="h-64 w-full" rounded="lg" /> : selectedProduct ? <ImageStudio product={selectedProduct} collection={collections.find((item) => item.id === selectedProduct.collection_id) || null} onProductUpdate={(updated) => setProducts((previous) => previous.map((item) => item.id === updated.id ? updated : item))} /> : <Tile variant="soft" padding="lg"><p className="text-sm text-ink-2">No products are available yet.</p></Tile>}
    </div>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type TouchEvent } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import {
  AppWindow, ArrowRight, Check, ChevronLeft, ChevronRight, Code2, File,
  FileSpreadsheet, FileText, Folder, X, ZoomIn,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { accentToBgClass, formatPrice } from '../../lib/data/format';
import type { Collection, Product, ProductMedia } from '../../lib/data/types';
import { collectLightboxImages } from '../../lib/product/productHelpers';
import { getProductMediaSrcSet } from '../../lib/media/imagePipeline';
import { ProductCover, TagPill } from '../primitives';

export type ProductPreviewTab = 'gallery' | 'archive' | 'first-hour';

interface ProductPreviewModalProps {
  open: boolean;
  product: Product;
  collection: Collection | null;
  media: ProductMedia[];
  owned: boolean;
  inCart: boolean;
  justAdded: boolean;
  isPreviewData: boolean;
  initialTab?: ProductPreviewTab;
  initialIndex?: number;
  onClose: () => void;
  onAddToCart: (event: MouseEvent<HTMLButtonElement>) => void;
  onBuyNow: () => void;
  onGoToCheckout: () => void;
}

const FOCUSABLE = 'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const TABS: Array<{ id: ProductPreviewTab; label: string }> = [
  { id: 'gallery', label: 'Gallery' },
  { id: 'archive', label: 'Inside the Archive' },
  { id: 'first-hour', label: 'First Hour' },
];

function fileIcon(name: string) {
  const value = name.toLowerCase();
  if (/\.(html?|app)$/i.test(value) || value.includes('html app')) return AppWindow;
  if (/\.(xlsx?|csv)$/i.test(value) || /(spreadsheet|excel|workbook)/i.test(value)) return FileSpreadsheet;
  if (/\.(tsx?|jsx?|css|json|js)$/i.test(value) || /(code|component|stylesheet)/i.test(value)) return Code2;
  if (/\.(pdf|md|txt)$/i.test(value) || /(guide|documentation)/i.test(value)) return FileText;
  return File;
}

export function ProductPreviewModal(props: ProductPreviewModalProps) {
  const {
    open, product, collection, media, owned, inCart, justAdded, isPreviewData,
    initialTab = 'gallery', initialIndex = 0, onClose, onAddToCart, onBuyNow, onGoToCheckout,
  } = props;
  const [activeTab, setActiveTab] = useState<ProductPreviewTab>('gallery');
  const [activeIndex, setActiveIndex] = useState(0);
  const [zoomed, setZoomed] = useState(false);
  const [selectedEntry, setSelectedEntry] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const images = useMemo(() => collectLightboxImages(product, media), [product, media]);
  const safeIndex = images.length ? Math.min(activeIndex, images.length - 1) : 0;
  const current = images[safeIndex];
  const imageSet = current ? getProductMediaSrcSet(current.storagePath) : null;
  const tint = accentToBgClass(collection?.accent ?? 'cocoa');
  const formats = product.file_formats.length ? product.file_formats : ['Digital download'];
  const entries = product.includes.length ? product.includes : formats.map((fmt) => fmt + ' files');

  const moveImage = useCallback((direction: number) => {
    if (images.length < 2) return;
    setActiveIndex((index) => (index + direction + images.length) % images.length);
    setZoomed(false);
  }, [images.length]);

  useEffect(() => {
    if (!open) return;
    setActiveTab(initialTab);
    setActiveIndex(initialIndex);
    setZoomed(false);
    setSelectedEntry(null);
    previousFocus.current = document.activeElement as HTMLElement | null;
    const oldOverflow = document.body.style.overflow;
    const oldPadding = document.body.style.paddingRight;
    const scrollbar = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = 'hidden';
    if (scrollbar > 0) document.body.style.paddingRight = scrollbar + 'px';
    const raf = window.requestAnimationFrame(() => closeRef.current?.focus());
    return () => {
      window.cancelAnimationFrame(raf);
      document.body.style.overflow = oldOverflow;
      document.body.style.paddingRight = oldPadding;
      previousFocus.current?.focus();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      } else if (activeTab === 'gallery' && event.key === 'ArrowLeft') {
        event.preventDefault();
        moveImage(-1);
      } else if (activeTab === 'gallery' && event.key === 'ArrowRight') {
        event.preventDefault();
        moveImage(1);
      } else if (event.key === 'Tab' && dialogRef.current) {
        const nodes = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE))
          .filter((node) => node.offsetParent !== null);
        if (!nodes.length) return;
        const first = nodes[0];
        const last = nodes[nodes.length - 1];
        if (event.shiftKey && (document.activeElement === first || !dialogRef.current.contains(document.activeElement))) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && (document.activeElement === last || !dialogRef.current.contains(document.activeElement))) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, activeTab, onClose, moveImage]);

  const onTouchStart = (event: TouchEvent<HTMLDivElement>) => {
    const touch = event.touches[0];
    if (touch) touchStart.current = { x: touch.clientX, y: touch.clientY };
  };
  const onTouchEnd = (event: TouchEvent<HTMLDivElement>) => {
    const start = touchStart.current;
    const touch = event.changedTouches[0];
    touchStart.current = null;
    if (!start || !touch) return;
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy)) moveImage(dx < 0 ? 1 : -1);
  };

  if (typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[100] flex items-end justify-center md:items-center md:p-5" data-product-preview-modal>
          <motion.div role="presentation" onClick={onClose}
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="absolute inset-0 cursor-default bg-ink/45 backdrop-blur-[3px]" />
          <motion.div ref={dialogRef} role="dialog" aria-modal="true"
            aria-label={product.name + ' product preview'} tabIndex={-1}
            initial={{ opacity: 0, y: 28, scale: 0.985 }} animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 22, scale: 0.985 }}
            transition={{ type: 'spring', stiffness: 380, damping: 36 }}
            className="relative z-10 flex h-[100dvh] max-h-[100dvh] w-full flex-col overflow-hidden rounded-t-[28px] border border-line bg-surface shadow-[var(--shadow-float)] md:h-auto md:max-h-[min(900px,calc(100dvh-40px))] md:max-w-5xl md:rounded-[32px]">
            <motion.div drag="y" dragConstraints={{ top: 0, bottom: 0 }} dragElastic={0.35}
              onDragEnd={(_, info) => { if (info.offset.y > 72) onClose(); }}
              className="flex justify-center pt-2.5 md:hidden cursor-grab active:cursor-grabbing">
              <span className="h-1 w-10 rounded-full bg-ink/20" />
            </motion.div>
            <header className="flex shrink-0 items-start justify-between gap-3 border-b border-line px-4 pb-3 pt-3 sm:px-6 sm:pb-4 sm:pt-5">
              <div className="min-w-0 flex-1">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  {collection && <TagPill>{collection.name}</TagPill>}
                  <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink-2">{product.sku}</span>
                </div>
                <h2 className="truncate text-base font-semibold tracking-tight text-ink sm:text-xl">{product.name}</h2>
                <div className="mt-3 inline-flex max-w-full gap-1 overflow-x-auto rounded-full border border-line bg-page p-1"
                  role="tablist" aria-label="Product preview sections">
                  {TABS.map((tab) => (
                    <button key={tab.id} type="button" role="tab" aria-selected={activeTab === tab.id}
                      onClick={() => setActiveTab(tab.id)}
                      className={'relative isolate whitespace-nowrap rounded-full px-3 py-2 text-[11px] font-medium transition-colors sm:px-4 sm:text-xs ' + (activeTab === tab.id ? 'text-ink' : 'text-ink-2 hover:text-ink')}>
                      {activeTab === tab.id && <motion.span layoutId="preview-modal-tab"
                        className="absolute inset-0 -z-10 rounded-full border border-line bg-surface shadow-sm"
                        transition={{ type: 'spring', stiffness: 380, damping: 36 }} />}
                      {tab.label}
                    </button>
                  ))}
                </div>
              </div>
              <button ref={closeRef} type="button" onClick={onClose} aria-label="Close preview"
                className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-line bg-page text-ink transition-colors hover:bg-stone focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-2">
                <X size={19} strokeWidth={1.8} />
              </button>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
              <AnimatePresence mode="wait" initial={false}>
                {activeTab === 'gallery' && (
                  <motion.section key="gallery" role="tabpanel" aria-label="Visual gallery"
                    initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
                    transition={{ duration: 0.18 }} className="flex min-h-[340px] flex-col gap-4 p-4 sm:p-6"
                    onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
                    <div className={'relative flex min-h-[280px] flex-1 items-center justify-center overflow-hidden rounded-[24px] p-4 sm:min-h-[390px] sm:p-8 ' + tint}>
                      {current && imageSet ? (
                        <motion.img key={current.id} src={imageSet.urls[1600]} alt={current.alt} draggable={false}
                          animate={{ scale: zoomed ? 1.5 : 1 }}
                          transition={{ type: 'spring', stiffness: 380, damping: 36 }}
                          className="max-h-[48dvh] w-auto max-w-full rounded-[16px] object-contain shadow-[0_16px_42px_rgba(17,17,17,0.12)] sm:max-h-[56dvh]" />
                      ) : (
                        <div className="w-full max-w-[340px]">
                          <ProductCover product={product} collection={collection} ratio="4/5" size="lg" priority
                            className="rounded-[20px] shadow-[0_16px_42px_rgba(17,17,17,0.12)]" />
                        </div>
                      )}
                      {images.length > 1 && (
                        <>
                          <button type="button" onClick={() => moveImage(-1)} aria-label="Previous preview image"
                            className="absolute left-3 top-1/2 inline-flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-line bg-white/90 text-ink shadow-sm hover:bg-white">
                            <ChevronLeft size={19} />
                          </button>
                          <button type="button" onClick={() => moveImage(1)} aria-label="Next preview image"
                            className="absolute right-3 top-1/2 inline-flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-line bg-white/90 text-ink shadow-sm hover:bg-white">
                            <ChevronRight size={19} />
                          </button>
                        </>
                      )}
                      <div className="absolute bottom-3 right-3 flex items-center gap-1 rounded-full border border-line bg-white/90 p-1 shadow-sm">
                        <button type="button" onClick={() => setZoomed(false)} aria-label="View at 1x" aria-pressed={!zoomed}
                          className={'rounded-full px-3 py-1.5 text-[11px] font-medium ' + (!zoomed ? 'bg-ink text-white' : 'text-ink-2')}>1x</button>
                        <button type="button" onClick={() => setZoomed(true)} aria-label="Zoom to 1.5x" aria-pressed={zoomed}
                          className={'rounded-full px-3 py-1.5 text-[11px] font-medium ' + (zoomed ? 'bg-ink text-white' : 'text-ink-2')}>1.5x</button>
                      </div>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs text-ink-2">{images.length ? (safeIndex + 1) + ' of ' + images.length + ' visuals' : 'Studio cover preview'}</p>
                      <span className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.08em] text-ink-2"><ZoomIn size={14} /> Detail view</span>
                    </div>
                    {images.length > 1 && (
                      <div className="flex gap-2 overflow-x-auto pb-1" aria-label="Preview thumbnails">
                        {images.map((image, index) => (
                          <button key={image.id} type="button"
                            onClick={() => { setActiveIndex(index); setZoomed(false); }}
                            aria-label={'Show preview ' + (index + 1) + ': ' + image.alt}
                            aria-pressed={safeIndex === index}
                            className={'h-[66px] w-[54px] shrink-0 overflow-hidden rounded-[11px] border-2 bg-page transition-colors ' + (safeIndex === index ? 'border-ink' : 'border-line opacity-70 hover:opacity-100')}>
                            <img src={getProductMediaSrcSet(image.storagePath)?.urls[480]} alt="" className="h-full w-full object-cover" />
                          </button>
                        ))}
                      </div>
                    )}
                  </motion.section>
                )}

                {activeTab === 'archive' && (
                  <motion.section key="archive" role="tabpanel" aria-label="Inside the archive"
                    initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
                    transition={{ duration: 0.18 }} className="p-4 sm:p-7">
                    <div className="rounded-[22px] border border-line bg-page p-4 sm:p-6">
                      <div className="mb-4 flex items-center justify-between gap-3 border-b border-line pb-4">
                        <div className="flex items-center gap-2"><Folder size={18} className="text-ink-2" />
                          <span className="font-mono text-xs font-semibold text-ink">{product.slug || product.sku.toLowerCase()}/</span></div>
                        {product.version && <span className="rounded-full border border-line bg-surface px-3 py-1 font-mono text-[10px] text-ink-2">v{product.version}</span>}
                      </div>
                      <ul className="flex flex-col gap-2">
                        {entries.map((entry, index) => {
                          const Icon = fileIcon(entry);
                          return <li key={entry + '-' + index}>
                            <button type="button" onClick={() => setSelectedEntry(entry)} aria-pressed={selectedEntry === entry}
                              className={'flex w-full items-center gap-3 rounded-[15px] border px-3 py-3 text-left transition-colors sm:px-4 ' + (selectedEntry === entry ? 'border-ink bg-stone' : 'border-line/80 bg-surface hover:border-ink/40')}>
                              <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px] bg-stone text-ink-2"><Icon size={17} strokeWidth={1.7} /></span>
                              <span className="min-w-0 flex-1 text-sm text-ink">{entry}</span>
                              <span className="font-mono text-[10px] uppercase tracking-[0.07em] text-ink-2">Included</span>
                            </button>
                          </li>;
                        })}
                      </ul>
                      {selectedEntry && <p className="mt-3 rounded-[13px] border border-line bg-surface px-4 py-3 text-xs leading-relaxed text-ink-2">
                        <span className="font-medium text-ink">{selectedEntry}</span> is included in this product archive.
                      </p>}
                    </div>
                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      {formats.map((format) => <span key={format} className="rounded-full border border-line bg-surface px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.07em] text-ink">{format}</span>)}
                    </div>
                    {product.requirements && <p className="mt-4 rounded-[16px] border border-line bg-surface p-4 text-sm leading-relaxed text-ink-2">
                      <span className="font-medium text-ink">Compatibility: </span>{product.requirements}
                    </p>}
                  </motion.section>
                )}

                {activeTab === 'first-hour' && (
                  <motion.section key="first-hour" role="tabpanel" aria-label="Your first hour"
                    initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
                    transition={{ duration: 0.18 }} className="p-4 sm:p-7">
                    <div className="rounded-[22px] border border-line bg-page p-4 sm:p-6">
                      <p className="mb-4 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-2">A practical first session</p>
                      {product.first_hour.length ? (
                        <ol className="flex flex-col gap-3">
                          {product.first_hour.map((step, index) => <li key={step + '-' + index} className="flex items-start gap-3">
                            <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ink font-mono text-xs font-semibold text-white">{String(index + 1).padStart(2, '0')}</span>
                            <p className="pt-1 text-sm leading-relaxed text-ink">{step}</p>
                          </li>)}
                        </ol>
                      ) : <p className="text-sm leading-relaxed text-ink-2">Open the included files, review the available formats, and choose the first workflow you want to put into practice.</p>}
                    </div>
                    {product.audience.length > 0 && <div className="mt-5">
                      <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.1em] text-ink-2">Made for</p>
                      <div className="flex flex-wrap gap-2">
                        {product.audience.map((audience) => <span key={audience} className="rounded-full border border-line bg-surface px-3 py-2 text-xs text-ink">{audience}</span>)}
                      </div>
                    </div>}
                  </motion.section>
                )}
              </AnimatePresence>
            </div>

            <footer className="flex shrink-0 flex-col gap-3 border-t border-line bg-surface px-4 py-3 pb-[calc(12px+env(safe-area-inset-bottom,0px))] sm:flex-row sm:items-center sm:justify-between sm:px-6 sm:py-4">
              <div className="min-w-0">
                <p className="font-mono text-lg font-semibold tabular-nums text-ink">{formatPrice(product.price_cents)} <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-ink-2">USD</span></p>
                <p className="text-[11px] text-ink-2">1 licence · yours for life</p>
              </div>
              {owned ? (
                <Link to="/account?tab=library" onClick={onClose} className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-full bg-ink px-5 text-sm font-medium text-white hover:bg-ink-soft">
                  <Check size={16} /> In your library <ArrowRight size={15} />
                </Link>
              ) : <div className="flex w-full gap-2 sm:w-auto">
                {inCart
                  ? <button type="button" onClick={onGoToCheckout} className="min-h-[44px] flex-1 rounded-full border border-line-strong bg-surface px-5 text-sm font-medium text-ink hover:border-ink sm:flex-none">Go to checkout</button>
                  : <button type="button" onClick={onAddToCart} className="min-h-[44px] flex-1 rounded-full border border-line-strong bg-surface px-5 text-sm font-medium text-ink hover:border-ink sm:min-w-[150px] sm:flex-none">
                      {justAdded ? <span className="inline-flex items-center gap-2"><Check size={16} className="text-success" />Added</span> : 'Add to cart'}
                    </button>}
                <button type="button" onClick={onBuyNow} disabled={isPreviewData} className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-full bg-ink px-5 text-sm font-medium text-white hover:bg-ink-soft sm:min-w-[142px] sm:flex-none">
                  Buy now <ArrowRight size={15} />
                </button>
              </div>}
            </footer>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body
  );
}

import { useEffect, useState, type MouseEvent } from 'react';
import { useParams } from 'react-router-dom';
import { Check, Download, FolderCheck, Heart, Infinity as InfinityIcon, ShieldCheck } from 'lucide-react';
import { ProductCard } from '../components/layout/ProductCard';
import {
  Breadcrumb,
  Button,
  IconButton,
  PriceTag,
  ProductCover,
  RatingStars,
  Skeleton,
  TagPill,
  Tile,
  useToast,
} from '../components/primitives';
import { useCart } from '../lib/cart/CartProvider';
import { getProductDescription } from '../lib/data/format';
import { getProductBySlug } from '../lib/data/repository';
import type { ProductDetail } from '../lib/data/types';
import { getProductOgImageUrl } from '../lib/media/imagePipeline';
import { usePageMeta } from '../lib/seo/usePageMeta';

export function ProductDetailPage() {
  const { slug = '' } = useParams();
  const [detail, setDetail] = useState<ProductDetail | null>(null);
  const [isPreviewData, setIsPreviewData] = useState(false);
  const [loading, setLoading] = useState(true);

  const { addToCart, removeFromCart, isInCart, isOwnedProduct, isSaved, toggleSaved, setCartOpen } =
    useCart();
  const { toast } = useToast();

  usePageMeta({
    title: detail?.product.seo_title || (detail ? `${detail.product.name} — Kinvai` : 'Product — Kinvai'),
    description:
      detail?.product.seo_description ||
      detail?.product.short_description ||
      'Downloadable digital system from Kinvai.',
    ogImage: getProductOgImageUrl(detail?.product.cover_path),
  });

  useEffect(() => {
    let active = true;
    setLoading(true);
    getProductBySlug(slug).then((res) => {
      if (!active) return;
      setDetail(res.data);
      setIsPreviewData(res.isPreviewData);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [slug]);

  if (loading) {
    return (
      <div className="kv-container py-10 grid grid-cols-1 lg:grid-cols-12 gap-6">
        <Skeleton className="lg:col-span-7 h-[420px]" rounded="lg" />
        <Skeleton className="lg:col-span-5 h-[420px]" rounded="lg" />
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="kv-container py-16 text-center flex flex-col items-center gap-4">
        <h1 className="type-h2 font-semibold text-ink">Product not found.</h1>
        <Button variant="primary" to="/shop">
          Explore the shop
        </Button>
      </div>
    );
  }

  const { product, collection, related, ratingStats } = detail;
  const saved = isSaved(product.id);
  const inCart = isInCart(product.id);
  const owned = isOwnedProduct(product.id);
  const fullDescription = getProductDescription(product);

  const handleAdd = (e: MouseEvent<HTMLButtonElement>) => {
    if (isPreviewData || owned) return;
    if (inCart) {
      setCartOpen(true);
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    addToCart(product, false, {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    });
    toast({
      title: `Added ${product.name}`,
      description: '1 licence. Yours for life.',
      tone: 'success',
      undoLabel: 'Undo',
      onUndo: () => removeFromCart(product.id),
    });
  };

  return (
    <div className="kv-container py-8 md:py-12 flex flex-col gap-12">
      <Breadcrumb
        items={[
          { label: 'Home', to: '/' },
          { label: 'Shop', to: '/shop' },
          ...(collection
            ? [{ label: collection.name, to: `/collections/${collection.slug}` }]
            : []),
          { label: product.name },
        ]}
      />

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-7 flex flex-col gap-4">
          <ProductCover
            product={product}
            collection={collection}
            ratio="4/5"
            size="lg"
            priority
            sizes="(max-width: 1024px) 100vw, 58vw"
            className="rounded-[28px] max-w-[560px] mx-auto lg:mx-0"
          />

          {product.includes.length > 0 && (
            <Tile variant="white" radius="lg" padding="md">
              <span className="type-label text-ink-2">What is inside</span>
              <ul className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                {product.includes.map((item) => (
                  <li key={item} className="flex items-start gap-2.5 text-sm text-ink">
                    <span className="w-5 h-5 rounded-full bg-stone inline-flex items-center justify-center shrink-0 mt-0.5">
                      <Check size={13} strokeWidth={2.25} aria-hidden="true" />
                    </span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </Tile>
          )}
        </div>

        {/* Purchase Module */}
        <div className="lg:col-span-5 flex flex-col gap-4 lg:sticky lg:top-24">
          <Tile variant="white" radius="xl" padding="lg" className="flex flex-col gap-5">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <TagPill>{product.sku}</TagPill>
                {isPreviewData && <TagPill tone="warning">Preview data</TagPill>}
              </div>
              <IconButton
                label={saved ? `Remove ${product.name} from saved` : `Save ${product.name}`}
                icon={
                  <Heart
                    size={18}
                    strokeWidth={1.75}
                    className={saved ? 'fill-brand text-brand' : ''}
                  />
                }
                onClick={() => toggleSaved(product.id)}
              />
            </div>

            <div>
              <h1 className="type-h2 font-semibold text-ink">{product.name}</h1>
              {product.tagline && (
                <p className="type-body text-ink-2 mt-2">{product.tagline}</p>
              )}
              <div className="mt-3">
                <RatingStars rating={ratingStats?.avg_rating} count={ratingStats?.review_count} pill />
              </div>
            </div>

            {fullDescription && (
              <p className="text-[15px] text-ink-2 leading-relaxed prose-measure">
                {fullDescription}
              </p>
            )}

            {/* Wink-inspired dark price bar */}
            <div className="rounded-[22px] bg-ink text-ink-on-dark p-4 flex items-center justify-between gap-4">
              <div>
                <span className="block text-xs text-ink-on-dark-muted">
                  1 licence · lifetime access
                </span>
                <PriceTag cents={product.price_cents} size="lg" inverted />
              </div>
              {owned ? (
                <Button
                  variant="primary"
                  inverted
                  to="/account?tab=library"
                  icon={<FolderCheck size={17} strokeWidth={1.75} aria-hidden="true" />}
                >
                  In your library
                </Button>
              ) : (
                <Button
                  variant="primary"
                  inverted
                  disabled={isPreviewData}
                  onClick={handleAdd}
                >
                  {isPreviewData ? 'Preview only' : inCart ? 'In cart' : 'Add to cart'}
                </Button>
              )}
            </div>

            {isPreviewData && (
              <p className="text-xs text-ink-2">
                Showing preview catalogue data. Checkout opens once live products are published in
                Supabase.
              </p>
            )}

            <div className="pt-4 border-t border-line grid grid-cols-3 gap-2 text-xs text-ink-2">
              <div className="flex items-center gap-1.5">
                <Download size={15} strokeWidth={1.75} className="text-ink shrink-0" aria-hidden="true" />
                <span>Instant download</span>
              </div>
              <div className="flex items-center gap-1.5">
                <InfinityIcon size={15} strokeWidth={1.75} className="text-ink shrink-0" aria-hidden="true" />
                <span>Yours for life</span>
              </div>
              <div className="flex items-center gap-1.5">
                <ShieldCheck size={15} strokeWidth={1.75} className="text-ink shrink-0" aria-hidden="true" />
                <span>Secure checkout</span>
              </div>
            </div>
          </Tile>

          {product.first_hour.length > 0 && (
            <Tile variant="stone" radius="lg" padding="md">
              <span className="type-label text-ink-2">Your first hour</span>
              <ol className="mt-3 flex flex-col gap-2.5 text-sm text-ink">
                {product.first_hour.map((step, i) => (
                  <li key={step} className="flex items-start gap-2.5">
                    <span className="font-mono text-xs text-ink-2 mt-0.5">0{i + 1}</span>
                    <span>{step}</span>
                  </li>
                ))}
              </ol>
            </Tile>
          )}
        </div>
      </div>

      {related.length > 0 && (
        <section className="flex flex-col gap-5 pt-6 border-t border-line">
          <h2 className="type-h3 font-semibold text-ink">Pairs well with</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {related.map((rel) => (
              <ProductCard
                key={rel.id}
                product={rel}
                collection={collection}
                isPreviewData={isPreviewData}
              />
            ))}
          </div>
        </section>
      )}
      {/* Mobile Sticky Buy Bar (replaces MobileBottomBar on /products/:slug) */}
      <div
        role="region"
        aria-label="Purchase actions"
        className="lg:hidden fixed inset-x-0 bottom-0 z-[var(--z-header)] px-3 pb-[calc(0.5rem+env(safe-area-inset-bottom,0px))] pt-1 pointer-events-none"
      >
        <div className="pointer-events-auto mx-auto max-w-[520px] rounded-full bg-ink text-ink-on-dark shadow-[var(--shadow-float)] pl-5 pr-2 py-2 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <span className="block text-[11px] font-mono uppercase tracking-[0.06em] text-ink-on-dark-muted leading-none">
              1 licence · lifetime
            </span>
            <PriceTag cents={product.price_cents} size="md" inverted className="mt-0.5 block" />
          </div>
          {owned ? (
            <Button
              variant="primary"
              inverted
              size="md"
              to="/account?tab=library"
              icon={<FolderCheck size={16} strokeWidth={1.75} aria-hidden="true" />}
            >
              In your library
            </Button>
          ) : (
            <Button
              variant="primary"
              inverted
              size="md"
              disabled={isPreviewData}
              onClick={handleAdd}
            >
              {isPreviewData ? 'Preview only' : inCart ? 'In cart' : 'Add to cart'}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

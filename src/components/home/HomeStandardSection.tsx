import { Link } from 'react-router-dom';
import { ArrowUpRight } from 'lucide-react';
import { SplitHeadline, TileIn } from '../../lib/motion';

interface StandardPromise {
  num: string;
  headline: string;
  detail: string;
}

const STANDARD_PROMISES: StandardPromise[] = [
  {
    num: '01',
    headline: 'Know what is included before you buy.',
    detail: 'Product listings describe the downloadable files and the formats attached to each product.',
  },
  {
    num: '02',
    headline: 'Check the formats and requirements.',
    detail: 'Review the product page for its listed file formats, requirements, version and first steps.',
  },
  {
    num: '03',
    headline: 'Files for work you can make your own.',
    detail: 'Use the supplied files within the personal and direct commercial uses described by the Kinvai licence.',
  },
  {
    num: '04',
    headline: 'Your purchase stays in your library.',
    detail: 'Return to your account library to access the product while your purchase entitlement remains active.',
  },
];

/**
 * Section 10 — The Kinvai Standard (Inverted Ink Tile, 36px radius).
 * Features H2 "Built like products, not like *downloads.*" and a 2x2 grid with large mono numerals.
 */
export function HomeStandardSection() {
  return (
    <section
      aria-labelledby="home-standard-heading"
      className="rounded-[28px] lg:rounded-[36px] bg-ink text-page p-6 sm:p-10 lg:p-14"
    >
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6 pb-8 lg:pb-10 border-b border-white/12">
        <div className="flex flex-col gap-3">
          <span className="inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.08em] text-white/65">
            <span className="w-1.5 h-1.5 rounded-full bg-brand" aria-hidden="true" />
            The Kinvai standard
          </span>
          <SplitHeadline
            id="home-standard-heading"
            as="h2"
            immediate={false}
            text="Built like products, not like *downloads.*"
            className="type-h1 font-semibold text-page max-w-[18ch] leading-[1.08]"
          />
        </div>

        <Link
          to="/licence"
          viewTransition
          className="group inline-flex items-center gap-2.5 pl-4 pr-1.5 py-1.5 min-h-[44px] rounded-full bg-white/10 hover:bg-white/15 border border-white/15 text-sm font-medium text-page transition-colors self-start lg:self-end kv-press"
        >
          <span>Read the licence</span>
          <span
            aria-hidden="true"
            className="w-8 h-8 rounded-full bg-page text-ink inline-flex items-center justify-center"
          >
            <ArrowUpRight size={16} strokeWidth={1.75} className="kv-arrow-icon" />
          </span>
        </Link>
      </div>

      <div className="mt-8 lg:mt-10 grid grid-cols-1 md:grid-cols-2 gap-4 lg:gap-5">
        {STANDARD_PROMISES.map((item, idx) => (
          <TileIn key={item.num} index={idx}>
            <div className="rounded-[24px] bg-white/[0.05] border border-white/10 p-6 sm:p-8 flex flex-col justify-start gap-6 h-full">
              <div className="flex items-center justify-between">
                <span className="font-mono text-3xl sm:text-4xl font-semibold text-white/30 leading-none tabular-nums">
                  {item.num}
                </span>
                <span className="w-2 h-2 rounded-full bg-brand" aria-hidden="true" />
              </div>

              <div className="flex flex-col gap-2">
                <h3 className="text-lg sm:text-xl font-semibold text-page leading-snug">
                  {item.headline}
                </h3>
                <p className="text-sm sm:text-[15px] text-white/70 leading-relaxed max-w-[46ch]">
                  {item.detail}
                </p>
              </div>
            </div>
          </TileIn>
        ))}
      </div>
    </section>
  );
}

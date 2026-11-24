import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { z } from 'zod';
import { Breadcrumb, Button, TagPill, Tile } from '../components/primitives';
import { getProducts } from '../lib/data/repository';
import { usePageMeta } from '../lib/seo/usePageMeta';

function ContentFrame({
  crumb, eyebrow, title, lead, children, metaTitle,
}: {
  crumb: string; eyebrow: string; title: string; lead: string; children: ReactNode; metaTitle: string;
}) {
  usePageMeta({ title: metaTitle, description: lead });
  return (
    <div className="kv-container py-8 md:py-12 flex flex-col gap-8 md:gap-10">
      <Breadcrumb items={[{ label: 'Home', to: '/' }, { label: crumb }]} />
      <header className="max-w-4xl flex flex-col items-start gap-3">
        <TagPill>{eyebrow}</TagPill>
        <h1 className="type-h1 font-semibold text-ink">{title}</h1>
        <p className="type-body text-ink-2 prose-measure">{lead}</p>
      </header>
      {children}
    </div>
  );
}

function CopyTile({ eyebrow, heading, children, className = '' }: {
  eyebrow?: string; heading: string; children: ReactNode; className?: string;
}) {
  return (
    <Tile variant="white" radius="xl" padding="lg" className={'min-w-0 flex flex-col gap-3 ' + className}>
      {eyebrow ? <p className="type-label text-ink-2">{eyebrow}</p> : null}
      <h2 className="type-h3 font-semibold text-ink">{heading}</h2>
      <div className="text-[15px] leading-relaxed text-ink-2 prose-measure">{children}</div>
    </Tile>
  );
}

export function AboutPage() {
  return (
    <ContentFrame crumb="About" eyebrow="A better starting point" title="Built once, properly." lead="The blank page costs time. Kinvai exists to make the first useful version of a system available before the work begins." metaTitle="About Kinvai — Built once, properly.">
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-3 md:gap-4">
        <CopyTile eyebrow="THE REASON" heading="The same foundations get rebuilt over and over." className="lg:col-span-7 bg-peach">
          A spreadsheet, checklist, project plan or creative framework can take time to assemble before the real work even starts. Kinvai is built around a simple idea: make useful starting systems available as downloadable files, so more time goes into the work only the owner can do.
        </CopyTile>
        {/* OWNER_CONFIRM: verify that every published product page consistently displays the actual formats, included files, requirements and first steps. */}
        <CopyTile eyebrow="THE STANDARD" heading="A product should say exactly what is inside." className="lg:col-span-5">
          Product pages are intended to show the actual formats, included files, requirements and first steps. The catalogue should be checked against the attached deliverables before a product is published.
        </CopyTile>
        {/* OWNER_CONFIRM: confirm the actual authoring, testing and publishing checklist before making any stronger quality promise. */}
        <CopyTile eyebrow="HOW PRODUCTS ARE PREPARED" heading="Build. Compare. Publish." className="lg:col-span-4">
          Each product begins with a repeated task or a blank-page problem. Its working files are assembled into a reusable download. The final listing should be reviewed against the files attached to that product, including the displayed formats and version.
        </CopyTile>
        <CopyTile eyebrow="WHO IS BEHIND IT" heading="A direct line to the person making the work." className="lg:col-span-8">
          <p>Kinvai is made by Manish Talukdar under Arkvoid Inc.</p>
          <p className="mt-3">Questions about a product, order or licence can be sent to <a className="font-semibold text-brand-deep underline underline-offset-4" href="mailto:heyarkvoid@gmail.com">heyarkvoid@gmail.com</a>.</p>
          {/* OWNER_CONFIRM: confirm the catalogue is owner-operated and there are no third-party sellers. */}
          <p className="mt-3">The catalogue is owner-operated. There are no third-party sellers.</p>
        </CopyTile>
      </section>
      <div className="flex flex-wrap gap-3">
        <Button variant="primary" to="/shop">Explore the shop</Button>
        <Button variant="secondary" to="/how-it-works">How it works</Button>
      </div>
    </ContentFrame>
  );
}

const FORMAT_APPS: Record<string, string[]> = {
  xlsx: ['Microsoft Excel', 'Google Sheets', 'LibreOffice Calc'],
  xls: ['Microsoft Excel', 'LibreOffice Calc', 'Google Sheets (import)'],
  csv: ['Microsoft Excel', 'Google Sheets', 'LibreOffice Calc'],
  ods: ['LibreOffice Calc', 'Google Sheets', 'Microsoft Excel (import)'],
  docx: ['Microsoft Word', 'Google Docs', 'LibreOffice Writer'],
  doc: ['Microsoft Word', 'LibreOffice Writer'],
  pdf: ['A browser PDF viewer', 'Adobe Acrobat Reader', 'Apple Preview'],
  pptx: ['Microsoft PowerPoint', 'Google Slides', 'LibreOffice Impress'],
  ppt: ['Microsoft PowerPoint', 'LibreOffice Impress'],
  png: ['Preview / Photos', 'Adobe Photoshop', 'Most image editors'],
  jpg: ['Preview / Photos', 'Adobe Photoshop', 'Most image editors'],
  jpeg: ['Preview / Photos', 'Adobe Photoshop', 'Most image editors'],
  webp: ['Modern browsers', 'Preview / Photos', 'Most current image editors'],
  svg: ['Modern browsers', 'Figma', 'Inkscape'],
  zip: ['Windows File Explorer', 'macOS Archive Utility', '7-Zip'],
  json: ['VS Code', 'Any text editor', 'Browser developer tools'],
  html: ['Any modern browser', 'VS Code', 'Any text editor'],
  css: ['VS Code', 'Any text editor'],
  md: ['VS Code', 'Obsidian', 'Any Markdown reader'],
};

function PublishedFormats() {
  const [formats, setFormats] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const first = await getProducts({ page: 1, pageSize: 48, sort: 'name-asc' });
        if (!active) return;
        if (first.source === 'supabase') {
          const products = [...first.items];
          for (let page = 2; page <= first.totalPages; page += 1) {
            const next = await getProducts({ page, pageSize: 48, sort: 'name-asc' });
            if (next.source !== 'supabase') break;
            products.push(...next.items);
          }
          if (!active) return;
          const unique = new Set(products.flatMap((product) => product.file_formats || []).map((format) => format.trim()).filter(Boolean));
          setFormats([...unique].sort((a, b) => a.localeCompare(b)));
        }
        setLoaded(true);
      } catch {
        if (active) setLoaded(true);
      }
    })();
    return () => { active = false; };
  }, []);
  if (!loaded) return <CopyTile eyebrow="FILE COMPATIBILITY" heading="Formats in the live catalogue"><p>Loading formats from published products…</p></CopyTile>;
  if (formats.length === 0) return <CopyTile eyebrow="FILE COMPATIBILITY" heading="Check each product before purchase"><p>There are no published product formats available to list right now. Each product page is the source of truth for the files included with that product.</p></CopyTile>;
  return (
    <Tile variant="white" radius="xl" padding="lg" className="lg:col-span-12">
      <div className="flex flex-col gap-2 mb-5"><p className="type-label text-ink-2">FILE COMPATIBILITY · LIVE CATALOGUE</p><h2 className="type-h3 font-semibold">Which apps open which files?</h2><p className="text-sm text-ink-2">Formats below are read from currently published products. App examples are common compatible readers; check the product requirements for version-specific needs.</p></div>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
        {formats.map((format) => {
          const normalized = format.toLowerCase().replace(/^\./, '');
          const apps = FORMAT_APPS[normalized] || ['Use an application that supports this format'];
          return <div key={format} className="rounded-2xl border border-line bg-page p-4"><p className="font-mono text-sm font-semibold text-ink">.{normalized}</p><p className="mt-2 text-sm text-ink-2">{apps.join(' · ')}</p></div>;
        })}
      </div>
    </Tile>
  );
}

export function HowItWorksPage() {
  return (
    <ContentFrame crumb="How it works" eyebrow="Three clear beats" title="From a product page to a working file." lead="Choose the files that fit the work, pay through an available checkout provider, then access the purchase from the account library." metaTitle="How it works — Kinvai">
      <section className="grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-4">
        <CopyTile eyebrow="01 · CHOOSE" heading="Know what is included." className="bg-peach">
          Review the product description, listed formats, included files, requirements, version and first-hour notes before adding it to the cart.
        </CopyTile>
        <CopyTile eyebrow="02 · CHECK OUT" heading="Payment is confirmed server-side.">
          Checkout shows the payment methods configured for the current environment. The server and database validate the order and its amount; the browser does not set prices.
        </CopyTile>
        <CopyTile eyebrow="03 · DOWNLOAD" heading="Find the purchase in the library." className="bg-lilac">
          After verified payment, the product is linked to the signed-in account. Open the account library and request a short-lived download link for an active file.
        </CopyTile>
      </section>
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-3 md:gap-4">
        <CopyTile eyebrow="AFTER YOU PAY" heading="What happens next?" className="lg:col-span-5">
          <ol className="space-y-4">
            <li><strong className="text-ink">1. Provider confirmation.</strong> Razorpay or PayPal reports the payment outcome, which is verified on the server.</li>
            <li><strong className="text-ink">2. Library access.</strong> Once the order is marked paid, an entitlement connects the purchased product to the signed-in account.</li>
            <li><strong className="text-ink">3. Download.</strong> Open Account → Library and choose Download. Private files are delivered through a signed URL that expires after about 60 seconds.</li>
          </ol>
        </CopyTile>
        <CopyTile eyebrow="KEEP IN MIND" heading="Use the same sign-in." className="lg:col-span-7 bg-butter">
          Purchases are attached to the account active during checkout. Sign in with the same Google account to see the library. A payment still processing will not unlock a download until confirmation is received.
        </CopyTile>
        <PublishedFormats />
      </section>
    </ContentFrame>
  );
}

const FAQS = [
  { category: 'Orders & payments', question: 'Where is the product after payment?', answer: 'Sign in with the same Google account used during checkout and open Account → Library. Access appears after the payment has been verified and the order is marked paid.' },
  { category: 'Orders & payments', question: 'Which payment methods are available?', answer: 'Checkout displays the providers currently configured for the store and environment. A method that is not enabled will not be offered.' },
  { category: 'Downloads & files', question: 'My download did not start. What should I do?', answer: 'Open the account library again and request a fresh download link. Links are short-lived. Check the browser download panel and try another supported browser if the file is blocked.' },
  { category: 'Downloads & files', question: 'Which file formats are included?', answer: 'The product page lists the formats attached to that product. The format guide on the How it works page is derived from the currently published catalogue.' },
  { category: 'Downloads & files', question: 'Can a product be downloaded again?', answer: 'The account library can request a new signed link while the account still has an active entitlement and the product has an active downloadable file.' },
  { category: 'Licence & refunds', question: 'Can a file be used commercially?', answer: 'Yes. The Kinvai licence allows personal and commercial use in projects and direct business operations. The files themselves cannot be resold or redistributed.' },
  { category: 'Licence & refunds', question: 'How do refunds work for digital products?', answer: 'Read the current Refunds page and email the order number with the issue. The published policy remains a draft until the owner completes its legal review.' },
  { category: 'Account', question: 'How do I access a previous purchase?', answer: 'Choose Sign in with Google using the same account used at checkout, then open Account → Library.' },
];
const ContactSchema = z.object({
  name: z.string().trim().min(2, 'Enter a name.').max(100),
  email: z.string().trim().email('Enter a valid email address.').max(254),
  subject: z.string().trim().max(140),
  message: z.string().trim().min(10, 'Add at least 10 characters.').max(5000),
  website: z.string().max(120),
});

function SupportContactForm() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [website, setWebsite] = useState('');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFeedback(null);
    const parsed = ContactSchema.safeParse({ name, email, subject, message, website });
    if (!parsed.success) {
      setFeedback({ tone: 'error', text: parsed.error.issues[0]?.message || 'Check the form and try again.' });
      return;
    }
    if (parsed.data.website.trim()) return;
    setBusy(true);
    try {
      const response = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed.data),
      });
      const payload = await response.json().catch(() => null) as { ok?: boolean; message?: string; error?: string } | null;
      if (!response.ok || !payload?.ok) throw new Error(payload?.error || 'The message could not be sent. Please email heyarkvoid@gmail.com instead.');
      setFeedback({ tone: 'success', text: payload.message || 'Message received.' });
      setName(''); setEmail(''); setSubject(''); setMessage('');
    } catch (error) {
      setFeedback({ tone: 'error', text: error instanceof Error ? error.message : 'The message could not be sent. Please email heyarkvoid@gmail.com instead.' });
    } finally {
      setBusy(false);
    }
  };
  const fieldClass = 'w-full min-h-12 rounded-2xl border border-line bg-page px-4 py-3 text-base text-ink placeholder:text-ink-3 focus:outline-none focus:ring-2 focus:ring-brand';
  return (
    <Tile variant="white" radius="xl" padding="lg" className="lg:col-span-5">
      <h2 className="type-h3 font-semibold">Send a message</h2>
      <p className="text-sm text-ink-2 mt-2 mb-5">Share the order number or product name when it helps explain the issue.</p>
      <form className="space-y-3" onSubmit={(event) => void submit(event)}>
        <label className="block text-sm font-medium">Name<input className={fieldClass + ' mt-1.5'} autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} required maxLength={100} /></label>
        <label className="block text-sm font-medium">Email<input className={fieldClass + ' mt-1.5'} type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required maxLength={254} /></label>
        <label className="block text-sm font-medium">Subject <span className="font-normal text-ink-3">(optional)</span><input className={fieldClass + ' mt-1.5'} value={subject} onChange={(event) => setSubject(event.target.value)} maxLength={140} /></label>
        <label className="block text-sm font-medium">Message<textarea className={fieldClass + ' mt-1.5 min-h-36'} value={message} onChange={(event) => setMessage(event.target.value)} required minLength={10} maxLength={5000} /></label>
        <label className="absolute -left-[10000px] top-auto h-px w-px overflow-hidden" aria-hidden="true">Leave this field empty<input tabIndex={-1} autoComplete="off" name="website" value={website} onChange={(event) => setWebsite(event.target.value)} /></label>
        {feedback ? <p role="status" aria-live="polite" className={'text-sm ' + (feedback.tone === 'success' ? 'text-success' : 'text-error')}>{feedback.text}</p> : null}
        <Button type="submit" variant="primary" disabled={busy}>{busy ? 'Sending…' : 'Send message'}</Button>
      </form>
    </Tile>
  );
}

export function SupportPage() {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('All');
  const categories = ['All', ...new Set(FAQS.map((item) => item.category))];
  const filtered = useMemo(() => FAQS.filter((item) => (category === 'All' || item.category === category) && (item.question + ' ' + item.answer).toLowerCase().includes(query.trim().toLowerCase())), [category, query]);
  return (
    <ContentFrame crumb="Support" eyebrow="Help, without the runaround" title="A clear answer, or a direct line." lead="Search the common questions below. For a specific order, file or account issue, send a message directly to Arkvoid Inc." metaTitle="Support — Kinvai">
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-3 md:gap-4">
        <Tile variant="white" radius="xl" padding="lg" className="lg:col-span-7">
          <div className="flex flex-col gap-3">
            <h2 className="type-h3 font-semibold">Frequently asked questions</h2>
            <label className="block"><span className="sr-only">Search support questions</span><input className="w-full min-h-12 rounded-full border border-line bg-page px-5 text-base text-ink focus:outline-none focus:ring-2 focus:ring-brand" type="search" placeholder="Search orders, files, licence…" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
            <div className="flex flex-wrap gap-2" aria-label="FAQ categories">
              {categories.map((item) => <button key={item} type="button" onClick={() => setCategory(item)} className={'min-h-11 rounded-full border px-4 text-sm font-medium ' + (category === item ? 'border-ink bg-ink text-white' : 'border-line bg-white text-ink hover:bg-stone')}>{item}</button>)}
            </div>
            <p className="text-xs text-ink-2" aria-live="polite">{filtered.length} {filtered.length === 1 ? 'answer' : 'answers'} found</p>
            <div className="divide-y divide-line border-t border-line">
              {filtered.map((item) => <details key={item.question} className="py-4 group"><summary className="cursor-pointer list-none flex items-center justify-between gap-3 text-sm font-semibold text-ink min-h-11">{item.question}<span aria-hidden="true" className="text-brand-deep text-xl">+</span></summary><p className="text-sm leading-relaxed text-ink-2 mt-2 pr-5">{item.answer}</p></details>)}
              {filtered.length === 0 ? <p className="py-6 text-sm text-ink-2">Nothing matched. Try fewer words or write to support.</p> : null}
            </div>
          </div>
        </Tile>
        <div className="lg:col-span-5 flex flex-col gap-3 md:gap-4">
          <CopyTile eyebrow="DIRECT CONTACT" heading="heyarkvoid@gmail.com" className="bg-peach">
            <p>For an order issue, include the order number. For a file question, include the product name and the format being used.</p>
            <p className="mt-4"><a className="font-semibold text-brand-deep underline underline-offset-4 break-all" href="mailto:heyarkvoid@gmail.com">Email support</a></p>
          </CopyTile>
          <SupportContactForm />
        </div>
      </section>
    </ContentFrame>
  );
}

export function LicencePage() {
  return (
    <ContentFrame crumb="Licence" eyebrow="Usage rights" title="Use the work. Keep the files yours." lead="The Kinvai licence is designed for personal projects and direct commercial work. It does not transfer ownership of the downloadable source files." metaTitle="Licence — Kinvai">
      <section className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4">
        <CopyTile eyebrow="PERMITTED" heading="Personal and commercial use." className="bg-peach">
          Use, edit, adapt and reproduce the purchased files within personal projects and projects for a directly operated business. Output created using the files may be used in those projects.
        </CopyTile>
        <CopyTile eyebrow="NOT PERMITTED" heading="Do not resell or redistribute the files." className="bg-lilac">
          Do not sell, sublicense, share, publish or redistribute the Kinvai files themselves, in original or modified form. Do not upload them as standalone downloads or include them in another template or asset marketplace.
        </CopyTile>
        <CopyTile heading="One purchase, one account entitlement.">
          The purchase gives the purchasing account access to the product files for the uses described above. It does not grant ownership of Kinvai trademarks, branding or other intellectual property.
        </CopyTile>
        <CopyTile heading="Need a different arrangement?">
          For team-wide redistribution, resale rights or other permissions not covered here, request written permission before using the files that way. Contact <a className="font-semibold text-brand-deep underline" href="mailto:heyarkvoid@gmail.com">heyarkvoid@gmail.com</a>.
        </CopyTile>
      </section>
    </ContentFrame>
  );
}

export function PrivacyPage() {
  return (
    <ContentFrame crumb="Privacy" eyebrow="Legal draft · owner and lawyer review required" title="Privacy policy" lead="This draft describes the information used to sign in, process a digital order, provide downloads and respond to support requests. It is not ready for publication until the marked details are completed." metaTitle="Privacy policy — Kinvai">
      <section className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4">
        <CopyTile heading="Who operates Kinvai.">Kinvai is operated by Arkvoid Inc. Contact: <a className="font-semibold text-brand-deep underline" href="mailto:heyarkvoid@gmail.com">heyarkvoid@gmail.com</a>. [OWNER TO COMPLETE: legal entity address, incorporation jurisdiction, registration details and privacy contact, if different.]</CopyTile>
        <CopyTile heading="Account information.">Google sign-in is used to authenticate an account. The application may process the account identifier, email address, display name and profile image supplied through the sign-in flow. [OWNER TO COMPLETE: confirm the exact Google OAuth scopes and profile fields retained.]</CopyTile>
        <CopyTile heading="Orders and payment processors.">Kinvai stores order, item, amount, currency, provider reference, payment status and entitlement records needed to fulfil a purchase. Razorpay and PayPal process payment details under their own terms and privacy notices. Kinvai does not intentionally store full card numbers or security codes.</CopyTile>
        <CopyTile heading="Downloads and support.">Download logs may include the account, product and file reference, request time, browser user-agent and an IP-derived hash for delivery security. Contact messages and newsletter sign-ups are retained so the store can respond and manage communications. [OWNER TO COMPLETE: confirm log fields and any additional operational logs.]</CopyTile>
        <CopyTile heading="Necessary storage only.">The site uses necessary sign-in/session storage and essential application storage to keep account access and core functions working. No advertising or analytics cookie is intended by this draft. [OWNER TO COMPLETE: inventory actual cookies, local/session storage keys, expiry periods, Google/Supabase/Cloud Run behavior and payment SDK storage before publication.]</CopyTile>
        <CopyTile heading="Retention and deletion.">Information is kept only for as long as needed for account access, order fulfilment, security, support, legal and accounting obligations. [OWNER TO COMPLETE: set an actual retention schedule for profiles, orders, download logs, contact messages, newsletter records, backups and deletion requests.]</CopyTile>
        <CopyTile heading="Rights and international transfers.">Depending on the location of the customer, local privacy laws may provide rights to access, correct, delete or restrict certain personal information. [OWNER TO COMPLETE: identify applicable laws, lawful bases, controller/processor roles, cross-border transfer safeguards and request process.]</CopyTile>
        <CopyTile heading="Contact.">For privacy questions, email heyarkvoid@gmail.com. [OWNER TO COMPLETE: identify the governing jurisdiction, complaint authority and required statutory disclosures.]</CopyTile>
      </section>
    </ContentFrame>
  );
}

export function TermsPage() {
  return (
    <ContentFrame crumb="Terms" eyebrow="Legal draft · owner and lawyer review required" title="Terms of service" lead="These draft terms cover access to the storefront and purchases of downloadable digital products. They need jurisdiction-specific legal review before they can govern a live store." metaTitle="Terms of service — Kinvai">
      <section className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4">
        <CopyTile heading="Operator and eligibility.">The storefront is operated by Arkvoid Inc. at kinvai.arkvoid.com. [OWNER TO COMPLETE: legal address, company registration, governing law, minimum age and any geographic restrictions.]</CopyTile>
        <CopyTile heading="Digital products.">Kinvai sells downloadable digital files. The product page describes the listed formats, included deliverables, requirements and current version. Review that information before placing an order.</CopyTile>
        <CopyTile heading="Orders and payment.">Prices are displayed in USD. Payment is processed through the provider offered at checkout, which may include Razorpay or PayPal. An order is complete only after the payment provider result is verified by Kinvai's server and the order is marked paid.</CopyTile>
        <CopyTile heading="Access and account security.">Purchases are linked to the signed-in account. Keep access to that account secure and contact support if access is lost or a purchase appears on the wrong account. Do not share private download links.</CopyTile>
        <CopyTile heading="Licence and prohibited use.">Use of downloaded files is governed by the Kinvai Licence page. Resale or redistribution of the files themselves is not permitted. Do not use the site to interfere with its security, access controls or normal operation.</CopyTile>
        <CopyTile heading="Availability and changes.">Products, files and features may be corrected or updated. [OWNER TO COMPLETE: define update/support commitments, withdrawal rules, outage handling, tax/VAT treatment and change-notice requirements.]</CopyTile>
        <CopyTile heading="Liability and disputes.">[OWNER TO COMPLETE: lawyer to draft mandatory consumer rights, warranties, disclaimers, limitation of liability, indemnity, dispute procedure, arbitration/courts and enforceability language under the chosen governing law.]</CopyTile>
        <CopyTile heading="Contact.">Questions about these terms can be sent to heyarkvoid@gmail.com. [OWNER TO COMPLETE: effective date, company address and versioning process.]</CopyTile>
      </section>
    </ContentFrame>
  );
}

export function RefundsPage() {
  return (
    <ContentFrame crumb="Refunds" eyebrow="Legal draft · owner and lawyer review required" title="Refunds for digital goods" lead="A fair draft process for payment errors, missing downloads and files that do not work as described. The final policy must be checked against applicable consumer law." metaTitle="Refund policy — Kinvai">
      <section className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4">
        <CopyTile eyebrow="START HERE" heading="Contact support with the order details." className="bg-peach">
          Email heyarkvoid@gmail.com with the order number, the product name and a clear description of the problem. Do not send full payment-card details or account passwords.
        </CopyTile>
        <CopyTile eyebrow="WHEN TO CONTACT" heading="Payment or delivery problems.">
          Contact support for duplicate charges, a payment marked complete without library access, a broken or incomplete file, or a material difference between the delivered file and the product description.
        </CopyTile>
        <CopyTile heading="Digital delivery.">Because digital files may become accessible immediately after payment confirmation, a change-of-mind request after access may be treated differently from a product that was not delivered or is materially defective. This draft does not remove any non-waivable rights available under local law.</CopyTile>
        <CopyTile heading="Review and remedy.">Support may first investigate the payment, restore access, provide a corrected file or explain how to open the format. A refund may be considered where a charge was duplicated, delivery failed, or a material defect cannot reasonably be fixed, subject to applicable law and the final policy.</CopyTile>
        <CopyTile heading="Time limits and exceptions.">[OWNER TO COMPLETE: approve the request window, review time, refund method, treatment of partial downloads, chargebacks, taxes, bundle purchases and any statutory withdrawal or digital-content consent rules. Do not publish an arbitrary no-refund rule without legal review.]</CopyTile>
        <CopyTile heading="Payment provider records.">Refunds are processed through the payment provider and remain subject to its processing steps. Kinvai does not ask customers to send card numbers or security codes by email.</CopyTile>
      </section>
    </ContentFrame>
  );
}

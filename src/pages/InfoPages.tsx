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
        <CopyTile eyebrow="THE STANDARD" heading="A product should say exactly what is inside." className="lg:col-span-5">
          Each product listing describes the files and formats recorded for that product. Review the listed contents and requirements before purchase.
        </CopyTile>
        <CopyTile eyebrow="HOW PRODUCTS ARE PREPARED" heading="Build. Compare. Publish." className="lg:col-span-4">
          Kinvai's catalogue is organised around reusable digital files. Product listings identify the current version and the formats recorded for each downloadable product.
        </CopyTile>
        <CopyTile eyebrow="WHO IS BEHIND IT" heading="A direct line to the person making the work." className="lg:col-span-8">
          <p>Kinvai is created by Manish Talukdar and presented under the business name Arkvoid Inc.</p>
          <p className="mt-3">Questions about a product, order or licence can be sent to <a className="font-semibold text-brand-deep underline underline-offset-4" href="mailto:heyarkvoid@gmail.com">heyarkvoid@gmail.com</a>.</p>
          <p className="mt-3">The catalogue is maintained by its owner. Products are offered directly through Kinvai.</p>
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
    <ContentFrame crumb="Privacy" eyebrow="How Kinvai handles information" title="Privacy policy" lead="This page explains the account, order, download and support information used to run Kinvai, and how to contact us about your data." metaTitle="Privacy policy — Kinvai">
      <section className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4">
        <CopyTile heading="Who to contact.">
          Kinvai is presented under the business name Arkvoid Inc. For privacy questions or requests, email heyarkvoid@gmail.com. The business name shown here is a public-facing name; this page does not make a representation about incorporation or registration status.
        </CopyTile>
        <CopyTile heading="Google sign-in and account details.">
          When you choose Google sign-in, Google and the authentication service process information needed to authenticate you. This can include your account identifier, email address, name and profile image when supplied by Google. Kinvai also uses the account identifier and available profile details to connect your account with your library, saved products and orders.
        </CopyTile>
        <CopyTile heading="Orders and payments.">
          Kinvai processes order details such as the products purchased, order number, amount, currency, payment provider, provider references, payment status and account entitlement. Razorpay or PayPal handles payment information through its own payment service. Kinvai does not ask you to email card numbers or security codes and does not intentionally store full payment-card numbers or security codes.
        </CopyTile>
        <CopyTile heading="Downloads and security.">
          To protect paid files and investigate delivery problems, download requests may be recorded with the account, product and file identifiers, request time, a one-way keyed hash derived from the request IP address, and the browser user-agent. Download links are temporary. Security and rate-limiting systems may also process request/network information.
        </CopyTile>
        <CopyTile heading="Messages and newsletter.">
          If you contact support, Kinvai receives the name, email address, optional subject and message you submit. If you subscribe to updates, Kinvai stores the email address you provide. These details are used to reply to your request or send the updates you requested. You can ask to stop newsletter messages by contacting support.
        </CopyTile>
        <CopyTile heading="Browser storage.">
          Kinvai uses browser storage required for sign-in sessions and storefront functions such as the cart and saved products. Google, Supabase and payment providers may use their own storage when their services are used. Browser settings can clear or block storage, but doing so may affect sign-in, checkout or saved state. This policy does not claim that every third-party service uses no cookies.
        </CopyTile>
        <CopyTile heading="Service providers and transfers.">
          Kinvai relies on service providers to host the application and data, authenticate accounts, store product files, and process payments. These providers may process information in the countries where their systems operate. Their own privacy notices and terms also apply to their services. Access to information is limited to what is needed to operate, secure and support the store.
        </CopyTile>
        <CopyTile heading="Retention and deletion requests.">
          Kinvai keeps account, order, download, support and newsletter information for as long as it is reasonably needed to provide the service, maintain purchase records, prevent fraud, resolve disputes, and meet applicable legal or accounting obligations. Different records may need to be retained for different periods. To request access, correction or deletion, email heyarkvoid@gmail.com from the account email and describe the request. Some order or security records may need to be retained where the law permits or requires it.
        </CopyTile>
        <CopyTile heading="Your choices.">
          You can stop using the site, sign out, manage browser storage through your browser settings, and contact Kinvai to request access, correction or deletion of personal information. Rights and response requirements depend on the laws that apply to you. Nothing on this page is intended to remove a privacy right that cannot legally be waived.
        </CopyTile>
      </section>
    </ContentFrame>
  );
}

export function TermsPage() {
  return (
    <ContentFrame crumb="Terms" eyebrow="Store terms" title="Terms of service" lead="These terms explain the basic rules for using Kinvai and buying downloadable digital products. Mandatory consumer rights continue to apply." metaTitle="Terms of service — Kinvai">
      <section className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4">
        <CopyTile heading="Store identity and contact.">
          Kinvai is presented under the business name Arkvoid Inc. at kinvai.arkvoid.com. For questions about the store, an order or these terms, email heyarkvoid@gmail.com. Arkvoid Inc. is the public-facing business name used by Kinvai; this wording does not claim a particular incorporation or registration status.
        </CopyTile>
        <CopyTile heading="Who may use the store.">
          You may use Kinvai only if you can lawfully enter into a purchase agreement where you live. If you are not legally able to do so, a parent or legal guardian must make the purchase and supervise your use where permitted by law.
        </CopyTile>
        <CopyTile heading="Products and product descriptions.">
          Kinvai sells downloadable digital files. The product page is the source of information about the listed contents, formats, requirements, version and price. Review those details and make sure you have compatible software before purchasing. Product availability and listed files may change over time.
        </CopyTile>
        <CopyTile heading="Orders and payment.">
          Prices are displayed in USD unless the checkout clearly states otherwise. Available payment methods are shown at checkout. An order is accepted for fulfilment after the payment provider result is verified and the order is marked paid. The amount and currency are validated by the order service, not by information entered in the browser.
        </CopyTile>
        <CopyTile heading="Account and downloads.">
          Purchases are connected to the account used during checkout. Keep your sign-in credentials secure and do not share private download links. Access to downloads requires an active purchase entitlement and an active product file. Download links are temporary; you can request a fresh link from your account library while the entitlement and file remain active.
        </CopyTile>
        <CopyTile heading="Licence and acceptable use.">
          Your use of purchased files is governed by the Kinvai Licence page. You may not resell, sublicense, share or redistribute the files themselves, in original or modified form, or use the store to interfere with its security or normal operation.
        </CopyTile>
        <CopyTile heading="Updates and availability.">
          The purchased version is the version identified on the product page at the time of purchase. Kinvai may correct or replace files, but does not promise a fixed update schedule or lifetime updates unless a particular product listing expressly says otherwise. Temporary service interruptions or changes to the catalogue do not remove rights attached to a completed purchase under applicable law.
        </CopyTile>
        <CopyTile heading="Refunds and mandatory rights.">
          Refund requests are handled under the Kinvai Refunds page. Nothing in these terms excludes, restricts or replaces consumer rights, warranties or remedies that cannot legally be excluded or restricted where you live.
        </CopyTile>
        <CopyTile heading="Liability.">
          Kinvai will take reasonable care in operating the storefront and delivering the files described on product pages. To the extent permitted by applicable law, Kinvai is not responsible for indirect or consequential loss arising from use of the site or files. Nothing in these terms limits liability for fraud, intentional misconduct, or any liability or remedy that applicable law does not allow to be limited.
        </CopyTile>
        <CopyTile heading="Changes and questions.">
          These terms may be updated when the store or its practices change. The current version is the one published on this page. Questions or concerns should be sent to heyarkvoid@gmail.com. If a provision cannot be enforced under applicable law, the remaining provisions continue to apply to the extent permitted.
        </CopyTile>
      </section>
    </ContentFrame>
  );
}

export function RefundsPage() {
  return (
    <ContentFrame crumb="Refunds" eyebrow="Digital purchase support" title="Refunds for digital goods" lead="If a payment was duplicated, a download is missing, or a delivered file has a material problem, contact us and we will review the order." metaTitle="Refund policy — Kinvai">
      <section className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4">
        <CopyTile eyebrow="START HERE" heading="Contact support within 14 days." className="bg-peach">
          Email heyarkvoid@gmail.com within 14 calendar days of the purchase, include the order number and product name, and explain the issue. Do not send card numbers, security codes or account passwords. This request period does not limit any longer or non-waivable rights available under applicable law.
        </CopyTile>
        <CopyTile eyebrow="WHEN WE REVIEW A REFUND" heading="Payment and delivery problems.">
          We review duplicate charges, payments marked complete without library access, missing or corrupted files, and files that materially differ from the product description. If the problem can be fixed promptly by restoring access or supplying a corrected file, we may offer that remedy; this does not remove any legal right to a refund or other remedy.
        </CopyTile>
        <CopyTile heading="Change-of-mind requests.">
          Digital products may be made available immediately after payment. A change-of-mind request after access has been provided is not automatically eligible under this store policy. This does not affect any cancellation, withdrawal or refund right that applies by law, including rights that cannot be waived for digital content.
        </CopyTile>
        <CopyTile heading="How approved refunds are handled.">
          Where a refund is approved, it is sent through the original payment provider and, where supported, to the original payment method. The time for the funds to appear depends on the provider and the financial institution. Kinvai cannot control their processing time.
        </CopyTile>
        <CopyTile heading="Partial downloads and bundles.">
          If only part of a bundle was downloaded or used, explain that in your request. We review the order, access and technical records and consider the nature of the issue and any applicable consumer rights. We do not ask customers to disclose payment-card details by email.
        </CopyTile>
        <CopyTile heading="Your legal rights remain.">
          This policy is an additional support process, not a waiver of consumer protection law. If the law where you live gives you a longer request period or a mandatory right to cancel, withdraw or receive a refund, that legal right takes priority over the 14-day store request period or any other wording on this page.
        </CopyTile>
      </section>
    </ContentFrame>
  );
}

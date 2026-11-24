import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Download, ExternalLink, Inbox, Mail, RefreshCw, Save, ShieldCheck } from 'lucide-react';
import { Button, Checkbox, Input, Skeleton, TagPill, Tile, useToast } from '../../components/primitives';
import { getPublicConfig } from '../../lib/config';
import { getSupabaseBrowserClient } from '../../lib/supabase/client';
import type { Collection, Product } from '../../lib/data/types';
import { formatUsd, uploadCollectionImage } from './adminHelpers';
import { useAuth } from '../../lib/auth/AuthProvider';
import { z } from 'zod';

const cardClass = 'rounded-[24px] border border-line bg-surface p-4 sm:p-5';
const inputClass = 'w-full min-h-[44px] rounded-[14px] border border-line bg-surface px-4 py-2.5 text-base text-ink focus:border-ink focus:outline-2 focus:outline-brand';
const textareaClass = inputClass + ' min-h-[110px] py-3';
const money = (cents: number) => formatUsd(cents);

type OrderRow = {
  id: string; order_number: string; user_id: string; status: string; provider: string | null;
  currency: string; total_cents: number; provider_order_id: string | null; provider_payment_id: string | null; created_at: string;
};
type OrderItemRow = { id: string; order_id: string; product_name: string; sku: string; unit_price_cents: number };
type PaymentEventRow = { id: string; provider: string; event_id: string; event_type: string; payload: unknown; received_at: string };
type ReviewRow = { id: string; user_id: string; product_id: string; rating: number; title: string | null; body: string | null; status: string; created_at: string; productName?: string; reviewerName?: string };
type InboxMessage = { id: string; name: string; email: string; subject: string | null; message: string; handled: boolean; created_at: string };
type SubscriberRow = { id: string; email: string; source: string | null; created_at: string };

function StatTile({ label, value, note }: { label: string; value: string | number; note?: string }) {
  return <div className="rounded-[22px] bg-surface border border-line p-4"><p className="text-xs uppercase tracking-[0.08em] text-ink-3">{label}</p><p className="text-3xl sm:text-4xl font-semibold tracking-tight text-ink mt-2 tabular-nums">{value}</p>{note ? <p className="text-xs text-ink-2 mt-1">{note}</p> : null}</div>;
}

export function AdminOverviewPage() {
  const client = getSupabaseBrowserClient();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [products, setProducts] = useState<Product[]>([]);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [revenue, setRevenue] = useState(0);
  const [pendingReviews, setPendingReviews] = useState(0);
  const [activeFiles, setActiveFiles] = useState<Array<{product_id:string}>>([]);

  const load = useCallback(async () => {
    if (!client) { setLoading(false); return; }
    setLoading(true);
    const weekStart = new Date();
    const day = (weekStart.getDay() + 6) % 7;
    weekStart.setDate(weekStart.getDate() - day);
    weekStart.setHours(0, 0, 0, 0);
    const [p, o, r, f] = await Promise.all([
      client.from('products').select('*'),
      client.from('orders').select('id,order_number,user_id,status,provider,currency,total_cents,provider_order_id,provider_payment_id,created_at').order('created_at', { ascending: false }),
      client.from('reviews').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
      client.from('product_files').select('product_id').eq('is_active', true),
    ]);
    const error = p.error || o.error || r.error || f.error;
    if (error) toast({ title: 'Overview could not be fully loaded', description: error.message, tone: 'error' });
    const productRows = (p.data || []) as Product[];
    const orderRows = (o.data || []) as OrderRow[];
    setProducts(productRows);
    setOrders(orderRows);
    setRevenue(orderRows.filter((item) => item.status === 'paid').reduce((sum, item) => sum + item.total_cents, 0));
    setPendingReviews(r.count || 0);
    setActiveFiles((f.data || []) as Array<{product_id:string}>);
    setLoading(false);
  }, [client, toast]);

  useEffect(() => { void load(); }, [load]);

  const startOfWeek = new Date();
  startOfWeek.setDate(startOfWeek.getDate() - ((startOfWeek.getDay() + 6) % 7));
  startOfWeek.setHours(0,0,0,0);
  const weekOrders = orders.filter((order) => new Date(order.created_at) >= startOfWeek);
  const published = products.filter((item) => item.status === 'published');
  const drafts = products.filter((item) => item.status === 'draft');
  const activeFileIds = new Set(activeFiles.map((item) => item.product_id));
  const missingCover = products.filter((item) => !item.cover_path);
  const missingFile = products.filter((item) => !activeFileIds.has(item.id));

  if (loading) return <div className="grid grid-cols-2 xl:grid-cols-3 gap-3"><Skeleton className="h-28" rounded="lg"/><Skeleton className="h-28" rounded="lg"/><Skeleton className="h-28" rounded="lg"/><Skeleton className="h-28" rounded="lg"/></div>;

  return <div className="space-y-5">
    <div className="flex items-center justify-between gap-3"><div><h2 className="text-xl font-semibold">Your business, at a glance</h2><p className="text-sm text-ink-2 mt-1">Live figures from the catalogue and orders database.</p></div><Button size="sm" variant="secondary" onClick={() => void load()} icon={<RefreshCw size={16}/>}>Refresh</Button></div>
    <div className="grid grid-cols-2 xl:grid-cols-3 gap-3">
      <StatTile label="Revenue · paid orders" value={money(revenue)} note="USD, all-time"/>
      <StatTile label="Orders this week" value={weekOrders.length} note="Since Monday, local time"/>
      <StatTile label="Products" value={products.length} note={published.length + ' published · ' + drafts.length + ' drafts'}/>
      <StatTile label="Pending reviews" value={pendingReviews}/>
      <StatTile label="Missing cover" value={missingCover.length}/>
      <StatTile label="Missing active file" value={missingFile.length}/>
    </div>
    <section className={cardClass}>
      <div className="flex items-center justify-between gap-3"><h3 className="font-semibold">Recent orders</h3><span className="text-xs text-ink-3">Latest 8</span></div>
      {orders.length === 0 ? <p className="text-sm text-ink-2 mt-4">No orders have arrived yet.</p> : <div className="mt-3 divide-y divide-line">{orders.slice(0,8).map((order) => <div key={order.id} className="py-3 flex flex-wrap gap-3 items-center justify-between"><div><p className="font-medium text-sm">{order.order_number}</p><p className="text-xs text-ink-3 mt-1">{new Date(order.created_at).toLocaleString()} · {order.provider || 'No provider'}</p></div><div className="flex items-center gap-3"><span className="text-sm font-mono">{money(order.total_cents)}</span><TagPill>{order.status}</TagPill></div></div>)}</div>}
      <div className="mt-3"><Button size="sm" variant="secondary" to="/admin/orders">All orders</Button></div>
    </section>
  </div>;
}

const CollectionSchema = z.object({
  name: z.string().trim().min(2).max(100),
  slug: z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(100),
  tagline: z.string().trim().min(2).max(180),
  story: z.string().trim().max(2000),
  accent: z.enum(['apricot','butter','lilac','rose','cocoa']),
  sort_order: z.number().int().min(0).max(10000),
  is_active: z.boolean(),
});

export function AdminCollectionsPage() {
  const client = getSupabaseBrowserClient();
  const { toast } = useToast();
  const [collections, setCollections] = useState<Collection[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeId, setActiveId] = useState('');
  const [draft, setDraft] = useState({ name:'', slug:'', tagline:'', story:'', accent:'apricot' as Collection['accent'], sort_order:0, is_active:true });
  const [imageFile, setImageFile] = useState<File | null>(null);

  const load = useCallback(async () => {
    if (!client) { setLoading(false); return; }
    const { data, error } = await client.from('collections').select('*').order('sort_order', { ascending:true });
    if (error) toast({ title:'Collections could not be loaded', description:error.message, tone:'error' });
    const rows = (data || []) as Collection[];
    setCollections(rows);
    if (!activeId && rows[0]) {
      setActiveId(rows[0].id);
      setDraft({ name:rows[0].name, slug:rows[0].slug, tagline:rows[0].tagline || '', story:rows[0].story || '', accent:rows[0].accent, sort_order:rows[0].sort_order, is_active:rows[0].is_active });
    }
    setLoading(false);
  }, [client, toast, activeId]);

  useEffect(() => { void load(); }, [load]);

  const select = (item: Collection) => {
    setActiveId(item.id);
    setDraft({ name:item.name, slug:item.slug, tagline:item.tagline || '', story:item.story || '', accent:item.accent, sort_order:item.sort_order, is_active:item.is_active });
    setImageFile(null);
  };
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!client) return;
    const parsed = CollectionSchema.safeParse(draft);
    if (!parsed.success) { toast({ title:'Check collection fields', description:parsed.error.issues[0]?.message, tone:'error' }); return; }
    setSaving(true);
    try {
      const dupe = await client.from('collections').select('id').eq('slug', parsed.data.slug).neq('id', activeId || '00000000-0000-0000-0000-000000000000').maybeSingle();
      if (dupe.error) throw dupe.error;
      if (dupe.data) throw new Error('That collection slug is already in use.');
      const result = activeId
        ? await client.from('collections').update(parsed.data).eq('id', activeId).select('*').single()
        : await client.from('collections').insert(parsed.data).select('*').single();
      if (result.error || !result.data) throw result.error || new Error('Collection was not saved.');
      let saved = result.data as Collection;
      if (imageFile) {
        const path = await uploadCollectionImage(client, saved.id, imageFile);
        const update = await client.from('collections').update({ image_path:path }).eq('id', saved.id).select('*').single();
        if (update.error || !update.data) throw update.error || new Error('Collection image path could not be saved.');
        saved = update.data as Collection;
      }
      toast({ title:'Collection saved', tone:'success' });
      setActiveId(saved.id);
      setImageFile(null);
      setCollections((previous) => previous.some((item) => item.id === saved.id) ? previous.map((item) => item.id === saved.id ? saved : item) : [...previous, saved]);
    } catch (error) {
      toast({ title:'Collection was not saved', description:error instanceof Error ? error.message : 'Try again.', tone:'error' });
    } finally { setSaving(false); }
  };

  return <div className="grid grid-cols-1 lg:grid-cols-[240px_minmax(0,1fr)] gap-4">
    <aside className={cardClass + ' h-fit'}><div className="flex items-center justify-between"><h3 className="font-semibold">Collections</h3><Button size="sm" variant="secondary" onClick={() => { setActiveId(''); setDraft({name:'',slug:'',tagline:'',story:'',accent:'apricot',sort_order:collections.length,is_active:true}); setImageFile(null); }}>New</Button></div><div className="mt-3 space-y-1">{collections.map((item) => <button key={item.id} type="button" onClick={() => select(item)} className={'w-full text-left rounded-[14px] px-3 py-3 text-sm ' + (item.id === activeId ? 'bg-ink text-white' : 'hover:bg-stone text-ink')}>{item.name}</button>)}</div></aside>
    <form className={cardClass + ' space-y-4'} onSubmit={(event) => void save(event)}>
      <h3 className="font-semibold">{activeId ? 'Edit collection' : 'New collection'}</h3>
      {loading ? <Skeleton className="h-32" rounded="lg"/> : null}
      <div className="grid sm:grid-cols-2 gap-3"><Input label="Name" value={draft.name} onChange={(e) => setDraft({...draft,name:e.target.value})} required/><Input label="Slug" value={draft.slug} onChange={(e) => setDraft({...draft,slug:e.target.value})} required/><Input label="Tagline" value={draft.tagline} onChange={(e) => setDraft({...draft,tagline:e.target.value})} required/><Input label="Sort order" type="number" value={String(draft.sort_order)} onChange={(e) => setDraft({...draft,sort_order:Number(e.target.value)})}/></div>
      <label className="block space-y-1.5 text-sm font-medium">Story<textarea className={textareaClass} value={draft.story} onChange={(e) => setDraft({...draft,story:e.target.value})}/></label>
      <div className="grid sm:grid-cols-2 gap-3"><label className="space-y-1.5 block text-sm font-medium">Accent<select className={inputClass} value={draft.accent} onChange={(e) => setDraft({...draft,accent:e.target.value as Collection['accent']})}><option value="apricot">Apricot</option><option value="butter">Butter</option><option value="lilac">Lilac</option><option value="rose">Rose</option><option value="cocoa">Cocoa</option></select></label><Checkbox label="Active collection" checked={draft.is_active} onChange={(e) => setDraft({...draft,is_active:e.target.checked})}/></div>
      <label className="block text-sm font-medium space-y-2">Collection image<input type="file" accept="image/jpeg,image/png,image/webp,image/avif" onChange={(e) => setImageFile(e.target.files?.[0] || null)} className="block w-full text-sm text-ink-2"/></label>
      {imageFile ? <p className="text-xs text-ink-3">{imageFile.name} selected. Image is processed into three responsive WebP sizes.</p> : null}
      {activeId && collections.find((item) => item.id === activeId)?.image_path ? <p className="text-xs text-ink-2">Current image path: {collections.find((item) => item.id === activeId)?.image_path}</p> : null}
      <Button type="submit" loading={saving} icon={<Save size={16}/>}>Save collection</Button>
    </form>
  </div>;
}

export function AdminOrdersPage() {
  const client = getSupabaseBrowserClient();
  const { toast } = useToast();
  const [orders,setOrders] = useState<OrderRow[]>([]);
  const [items,setItems] = useState<OrderItemRow[]>([]);
  const [events,setEvents] = useState<PaymentEventRow[]>([]);
  const [selected,setSelected] = useState<OrderRow|null>(null);
  const [loading,setLoading] = useState(true);
  const load = useCallback(async () => {
    if (!client) { setLoading(false); return; }
    const [o,i,e] = await Promise.all([
      client.from('orders').select('*').order('created_at',{ascending:false}).limit(200),
      client.from('order_items').select('*').limit(1000),
      client.from('payment_events').select('*').order('received_at',{ascending:false}).limit(300),
    ]);
    const error=o.error||i.error||e.error;
    if(error) toast({title:'Orders could not be loaded',description:error.message,tone:'error'});
    setOrders((o.data||[]) as OrderRow[]);
    setItems((i.data||[]) as OrderItemRow[]);
    setEvents((e.data||[]) as PaymentEventRow[]);
    setLoading(false);
  },[client,toast]);
  useEffect(()=>{void load();},[load]);
  const currentItems = selected ? items.filter((item)=>item.order_id===selected.id):[];
  const relatedEvents = selected ? events.filter((event)=> {
    const payload = event.payload as Record<string, unknown>|null;
    return JSON.stringify(payload||{}).includes(selected.id) || JSON.stringify(payload||{}).includes(selected.order_number) ||
      event.event_id === selected.provider_payment_id || event.event_id === selected.provider_order_id;
  }):[];
  return <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_380px] gap-4">
    <section className={cardClass}><div className="flex items-center justify-between gap-3"><h3 className="font-semibold">Orders</h3><span className="text-xs text-ink-3">{orders.length} loaded</span></div>
      {loading ? <Skeleton className="h-32 w-full" rounded="lg"/> : null}
      <div className="mt-3 divide-y divide-line">{orders.map((order)=><button key={order.id} type="button" onClick={()=>setSelected(order)} className={'w-full text-left py-3 flex items-center justify-between gap-3 '+(selected?.id===order.id?'bg-page rounded-xl px-3':'')}><span className="min-w-0"><span className="block text-sm font-semibold">{order.order_number}</span><span className="block text-xs text-ink-3 mt-1">{new Date(order.created_at).toLocaleString()} · {order.provider||'Unknown provider'}</span></span><span className="text-right shrink-0"><span className="block font-mono text-sm">{money(order.total_cents)}</span><span className="block text-xs text-ink-3 capitalize mt-1">{order.status}</span></span></button>)}</div>
    </section>
    <aside className={cardClass+' h-fit space-y-3'}>{selected ? <>
      <div className="flex items-start justify-between gap-2"><div><p className="text-xs text-ink-3">Order detail</p><h3 className="font-semibold text-lg">{selected.order_number}</h3></div><TagPill>{selected.status}</TagPill></div>
      <p className="text-2xl font-semibold font-mono">{money(selected.total_cents)} <span className="text-xs font-sans text-ink-3">{selected.currency}</span></p>
      <div className="text-xs text-ink-2 space-y-1 break-all"><p>Customer: {selected.user_id}</p><p>Provider: {selected.provider||'—'}</p><p>Provider order: {selected.provider_order_id||'—'}</p><p>Payment ID: {selected.provider_payment_id||'—'}</p></div>
      <div className="border-t border-line pt-3"><p className="text-sm font-semibold">Items</p>{currentItems.length?currentItems.map((item)=><div key={item.id} className="py-2 border-b border-line text-sm flex justify-between gap-2"><span>{item.product_name}<span className="block text-xs text-ink-3">{item.sku}</span></span><span className="font-mono">{money(item.unit_price_cents)}</span></div>):<p className="text-sm text-ink-3 mt-2">No item rows loaded.</p>}</div>
      <div className="border-t border-line pt-3"><p className="text-sm font-semibold">Payment events</p>{relatedEvents.length?relatedEvents.map((event)=><div key={event.id} className="py-2 text-xs border-b border-line"><p className="font-medium">{event.provider} · {event.event_type}</p><p className="text-ink-3 break-all">{event.event_id}</p><p className="text-ink-3">{new Date(event.received_at).toLocaleString()}</p></div>):<p className="text-sm text-ink-3 mt-2">No matching event identifiers were found in the event payloads.</p>}</div>
      <div className="flex flex-wrap gap-2"><a className="inline-flex min-h-[40px] items-center gap-2 rounded-full border border-line px-3 text-xs font-medium" href="https://dashboard.razorpay.com/app/payments" target="_blank" rel="noreferrer">Razorpay dashboard <ExternalLink size={13}/></a><a className="inline-flex min-h-[40px] items-center gap-2 rounded-full border border-line px-3 text-xs font-medium" href="https://www.paypal.com/businessmanage/transactions" target="_blank" rel="noreferrer">PayPal dashboard <ExternalLink size={13}/></a></div>
      <p className="text-xs text-ink-3">Refunds are handled in the payment provider dashboard. This app does not issue manual refunds.</p>
    </> : <p className="text-sm text-ink-2">Choose an order to see its items, provider references and payment events.</p>}</aside>
  </div>;
}

export function AdminReviewsPage() {
  const client = getSupabaseBrowserClient();
  const { toast } = useToast();
  const [reviews,setReviews] = useState<ReviewRow[]>([]);
  const [loading,setLoading] = useState(true);
  const [busy,setBusy] = useState<string|null>(null);
  const load = useCallback(async()=>{
    if(!client){setLoading(false);return;}
    const {data,error}=await client.from('reviews').select('*').eq('status','pending').order('created_at',{ascending:true});
    if(error)toast({title:'Reviews could not be loaded',description:error.message,tone:'error'});
    const rows=(data||[]) as ReviewRow[];
    const productIds=[...new Set(rows.map((r)=>r.product_id))];
    const userIds=[...new Set(rows.map((r)=>r.user_id))];
    const [p,u]=await Promise.all([
      productIds.length?client.from('products').select('id,name').in('id',productIds):Promise.resolve({data:[],error:null}),
      userIds.length?client.from('profiles').select('id,display_name').in('id',userIds):Promise.resolve({data:[],error:null}),
    ]);
    const products=(p.data||[]) as Array<{id:string;name:string}>;
    const users=(u.data||[]) as Array<{id:string;display_name:string|null}>;
    setReviews(rows.map((row)=>({...row,productName:products.find((x)=>x.id===row.product_id)?.name||'Product unavailable',reviewerName:users.find((x)=>x.id===row.user_id)?.display_name||'Customer'})));
    setLoading(false);
  },[client,toast]);
  useEffect(()=>{void load();},[load]);
  const update = async(review:ReviewRow,status:'approved'|'rejected')=>{
    if(!client)return;
    setBusy(review.id);
    const before=reviews;
    setReviews((previous)=>previous.filter((item)=>item.id!==review.id));
    const {error}=await client.from('reviews').update({status}).eq('id',review.id);
    if(error){setReviews(before);toast({title:'Review was not updated',description:error.message,tone:'error'});}
    else toast({title:status==='approved'?'Review approved':'Review rejected',tone:'success'});
    setBusy(null);
  };
  return <div className="space-y-3">{loading?<Skeleton className="h-40" rounded="lg"/>:reviews.length===0?<Tile variant="white" padding="lg"><p className="text-sm text-ink-2">No reviews are waiting for approval.</p></Tile>:reviews.map((review)=><article key={review.id} className={cardClass}><div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="font-semibold">{review.productName}</h3><p className="text-xs text-ink-3 mt-1">By {review.reviewerName} · {new Date(review.created_at).toLocaleDateString()}</p></div><TagPill>{review.rating}/5</TagPill></div><p className="font-medium mt-3">{review.title||'Untitled review'}</p><p className="text-sm text-ink-2 mt-1 whitespace-pre-wrap">{review.body||'No written comment.'}</p><div className="flex gap-2 mt-4"><Button size="sm" loading={busy===review.id} onClick={()=>void update(review,'approved')}>Approve</Button><Button size="sm" variant="secondary" disabled={busy===review.id} onClick={()=>void update(review,'rejected')}>Reject</Button></div></article>)}</div>;
}

export function AdminInboxPage() {
  const client=getSupabaseBrowserClient();
  const {toast}=useToast();
  const [messages,setMessages]=useState<InboxMessage[]>([]);
  const [subscribers,setSubscribers]=useState<SubscriberRow[]>([]);
  const [tab,setTab]=useState<'messages'|'subscribers'>('messages');
  const [loading,setLoading]=useState(true);
  const load=useCallback(async()=>{
    if(!client){setLoading(false);return;}
    const [m,s]=await Promise.all([
      client.from('contact_messages').select('*').order('created_at',{ascending:false}).limit(500),
      client.from('newsletter_subscribers').select('*').order('created_at',{ascending:false}).limit(5000),
    ]);
    if(m.error||s.error)toast({title:'Inbox could not be loaded',description:(m.error||s.error)?.message,tone:'error'});
    setMessages((m.data||[]) as InboxMessage[]);
    setSubscribers((s.data||[]) as SubscriberRow[]);
    setLoading(false);
  },[client,toast]);
  useEffect(()=>{void load();},[load]);
  const exportCsv=(kind:'messages'|'subscribers')=>{
    const rows=kind==='messages'?messages:subscribers;
    const headers=kind==='messages'?['name','email','subject','message','handled','created_at']:['email','source','created_at'];
    const escape=(value:unknown)=>'"'+String(value??'').replace(/"/g,'""')+'"';
    const lines=[headers.join(','),...rows.map((row)=>headers.map((key)=>escape((row as unknown as Record<string,unknown>)[key])).join(','))];
    const blob=new Blob([lines.join('\r\n')],{type:'text/csv;charset=utf-8'});
    const url=URL.createObjectURL(blob);
    const anchor=document.createElement('a');
    anchor.href=url;anchor.download='kinvai-'+kind+'-'+new Date().toISOString().slice(0,10)+'.csv';
    document.body.appendChild(anchor);anchor.click();anchor.remove();URL.revokeObjectURL(url);
  };
  const toggleHandled=async(message:InboxMessage)=>{
    if(!client)return;
    setMessages((prev)=>prev.map((item)=>item.id===message.id?{...item,handled:!message.handled}:item));
    const {error}=await client.from('contact_messages').update({handled:!message.handled}).eq('id',message.id);
    if(error){setMessages((prev)=>prev.map((item)=>item.id===message.id?message:item));toast({title:'Message status was not saved',description:error.message,tone:'error'});}
  };
  return <div className="space-y-4"><div className="flex flex-wrap items-center gap-2"><button type="button" onClick={()=>setTab('messages')} className={'rounded-full px-4 min-h-[42px] text-sm '+(tab==='messages'?'bg-ink text-white':'bg-surface border border-line')}>Contact messages ({messages.length})</button><button type="button" onClick={()=>setTab('subscribers')} className={'rounded-full px-4 min-h-[42px] text-sm '+(tab==='subscribers'?'bg-ink text-white':'bg-surface border border-line')}>Newsletter ({subscribers.length})</button><Button size="sm" variant="secondary" onClick={()=>exportCsv(tab)} icon={<Download size={15}/>}>Export CSV</Button></div>
    {loading?<Skeleton className="h-40" rounded="lg"/>:tab==='messages'?messages.length?messages.map((message)=><article key={message.id} className={cardClass}><div className="flex flex-wrap justify-between gap-2"><div><h3 className="font-semibold">{message.name}</h3><a href={'mailto:'+message.email} className="text-sm text-ink-2 underline underline-offset-4">{message.email}</a></div><Checkbox label="Handled" checked={message.handled} onChange={()=>void toggleHandled(message)}/></div><p className="font-medium text-sm mt-3">{message.subject||'Contact message'}</p><p className="text-sm text-ink-2 whitespace-pre-wrap mt-2">{message.message}</p><p className="text-xs text-ink-3 mt-3">{new Date(message.created_at).toLocaleString()}</p></article>):<Tile variant="white" padding="lg"><p className="text-sm text-ink-2">No contact messages yet.</p></Tile>:subscribers.length?<div className={cardClass+' divide-y divide-line'}>{subscribers.map((item)=><div key={item.id} className="py-3 flex items-center justify-between gap-3"><div className="min-w-0"><a href={'mailto:'+item.email} className="text-sm font-medium underline underline-offset-4 break-all">{item.email}</a><p className="text-xs text-ink-3 mt-1">{item.source||'Website'} · {new Date(item.created_at).toLocaleDateString()}</p></div><Mail size={17} className="text-ink-3 shrink-0"/></div>)}</div>:<Tile variant="white" padding="lg"><p className="text-sm text-ink-2">No newsletter subscribers yet.</p></Tile>}
  </div>;
}

export function AdminSettingsPage() {
  const client=getSupabaseBrowserClient();
  const {toast}=useToast();
  const [announcement,setAnnouncement]=useState('');
  const [announcementEnabled,setAnnouncementEnabled]=useState(false);
  const [saving,setSaving]=useState(false);
  const [checks,setChecks]=useState<Array<{label:string;ok:boolean;detail:string}>>([]);
  const [checking,setChecking]=useState(false);
  const [autoSet,setAutoSet]=useState(false);
  useEffect(()=>{
    if(!client)return;
    let active=true;
    Promise.all([
      client.from('site_settings').select('value').eq('key','announcement').maybeSingle(),
      client.from('site_settings').select('value').eq('key','admin_auto_set_generated_covers').maybeSingle(),
    ]).then(([a,s])=>{
      if(!active)return;
      const value=a.data?.value as {enabled?:boolean;message?:string;text?:string}|null;
      setAnnouncement(value?.message||value?.text||'');
      setAnnouncementEnabled(Boolean(value?.enabled));
      const pref=s.data?.value as {enabled?:boolean}|boolean|null;
      setAutoSet(typeof pref==='boolean'?pref:Boolean(pref?.enabled));
    });
    return ()=>{active=false;};
  },[client]);
  const saveAnnouncement=async(event:FormEvent)=>{
    event.preventDefault();
    if(!client)return;
    const parsed=z.object({message:z.string().trim().max(180)}).safeParse({message:announcement});
    if(!parsed.success){toast({title:'Announcement text is too long',tone:'error'});return;}
    setSaving(true);
    const {error}=await client.from('site_settings').upsert({key:'announcement',value:{enabled:announcementEnabled,message:parsed.data.message},is_public:true});
    setSaving(false);
    if(error)toast({title:'Announcement could not be saved',description:error.message,tone:'error'});
    else toast({title:'Announcement updated',tone:'success'});
  };
  const saveAutoSet=async(enabled:boolean)=>{
    if(!client)return;
    const before=autoSet;setAutoSet(enabled);
    const {error}=await client.from('site_settings').upsert({key:'admin_auto_set_generated_covers',value:{enabled},is_public:false});
    if(error){setAutoSet(before);toast({title:'Image preference was not saved',description:error.message,tone:'error'});}
  };
  const runChecks=async()=>{
    if(!client)return;
    setChecking(true);
    const [p,f,m,flags]=await Promise.all([
      client.from('products').select('id,name,status,cover_path,seo_title,seo_description').eq('status','published'),
      client.from('product_files').select('product_id').eq('is_active',true),
      client.from('product_media').select('product_id,storage_path,kind,alt'),
      Promise.resolve(getPublicConfig().flags),
    ]);
    const issues=(p.error||f.error||m.error)?.message;
    if(issues){toast({title:'Launch checks could not finish',description:issues,tone:'error'});setChecking(false);return;}
    const products=(p.data||[]) as Array<{id:string;name:string;status:string;cover_path:string|null;seo_title:string|null;seo_description:string|null}>;
    const activeProductFiles=new Set((f.data||[]).map((row)=>row.product_id));
    const coverRows=(m.data||[]) as Array<{product_id:string;storage_path:string;kind:string;alt:string|null}>;
    const noFile=products.filter((item)=>!activeProductFiles.has(item.id));
    const noCoverAlt=products.filter((item)=>!item.cover_path||!coverRows.some((media)=>media.product_id===item.id&&media.storage_path===item.cover_path&&Boolean(media.alt?.trim())));
    const noSeo=products.filter((item)=>!item.seo_title?.trim()||!item.seo_description?.trim());
    setChecks([
      {label:'Every published product has an active file',ok:noFile.length===0,detail:noFile.length?noFile.map((x)=>x.name).join(', '):products.length+' published products checked'},
      {label:'Every published product has a cover with alt text',ok:noCoverAlt.length===0,detail:noCoverAlt.length?noCoverAlt.map((x)=>x.name).join(', '):'All published covers include alt text'},
      {label:'Every published product has SEO title and description',ok:noSeo.length===0,detail:noSeo.length?noSeo.map((x)=>x.name).join(', '):'SEO fields are present'},
      {label:'At least one payment provider is configured',ok:flags.razorpay||flags.paypal,detail:[flags.razorpay?'Razorpay enabled':'Razorpay off',flags.paypal?'PayPal enabled':'PayPal off'].join(' · ')},
      {label:'Development seed fallback is disabled',ok:!flags.allowSeedFallback,detail:flags.allowSeedFallback?'ALLOW_SEED_FALLBACK is still enabled':'Preview fallback is disabled'},
    ]);
    setChecking(false);
  };
  return <div className="space-y-5">
    <form className={cardClass+' space-y-3'} onSubmit={(event)=>void saveAnnouncement(event)}><div><h3 className="font-semibold">Announcement bar</h3><p className="text-sm text-ink-2 mt-1">Shown across the storefront when enabled.</p></div><label className="block space-y-1.5 text-sm font-medium">Announcement text<textarea className={textareaClass} maxLength={180} value={announcement} onChange={(event)=>setAnnouncement(event.target.value)}/><span className="block text-xs text-ink-3 text-right">{announcement.length}/180</span></label><Checkbox label="Show announcement bar" checked={announcementEnabled} onChange={(event)=>setAnnouncementEnabled(event.target.checked)}/><Button type="submit" loading={saving}>Save announcement</Button></form>
    <section className={cardClass+' space-y-3'}><div><h3 className="font-semibold">Image generation preference</h3><p className="text-sm text-ink-2 mt-1">Bulk generated covers go straight to the live cover only when this is enabled.</p></div><Checkbox label="Auto-set generated covers" checked={autoSet} onChange={(event)=>void saveAutoSet(event.target.checked)}/></section>
    <section className={cardClass+' space-y-3'}><div className="flex flex-wrap justify-between items-center gap-3"><div><h3 className="font-semibold">Launch checklist</h3><p className="text-sm text-ink-2 mt-1">Checks run against current RLS-visible catalogue and server-injected flags.</p></div><Button onClick={()=>void runChecks()} loading={checking} icon={<ShieldCheck size={17}/>}>Run live checks</Button></div>
      {checks.length?checks.map((check)=><div key={check.label} className="border-t border-line pt-3 flex items-start gap-3"><span className={'mt-0.5 w-5 h-5 rounded-full inline-flex items-center justify-center text-xs '+(check.ok?'bg-[#E6F2EB] text-[#1E7A4F]':'bg-[#F8E7E7] text-[#9F2626]')}>{check.ok?'✓':'!'}</span><div className="min-w-0"><p className="text-sm font-medium">{check.label}</p><p className="text-xs text-ink-2 mt-1 break-words">{check.detail}</p></div></div>):<p className="text-sm text-ink-2">No checks have run yet.</p>}
    </section>
  </div>;
}

import { useMemo } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { BarChart3, Boxes, ClipboardList, Image, Inbox, Layers3, LogOut, MessageSquare, Settings, ShieldCheck, Star } from 'lucide-react';
import { Skeleton } from '../components/primitives';
import { useAuth } from '../lib/auth/AuthProvider';
import { usePageMeta } from '../lib/seo/usePageMeta';
import { NotFoundPage } from './NotFoundPage';
import {
  AdminOverviewPage,
  AdminCollectionsPage,
  AdminOrdersPage,
  AdminReviewsPage,
  AdminInboxPage,
  AdminSettingsPage,
} from './admin/AdminOperationsPage';
import { AdminImagesPage, AdminProductsPage } from './admin/AdminProductsPage';

const NAV = [
  { path:'/admin', label:'Overview', icon:BarChart3, exact:true },
  { path:'/admin/products', label:'Products', icon:Boxes },
  { path:'/admin/images', label:'Image Studio', icon:Image },
  { path:'/admin/collections', label:'Collections', icon:Layers3 },
  { path:'/admin/orders', label:'Orders', icon:ClipboardList },
  { path:'/admin/reviews', label:'Reviews', icon:Star },
  { path:'/admin/inbox', label:'Inbox', icon:Inbox },
  { path:'/admin/settings', label:'Settings', icon:Settings },
];

const TITLES: Record<string,string> = {
  '/admin':'Overview',
  '/admin/products':'Products',
  '/admin/images':'Image Studio',
  '/admin/collections':'Collections',
  '/admin/orders':'Orders',
  '/admin/reviews':'Reviews',
  '/admin/inbox':'Inbox',
  '/admin/settings':'Settings',
};

export function AdminShellPage() {
  usePageMeta({ title:'Owner workspace — Kinvai', description:'Private owner administration for Kinvai.', noindex:true });
  const { pathname } = useLocation();
  const { user, isAdmin, loading, signOut } = useAuth();
  const path = pathname.replace(/\/+$/,'') || '/admin';
  const title = TITLES[path] || 'Not found';
  const nav = useMemo(()=>NAV,[ ]);

  if (loading) return <div className="kv-container py-8 max-w-6xl space-y-4" aria-busy="true"><Skeleton className="h-12 w-56" rounded="pill"/><Skeleton className="h-20 w-full" rounded="lg"/><Skeleton className="h-64 w-full" rounded="lg"/></div>;
  if (!user || !isAdmin) return <NotFoundPage />;

  let page = null;
  switch (path) {
    case '/admin': page=<AdminOverviewPage/>; break;
    case '/admin/products': page=<AdminProductsPage/>; break;
    case '/admin/images': page=<AdminImagesPage/>; break;
    case '/admin/collections': page=<AdminCollectionsPage/>; break;
    case '/admin/orders': page=<AdminOrdersPage/>; break;
    case '/admin/reviews': page=<AdminReviewsPage/>; break;
    case '/admin/inbox': page=<AdminInboxPage/>; break;
    case '/admin/settings': page=<AdminSettingsPage/>; break;
    default: return <NotFoundPage />;
  }

  return <div className="min-h-[100dvh] bg-page">
    <header className="sticky top-0 z-30 border-b border-line bg-page/95 backdrop-blur-md">
      <div className="kv-container max-w-[1480px] py-3 flex items-center justify-between gap-3">
        <div className="min-w-0"><Link to="/" className="font-semibold tracking-tight text-xl">kinvai<span className="text-brand">.</span></Link><p className="text-[11px] uppercase tracking-[0.1em] text-ink-3 mt-0.5">Owner workspace</p></div>
        <div className="flex items-center gap-2"><span className="hidden sm:block max-w-[220px] truncate text-xs text-ink-3">{user.email}</span><button type="button" onClick={()=>void signOut()} className="inline-flex items-center gap-2 min-h-[44px] rounded-full border border-line bg-surface px-3 sm:px-4 text-sm hover:bg-stone" aria-label="Sign out of owner workspace"><LogOut size={16}/><span className="hidden sm:inline">Sign out</span></button></div>
      </div>
      <nav aria-label="Owner navigation" className="kv-container max-w-[1480px] pb-3">
        <div className="flex gap-2 overflow-x-auto overscroll-x-contain pb-1 scrollbar-hide">
          {nav.map((item)=>{
            const Icon=item.icon;
            return <NavLink key={item.path} to={item.path} end={item.exact} className={({isActive})=>'inline-flex items-center gap-2 min-h-[44px] shrink-0 rounded-full px-4 text-sm font-medium transition-colors '+(isActive?'bg-ink text-white':'border border-line bg-surface text-ink-2 hover:text-ink hover:bg-stone')}>
              <Icon size={16} strokeWidth={1.8}/>{item.label}
            </NavLink>;
          })}
        </div>
      </nav>
    </header>
    <main className="kv-container max-w-[1480px] py-6 sm:py-9 pb-[calc(2rem+env(safe-area-inset-bottom,0px))]">
      <div className="mb-5"><p className="text-xs uppercase tracking-[0.1em] text-ink-3">Kinvai / Owner</p><h1 className="text-3xl sm:text-4xl font-semibold tracking-tight text-ink mt-1">{title}</h1></div>
      {page}
    </main>
  </div>;
}

/**
 * Kinvai catalog seed — Run the Shop.
 * Run with: npx tsx scripts/seed-production-catalog.ts
 * Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
 * Uploads only files present in the local catalog-build product folders.
 */
import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
const supabase = createClient(url, key, { auth: { persistSession: false } });
const collection = {slug:"run-the-shop",name:"Run the Shop",tagline:"Operating systems for independent sellers.",story:"Practical operating tools for launching, pricing and running digital and physical product businesses.",accent:"apricot",sort_order:1,is_active:true};
const products = [
{slug:"marketplace-launch-system",sku:"KV-RTS-001",name:"Marketplace Launch System",tagline:"A structured launch from idea to first listing.",short_description:"A practical launch planner, readiness scoring, operating workbook and 90-day playbook.",description:"Plan a marketplace launch with a readiness scorecard, milestones, operating workbook and actionable playbook.",price_cents:4900,featured_rank:1,tags:["launch","marketplace","planning"],file_formats:["HTML","XLSX","PDF","ZIP"],includes:["Interactive offline launch planner","6-tab Excel workbook","90-day playbook","Launch SOPs"],audience:["Marketplace sellers","Independent founders"],requirements:"Modern browser and Microsoft Excel or compatible spreadsheet software.",first_hour:["Complete the readiness assessment","Choose the launch channel","Set a 90-day milestone"],version:"1.0",seo_title:"Marketplace Launch System | Kinvai",seo_description:"Launch planning tools, milestones and a practical marketplace playbook."},
{slug:"pricing-margin-and-profit-calculator",sku:"KV-RTS-002",name:"Pricing Margin and Profit Calculator",tagline:"Price with a clear view of contribution.",short_description:"Model fees, discounts, bundles and break-even scenarios.",description:"Interactive pricing model and workbook for pricing decisions, margin and break-even analysis.",price_cents:2900,featured_rank:2,tags:["pricing","finance","margin"],file_formats:["HTML","XLSX","PDF","ZIP"],includes:["Interactive pricing simulator","5-tab workbook","Pricing architecture guide"],audience:["Small business owners","Product sellers"],requirements:"Modern browser and Excel-compatible spreadsheet.",first_hour:["Enter unit cost","Set target margin","Test discount scenarios"],version:"1.0",seo_title:"Pricing Margin Calculator | Kinvai",seo_description:"Evaluate pricing, discounts, contribution and break-even."},
{slug:"seller-operations-command-center",sku:"KV-RTS-003",name:"Seller Operations Command Center",tagline:"Know what to reorder before it becomes urgent.",short_description:"Inventory runway, reorder planning and operating scripts.",description:"A seller operations system for stock cover, lead time, reorder alerts and customer support.",price_cents:4400,featured_rank:5,tags:["operations","inventory","seller"],file_formats:["HTML","XLSX","PDF","ZIP"],includes:["Inventory runway dashboard","6-tab workbook","Operations runbook","25 support scripts"],audience:["Marketplace sellers","Small teams"],requirements:"Modern browser and Excel-compatible spreadsheet.",first_hour:["Load SKU inventory","Set lead times","Review reorder flags"],version:"1.0",seo_title:"Seller Operations Command Center | Kinvai",seo_description:"Inventory runway, reorder alerts and seller operating scripts."},
{slug:"startup-saas-financial-model-os",sku:"KV-RTS-004",name:"Startup & SaaS Financial Model OS",tagline:"A 24-month view of growth and cash.",short_description:"Model subscriptions, churn, hiring, burn and runway.",description:"A structured 24-month SaaS financial planning system with recurring revenue, churn, hiring, cash and runway assumptions.",price_cents:5900,featured_rank:9,tags:["startup","saas","finance"],file_formats:["HTML","XLSX","PDF","ZIP"],includes:["Interactive 24-month model","7-tab workbook","Founder finance playbook"],audience:["SaaS founders","Early-stage startups"],requirements:"Modern browser and Excel-compatible spreadsheet.",first_hour:["Set starting subscribers","Enter ARPU and churn","Review cash runway"],version:"1.0",seo_title:"SaaS Financial Model OS | Kinvai",seo_description:"A 24-month SaaS model for revenue, hiring, burn and runway."}
];
const root=path.resolve("catalog-build");
const collectionRow=await supabase.from("collections").select("id").eq("slug",collection.slug).maybeSingle();
if(collectionRow.error) throw collectionRow.error;
let collectionId=collectionRow.data?.id;
if(collectionId){const u=await supabase.from("collections").update(collection).eq("id",collectionId);if(u.error)throw u.error;}
else {const i=await supabase.from("collections").insert(collection).select("id").single();if(i.error)throw i.error;collectionId=i.data.id;}
for(const p of products){
 const existing=await supabase.from("products").select("id").eq("slug",p.slug).maybeSingle();if(existing.error)throw existing.error;
 const payload={...p,collection_id:collectionId,currency:"USD",status:"draft",is_featured:true,cover_path:null,published_at:null};
 let id=existing.data?.id;
 if(id){const u=await supabase.from("products").update(payload).eq("id",id);if(u.error)throw u.error;}
 else {const i=await supabase.from("products").insert(payload).select("id").single();if(i.error)throw i.error;id=i.data.id;}
 const dir=path.join(root,p.slug);
 let entries=[];try{entries=await import("node:fs/promises").then(fs=>fs.readdir(dir));}catch{}
 for(const name of entries.filter(n=>n!=="README.md"&&!n.startsWith("."))){
   const full=path.join(dir,name);const s=await stat(full);if(!s.isFile())continue;
   const bytes=await readFile(full);const checksum=createHash("sha256").update(bytes).digest("hex");
   const storagePath=`products/${id}/v1.0/${name}`;
   const up=await supabase.storage.from("product-files").upload(storagePath,bytes,{contentType:name.endsWith(".pdf")?"application/pdf":name.endsWith(".xlsx")?"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":name.endsWith(".html")?"text/html":"application/zip",upsert:true});
   if(up.error)throw new Error(`Upload ${storagePath}: ${up.error.message}`);
   const row={product_id:id,storage_path:storagePath,file_name:name,mime_type:up.data?.metadata?.mimetype??null,size_bytes:bytes.length,version:"1.0",checksum_sha256:checksum,is_active:true};
   const prior=await supabase.from("product_files").select("id").eq("product_id",id).eq("storage_path",storagePath).maybeSingle();if(prior.error)throw prior.error;
   if(prior.data){const u=await supabase.from("product_files").update(row).eq("id",prior.data.id);if(u.error)throw u.error;}else{const i=await supabase.from("product_files").insert(row);if(i.error)throw i.error;}
 }
 console.log("Prepared product",p.slug,id);
}
console.log("Catalog seeded as draft records; publication requires asset verification.");

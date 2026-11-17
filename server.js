import "dotenv/config";
import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import Database from "better-sqlite3";
import cookieParser from "cookie-parser";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT || 4242);
const APP_URL = (process.env.APP_URL || `http://localhost:${PORT}`).replace(/\/$/, "");
const SECRET = process.env.PAYSTACK_SECRET_KEY || "";
const PLAN_CODE = process.env.PAYSTACK_MONTHLY_PLAN_CODE || "";
const COOKIE = "clipforge_session";
const db = new Database(process.env.DB_FILE || path.join(root, "data", "clipforge.sqlite"));
db.pragma("journal_mode = WAL");
db.exec(`
CREATE TABLE IF NOT EXISTS pending(reference TEXT PRIMARY KEY,email TEXT NOT NULL,amount INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS members(email TEXT PRIMARY KEY,status TEXT NOT NULL,until TEXT,updated TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,email TEXT NOT NULL,expires TEXT NOT NULL);
`);
const q = {
 pending: db.prepare("INSERT INTO pending VALUES(?,?,?)"),
 getPending: db.prepare("SELECT * FROM pending WHERE reference=?"),
 member: db.prepare("SELECT * FROM members WHERE email=?"),
 saveMember: db.prepare("INSERT INTO members VALUES(?,?,?,?) ON CONFLICT(email) DO UPDATE SET status=excluded.status,until=excluded.until,updated=excluded.updated"),
 session: db.prepare("INSERT INTO sessions VALUES(?,?,?)"),
 getSession: db.prepare("SELECT email FROM sessions WHERE token_hash=? AND expires>?"),
 delSession: db.prepare("DELETE FROM sessions WHERE token_hash=?")
};
const hash = s => crypto.createHash("sha256").update(s).digest("hex");
const nextMonth = () => { const d = new Date(); d.setUTCMonth(d.getUTCMonth()+1); return d.toISOString(); };
async function paystack(endpoint, body) {
  const r = await fetch("https://api.paystack.co"+endpoint, {
    method: body ? "POST" : "GET",
    headers: { Authorization: "Bearer "+SECRET, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined
  });
  const j = await r.json().catch(()=>({}));
  if (!r.ok || !j.status) throw new Error(j.message || "Paystack request failed");
  return j.data;
}
function setMember(email, until) {
  q.saveMember.run(email,"active",until || nextMonth(),new Date().toISOString());
}
function grantSession(res,email) {
  const token = crypto.randomBytes(32).toString("base64url");
  q.session.run(hash(token),email,new Date(Date.now()+365*864e5).toISOString());
  res.cookie(COOKIE,token,{httpOnly:true,secure:APP_URL.startsWith("https://"),sameSite:"lax",path:"/",maxAge:365*864e5});
}

// Raw body must be retained for Paystack's webhook signature check.
app.post("/api/paystack/webhook",express.raw({type:"application/json"}),async(req,res)=>{
  if(!SECRET) return res.sendStatus(503);
  const sig=req.get("x-paystack-signature")||"";
  const expected=crypto.createHmac("sha512",SECRET).update(req.body).digest("hex");
  const a=Buffer.from(sig,"hex"), b=Buffer.from(expected,"hex");
  if(a.length!==b.length || !crypto.timingSafeEqual(a,b)) return res.sendStatus(401);
  let event; try { event=JSON.parse(req.body.toString("utf8")); } catch { return res.sendStatus(400); }
  try {
    if(event.event==="charge.success" && event.data?.reference) {
      const p=q.getPending.get(event.data.reference);
      const v=await paystack("/transaction/verify/"+encodeURIComponent(event.data.reference));
      if(p && v.status==="success" && v.currency==="USD" && v.amount===79900 && v.customer?.email?.toLowerCase()===p.email) setMember(p.email,v.subscription?.next_payment_date);
    }
    if(event.event==="invoice.payment_failed") {
      const email=event.data?.customer?.email?.toLowerCase();
      if(email && q.member.get(email)) q.saveMember.run(email,"past_due",q.member.get(email).until,new Date().toISOString());
    }
    if(event.event==="subscription.disable") {
      const email=event.data?.customer?.email?.toLowerCase();
      if(email && q.member.get(email)) q.saveMember.run(email,"disabled",new Date().toISOString(),new Date().toISOString());
    }
    res.sendStatus(200);
  } catch(e) { console.error("Webhook:",e.message); res.sendStatus(500); }
});

app.use(helmet({contentSecurityPolicy:false}));
app.use(express.json({limit:"20kb"}));
app.use(cookieParser());
app.use("/api/",rateLimit({windowMs:60000,limit:40,standardHeaders:true,legacyHeaders:false}));
app.get("/api/health",(_req,res)=>res.json({ok:true,service:"clipforge-academy"}));

app.post("/api/checkout",async(req,res)=>{
  if(!SECRET || !PLAN_CODE) return res.status(503).json({error:"Paystack has not been configured on the server."});
  const email=String(req.body?.email||"").trim().toLowerCase();
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({error:"Enter a valid email address."});
  const reference="cf_"+crypto.randomUUID().replaceAll("-","");
  try {
    q.pending.run(reference,email,79900);
    const data=await paystack("/transaction/initialize",{email,amount:79900,currency:"USD",plan:PLAN_CODE,reference,callback_url:APP_URL+"/paystack/callback",metadata:{platform:"Clipforge Academy"}});
    res.json({authorization_url:data.authorization_url});
  } catch(e) { console.error("Checkout:",e.message); res.status(502).json({error:"Could not start Paystack checkout. Check your plan and currency settings."}); }
});

app.get("/paystack/callback",async(req,res)=>{
  const ref=String(req.query.reference||"");
  const p=q.getPending.get(ref);
  if(!SECRET || !p) return res.redirect("/?payment=failed#plans");
  try {
    const v=await paystack("/transaction/verify/"+encodeURIComponent(ref));
    if(v.status!=="success" || v.reference!==ref || v.currency!=="USD" || v.amount!==p.amount || v.customer?.email?.toLowerCase()!==p.email) return res.redirect("/?payment=failed#plans");
    setMember(p.email,v.subscription?.next_payment_date);
    grantSession(res,p.email);
    res.redirect("/?payment=success#plans");
  } catch(e) { console.error("Verify:",e.message); res.redirect("/?payment=failed#plans"); }
});

app.get("/api/me",(req,res)=>{
  const token=req.cookies?.[COOKIE];
  const session=token && q.getSession.get(hash(token),new Date().toISOString());
  if(!session) return res.json({authenticated:false,active:false});
  const m=q.member.get(session.email);
  const active=!!m && m.status==="active" && (!m.until || Date.parse(m.until)>Date.now());
  res.json({authenticated:true,active,email:session.email,plan:active?"monthly":null,access_until:active?m.until:null});
});
app.post("/api/logout",(req,res)=>{
  const token=req.cookies?.[COOKIE]; if(token) q.delSession.run(hash(token));
  res.clearCookie(COOKIE,{httpOnly:true,secure:APP_URL.startsWith("https://"),sameSite:"lax",path:"/"});
  res.json({ok:true});
});
app.use(express.static(path.join(root,"public")));
app.get(/.*/,(req,res)=>res.sendFile(path.join(root,"public","index.html")));
app.listen(PORT,()=>console.log(`Clipforge Academy listening on ${PORT}`));

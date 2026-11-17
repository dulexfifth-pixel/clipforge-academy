import "dotenv/config";
const secret = process.env.PAYSTACK_SECRET_KEY;
if (!secret) throw new Error("Set PAYSTACK_SECRET_KEY in your private environment first.");
const response = await fetch("https://api.paystack.co/plan", {
  method: "POST",
  headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
  body: JSON.stringify({ name: "Clipforge Academy Monthly USD", amount: 799, currency: "USD", interval: "monthly", description: "Clipforge Academy monthly access" })
});
const result = await response.json();
if (!response.ok || !result.status) throw new Error(result.message || "Paystack plan creation failed");
console.log(`PAYSTACK_MONTHLY_PLAN_CODE=${result.data.plan_code}`);

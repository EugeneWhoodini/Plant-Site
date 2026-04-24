import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).send("Method Not Allowed");
  }

  const event = req.body;

  // ✅ ONLY RUN AFTER PAYMENT SUCCESS
  if (event.type === "checkout.session.completed") {
    const session = event.data.object;

    console.log("✅ Payment success:", session);

    // 👇 Extract useful info
    const email = session.customer_details?.email;
    const name = session.customer_details?.name;
    const amount = session.amount_total / 100;

    // 🔥 SEND EMAIL USING EMAILJS (YOUR EXISTING SYSTEM)
await fetch("https://api.emailjs.com/api/v1.0/email/send", {
  method: "POST",
  headers: {
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    service_id: "service_r88ycqr",
    template_id: "template_qsa5879",
    user_id: "mYsVEfGV4fqvvVSXu",
    template_params: {
      customer_name: name,
      customer_email: email,
      total: amount
    }
  })
});
  }

  res.status(200).json({ received: true });
}
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).send("Method Not Allowed");
  }

  const event = req.body;

  // 👇 THIS RUNS AFTER PAYMENT SUCCESS
  if (event.type === "checkout.session.completed") {
    const session = event.data.object;

    console.log("✅ Payment successful:", session);

    // 🔥 SEND YOURSELF EMAIL HERE
    // (we’ll plug EmailJS or another service next)
  }

  res.status(200).json({ received: true });
}
# PLANTOVIA

Aquarium plant storefront for Vercel, Supabase, and EmailJS.

## Update order

1. Run the complete `supabase-schema.sql` file in the Supabase SQL Editor.
2. Complete the EmailJS steps in `EMAILJS-SETUP.md` and update the two template IDs in `config.js`.
3. Upload every file and folder in this package to the GitHub repository.
4. Wait for Vercel to show the new deployment as Ready.
5. Test one small order using a customer account, then confirm its delivery from the account page.

Running the SQL does not remove catalogue plants, uploaded plant images, customer accounts, or orders. It adds the account profiles and blocking rules, secure order functions, admin access rules, unique order numbers, and delivery confirmation proof.

## Admin

Open `/admin` or `/admin.html` and sign in as `e.koblitsky@gmail.com`. The internal admin navigation is available on every admin screen:

- **Processing Orders** searches active orders and filters by customer phone, total price, or a calendar date range. Results are paginated 40 at a time. Unpaid orders are red and paid orders awaiting delivery are yellow.
- **Finalized Orders** contains delivered and cancelled orders. Finalized orders are green. Marking an order Delivered or Cancelled moves it here immediately.
- **Plant Catalogue** manages plants, images, categories, featured items, storefront order, pricing, stock, and delivery settings.
- **Accounts** lists registered Supabase customers. The admin can block or unblock non-admin accounts.

A blocked account is signed out during its next site check and cannot read account history, place orders, or sign delivery confirmation. The public storefront remains viewable because it is intentionally a public shop. Only the authorized Supabase admin account can list all profiles, read all orders, change order status, or edit catalogue data.
## Order security

- Customers must use a signed-in Supabase account to place and review orders.
- Supabase generates the unique order number.
- Supabase recalculates prices, HST, and delivery fees from live database values.
- Customers can read only their own orders.
- Customers cannot directly rewrite order totals, payment status, or fulfillment status.
- Delivery confirmation can be signed only once and includes a server timestamp and proof hash.
- Vercel security headers block framing, unsafe object content, unnecessary device permissions, and unapproved network connections.

An electronic confirmation is useful delivery evidence, but no website feature can guarantee the result of every payment dispute or legal complaint. Keep your courier records and the confirmation email as supporting documentation.

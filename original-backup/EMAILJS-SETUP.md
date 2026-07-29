# EmailJS setup for Plantovia

The site already contains your EmailJS public key, service ID, and existing new-order template ID. You only need one additional template for customer receipts and delivery confirmations.

## 1. Check the email service

In EmailJS, open **Email Services** and confirm that service `service_r88ycqr` sends from the Plantovia mailbox. Reconnect it if EmailJS shows an error.

## 2. Check the admin order template

Open template `template_qsa5879`.

- **To Email:** `plantovia.shop@gmail.com`
- **Subject:** `{{email_subject}}`
- **Reply-To:** `{{customer_email}}`

Suggested body:

```text
{{email_heading}}

{{email_intro}}

Order: {{order_id}}
Date: {{order_date}}
Customer: {{customer_name}}
Email: {{customer_email}}
Phone: {{customer_phone}}
Delivery address: {{customer_address}}

{{order_details}}

Subtotal: ${{subtotal}} CAD
HST: ${{tax}} CAD
Delivery: ${{shipping}} CAD
Total: ${{total}} CAD
Payment: {{payment_status}} by {{payment_method}}
```

## 3. Create one transactional template

Create a new template named **Plantovia receipt and delivery proof**.

- **To Email:** `{{to_email}}`
- **Subject:** `{{email_subject}}`
- **Reply-To:** `plantovia.shop@gmail.com`

Suggested body:

```text
{{email_heading}}

{{email_intro}}

Order: {{order_id}}
Date: {{order_date}}
Customer: {{customer_name}}

{{order_details}}

Subtotal: ${{subtotal}} CAD
HST: ${{tax}} CAD
Delivery: ${{shipping}} CAD
Total: ${{total}} CAD
Payment status: {{payment_status}}

{{#is_order_receipt}}
Send the exact total by e-transfer to {{e_transfer_email}} and include {{order_id}} in the message.
Your order is also saved in your Plantovia account.
{{/is_order_receipt}}

{{#is_delivery_confirmation}}
Electronic signature: {{signature}}
Signed at: {{signed_at}}
Signer account: {{signed_by_email}}
Statement: {{confirmation_statement}}
Proof hash: {{proof_hash}}
{{/is_delivery_confirmation}}
```

Copy that new template ID into both of these fields in `config.js`:

```js
customerReceiptTemplateId: "YOUR_NEW_TEMPLATE_ID",
deliveryConfirmationTemplateId: "YOUR_NEW_TEMPLATE_ID"
```

Using the same ID twice keeps the setup to two EmailJS templates total: the existing admin template and this new transactional template.

## 4. Protect the EmailJS account

- Turn on MFA in EmailJS account security.
- If your EmailJS plan includes **Domains**, allow only your Vercel production address and later your custom domain.
- Keep the template variables in double braces. Do not use triple braces for customer text.
- Send a test from each template and check spam once.

## 5. Final test

1. Create or use a non-admin customer account.
2. Place a one-plant test order.
3. Confirm that the admin order email reaches `plantovia.shop@gmail.com`.
4. Confirm that the customer receipt reaches the signed-in customer's email.
5. Open the customer account and sign **Confirm Order Received**.
6. Confirm that the delivery proof email reaches `plantovia.shop@gmail.com` and appears in the admin order desk.

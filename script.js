function safeJsonParse(key, fallback = null) {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw);
  } catch (error) {
    console.error(`Plantovia: corrupted localStorage key "${key}", resetting it.`, error);
    try {
      localStorage.removeItem(key);
    } catch (removeError) {
      console.error(`Plantovia: could not clear localStorage key "${key}".`, removeError);
    }
    return fallback;
  }
}

function sanitizeCartItems(items) {
  if (!Array.isArray(items)) return [];

  return items
    .filter(item => item && typeof item === "object" && item.id)
    .map(item => {
      const roundedQuantity = Math.round(Number(item.quantity));
      const safeQuantity = Number.isFinite(roundedQuantity) ? Math.min(99, Math.max(1, roundedQuantity)) : 1;
      return { ...item, quantity: safeQuantity };
    });
}

let cart = sanitizeCartItems(safeJsonParse("cart", []));
localStorage.setItem("cart", JSON.stringify(cart));

const TAX_RATE = 0.13;
const SHIPPING_COST = 5.00;
const PAGE_SIZE = 8;
const PLANT_STORAGE_KEY = "plantCatalog";
const FEATURED_STORAGE_KEY = "featuredPlantIds";
const CATEGORY_STORAGE_KEY = "plantCategories";
const SITE_SETTINGS_STORAGE_KEY = "siteSettings";
const PURCHASE_HISTORY_STORAGE_KEY = "purchaseHistory";
const SUPABASE_PLACEHOLDER_URL = "PASTE_SUPABASE_PROJECT_URL_HERE";
const SUPABASE_PLACEHOLDER_KEY = "PASTE_SUPABASE_ANON_KEY_HERE";
const DEFAULT_SITE_SETTINGS = {
  freeMississaugaShippingThreshold: 50,
  mississaugaDeliveryFee: SHIPPING_COST
};
const DEFAULT_CATEGORIES = [
  "Budget friendly",
  "Easy care",
  "Intermediate",
  "Advanced",
  "Low light",
  "Color plants",
  "Carpeting",
  "Epiphytes",
  "Floating plants"
];

let runtimePlants = null;
let runtimeFeaturedIds = null;
let runtimeCategories = null;
let runtimeSiteSettings = null;
let supabaseClient = null;
let backendDataPromise = null;
let passwordRecoveryPending = false;
let activeCategoryFilter = "all";
let activeCatalogueSearch = "";

const APP_CONFIG = window.AQUA_FLORA_CONFIG || {};
const ADMIN_EMAIL = String(APP_CONFIG.adminEmail || "e.koblitsky@gmail.com").toLowerCase();
const CONTACT_EMAIL = APP_CONFIG.shopEmail || "plantovia.shop@gmail.com";
const EMAILJS_CONFIG = APP_CONFIG.emailjs || {};
const EMAILJS_PLACEHOLDER_PATTERN = /^PASTE_|_HERE$/i;

if (typeof emailjs !== "undefined" && EMAILJS_CONFIG.publicKey) {
  emailjs.init({
    publicKey: EMAILJS_CONFIG.publicKey,
    blockHeadless: true,
    limitRate: {
      id: "plantovia-storefront",
      throttle: 900
    }
  });
}

function isConfiguredValue(value) {
  return Boolean(value && !EMAILJS_PLACEHOLDER_PATTERN.test(String(value)) && !String(value).includes("PASTE_"));
}

function isEmailJsReady(templateId) {
  return typeof emailjs !== "undefined" &&
    isConfiguredValue(EMAILJS_CONFIG.publicKey) &&
    isConfiguredValue(EMAILJS_CONFIG.serviceId) &&
    isConfiguredValue(templateId);
}

function getSupabaseClient() {
  const config = window.AQUA_FLORA_CONFIG || {};
  const hasConfig =
    config.supabaseUrl &&
    config.supabaseAnonKey &&
    config.supabaseUrl !== SUPABASE_PLACEHOLDER_URL &&
    config.supabaseAnonKey !== SUPABASE_PLACEHOLDER_KEY;

  if (!hasConfig || typeof supabase === "undefined") return null;

  if (!supabaseClient) {
    supabaseClient = supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);
    supabaseClient.auth.onAuthStateChange(event => {
      if (event === "PASSWORD_RECOVERY") {
        passwordRecoveryPending = true;
        document.dispatchEvent(new CustomEvent("plantovia:password-recovery"));
      }
    });
  }

  return supabaseClient;
}

function isBackendEnabled() {
  return Boolean(getSupabaseClient());
}

function normalizeCategoryName(category) {
  return String(category || "").trim().replace(/\s+/g, " ");
}

function createSlug(text) {
  const base = String(text || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return base || `plant-${Date.now()}`;
}

function uniqueValues(values) {
  const seen = new Set();
  return values
    .map(normalizeCategoryName)
    .filter(Boolean)
    .filter(value => {
      const key = value.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function inferPlantCategories(plant) {
  const categories = [];
  const requirements = (plant.requirements || []).join(" ").toLowerCase();
  const name = (plant.name || "").toLowerCase();
  const description = (plant.description || "").toLowerCase();
  const price = Number(plant.price || 0);

  if (price && price <= 6) categories.push("Budget friendly");
  if (requirements.includes("difficulty: easy")) categories.push("Easy care");
  if (requirements.includes("difficulty: medium")) categories.push("Intermediate");
  if (requirements.includes("difficulty: hard") || requirements.includes("difficulty: advanced")) categories.push("Advanced");
  if (requirements.includes("low to medium") || requirements.includes("low to high")) categories.push("Low light");
  if (name.includes("red") || description.includes("red") || description.includes("color")) categories.push("Color plants");
  if (name.includes("monte carlo") || name.includes("hairgrass") || description.includes("carpet")) categories.push("Carpeting");
  if (name.includes("anubias") || name.includes("fern") || name.includes("buce") || description.includes("attach")) categories.push("Epiphytes");
  if (description.includes("floating") || name.includes("salvinia")) categories.push("Floating plants");

  return uniqueValues(categories.length ? categories : ["Easy care"]);
}

function normalizePlant(plant) {
  const normalized = {
    ...plant,
    price: Number(plant.price || 0),
    images: plant.images && plant.images.length ? plant.images : ["assets/hero-aquascape.png"],
    requirements: plant.requirements && plant.requirements.length ? plant.requirements : ["Light: Low to medium", "CO2: Not required", "Difficulty: Easy"],
    status: plant.status || "good"
  };

  normalized.categories = uniqueValues(normalized.categories || inferPlantCategories(normalized));
  return normalized;
}

function getPlants() {
  if (runtimePlants) return runtimePlants;
  if (typeof plants === "undefined") return [];

  const storedPlants = safeJsonParse(PLANT_STORAGE_KEY, null);
  if (storedPlants && Array.isArray(storedPlants)) return storedPlants.map(normalizePlant);

  return plants.map(normalizePlant);
}

function savePlants(nextPlants) {
  runtimePlants = nextPlants.map(normalizePlant);
  localStorage.setItem(PLANT_STORAGE_KEY, JSON.stringify(runtimePlants));
}

function getCategoryList() {
  if (runtimeCategories) return runtimeCategories;

  const storedCategories = safeJsonParse(CATEGORY_STORAGE_KEY, null);
  if (storedCategories && Array.isArray(storedCategories) && storedCategories.length) {
    runtimeCategories = uniqueValues(storedCategories);
    return runtimeCategories;
  }

  const plantCategories = getPlants().flatMap(plant => plant.categories || []);
  runtimeCategories = uniqueValues([...DEFAULT_CATEGORIES, ...plantCategories]);
  return runtimeCategories;
}

function saveCategories(categories) {
  runtimeCategories = uniqueValues(categories);
  localStorage.setItem(CATEGORY_STORAGE_KEY, JSON.stringify(runtimeCategories));
}

function getFeaturedPlantIds() {
  if (runtimeFeaturedIds) return runtimeFeaturedIds;

  const storedIds = safeJsonParse(FEATURED_STORAGE_KEY, null);
  if (storedIds && Array.isArray(storedIds) && storedIds.length) return storedIds;
  return getPlants().slice(0, 3).map(plant => plant.id);
}

function saveFeaturedPlantIds(ids) {
  runtimeFeaturedIds = ids;
  localStorage.setItem(FEATURED_STORAGE_KEY, JSON.stringify(ids));
}

function getSiteSettings() {
  if (runtimeSiteSettings) return runtimeSiteSettings;

  const storedSettings = safeJsonParse(SITE_SETTINGS_STORAGE_KEY, null);
  runtimeSiteSettings = {
    ...DEFAULT_SITE_SETTINGS,
    ...(storedSettings || {})
  };

  runtimeSiteSettings.freeMississaugaShippingThreshold =
    Number(runtimeSiteSettings.freeMississaugaShippingThreshold || 0);
  runtimeSiteSettings.mississaugaDeliveryFee =
    Number(runtimeSiteSettings.mississaugaDeliveryFee || 0);

  return runtimeSiteSettings;
}

function saveSiteSettings(nextSettings) {
  const mergedSettings = {
    ...getSiteSettings(),
    ...nextSettings
  };

  runtimeSiteSettings = {
    ...mergedSettings,
    freeMississaugaShippingThreshold: Math.max(0, Number(mergedSettings.freeMississaugaShippingThreshold || 0)),
    mississaugaDeliveryFee: Math.max(0, Number(mergedSettings.mississaugaDeliveryFee || 0))
  };
  localStorage.setItem(SITE_SETTINGS_STORAGE_KEY, JSON.stringify(runtimeSiteSettings));
}

function formatCad(amount) {
  return Number(amount || 0).toLocaleString("en-CA", {
    style: "currency",
    currency: "CAD"
  });
}

function isAdminUser(username = getCurrentUser()) {
  return String(username || "").toLowerCase() === ADMIN_EMAIL;
}

function getPlantImage(plant) {
  return plant.images && plant.images.length ? plant.images[0] : "assets/hero-aquascape.png";
}

function getStatusLabel(status) {
  return status === "low" ? "Low stock" : "Good stock";
}

function plantToDatabaseRow(plant, index = 0) {
  return {
    id: plant.id,
    name: plant.name,
    price: plant.price,
    description: plant.description,
    requirements: plant.requirements || [],
    images: plant.images || [],
    status: plant.status || "good",
    categories: plant.categories || [],
    sort_order: index
  };
}

function databaseRowToPlant(row) {
  return normalizePlant({
    id: row.id,
    name: row.name,
    price: Number(row.price || 0),
    description: row.description || "",
    requirements: row.requirements || [],
    images: row.images && row.images.length ? row.images : ["assets/hero-aquascape.png"],
    status: row.status || "good",
    categories: row.categories || []
  });
}

function isMissingCategoriesError(error) {
  return error && /categories|plant_categories|schema cache/i.test(error.message || "");
}

async function loadBackendData() {
  const client = getSupabaseClient();
  if (!client) return;

  try {
    const [{ data: plantRows, error: plantError }, { data: featuredRows, error: featuredError }] = await Promise.all([
      client.from("plants").select("*").order("sort_order", { ascending: true }),
      client.from("featured_plants").select("*").order("position", { ascending: true })
    ]);

    if (plantError) throw plantError;
    if (featuredError) throw featuredError;

    if (plantRows && plantRows.length) {
      runtimePlants = plantRows.map(databaseRowToPlant);
      localStorage.removeItem(PLANT_STORAGE_KEY);
    }

    if (featuredRows && featuredRows.length) {
      runtimeFeaturedIds = featuredRows.map(row => row.plant_id);
      localStorage.removeItem(FEATURED_STORAGE_KEY);
    }

    const { data: categoryRows, error: categoryError } = await client
      .from("plant_categories")
      .select("*")
      .order("sort_order", { ascending: true });

    if (!categoryError && categoryRows && categoryRows.length) {
      runtimeCategories = uniqueValues(categoryRows.map(row => row.name));
      localStorage.removeItem(CATEGORY_STORAGE_KEY);
    } else {
      runtimeCategories = uniqueValues([...DEFAULT_CATEGORIES, ...getPlants().flatMap(plant => plant.categories || [])]);
    }

    const { data: settingsRows, error: settingsError } = await client
      .from("site_settings")
      .select("*")
      .eq("key", "shipping")
      .limit(1);

    if (!settingsError && settingsRows && settingsRows.length) {
      saveSiteSettings(settingsRows[0].value || {});
      localStorage.removeItem(SITE_SETTINGS_STORAGE_KEY);
      runtimeSiteSettings = {
        ...DEFAULT_SITE_SETTINGS,
        ...(settingsRows[0].value || {})
      };
      runtimeSiteSettings.freeMississaugaShippingThreshold =
        Number(runtimeSiteSettings.freeMississaugaShippingThreshold || 0);
      runtimeSiteSettings.mississaugaDeliveryFee =
        Number(runtimeSiteSettings.mississaugaDeliveryFee || 0);
    }
  } catch (error) {
    console.error("Supabase load failed:", error);
  }
}

function ensureBackendDataLoaded() {
  if (!backendDataPromise) {
    backendDataPromise = loadBackendData();
  }

  return backendDataPromise;
}

window.ensureAquaFloraBackendDataLoaded = ensureBackendDataLoaded;

async function savePlantToBackend(plant) {
  const client = getSupabaseClient();
  if (!client) return;

  const index = getPlants().findIndex(item => item.id === plant.id);
  const row = plantToDatabaseRow(plant, index);
  const { error } = await client
    .from("plants")
    .upsert(row, { onConflict: "id" });

  if (!error) return;

  if (isMissingCategoriesError(error)) {
    delete row.categories;
    const { error: retryError } = await client
      .from("plants")
      .upsert(row, { onConflict: "id" });

    if (!retryError) return;
    throw retryError;
  }

  throw error;
}

async function savePlantsToBackend(nextPlants) {
  const client = getSupabaseClient();
  if (!client) return;

  const rows = nextPlants.map((plant, index) => plantToDatabaseRow(plant, index));
  const { error } = await client.from("plants").upsert(rows, { onConflict: "id" });

  if (!error) return;

  if (isMissingCategoriesError(error)) {
    rows.forEach(row => delete row.categories);
    const { error: retryError } = await client.from("plants").upsert(rows, { onConflict: "id" });
    if (!retryError) return;
    throw retryError;
  }

  throw error;
}

async function deletePlantFromBackend(plantId) {
  const client = getSupabaseClient();
  if (!client) return;

  const { error } = await client
    .from("plants")
    .delete()
    .eq("id", plantId);

  if (error) throw error;
}

async function saveCategoriesToBackend(categories) {
  const client = getSupabaseClient();
  if (!client) return;

  const { error: deleteError } = await client
    .from("plant_categories")
    .delete()
    .neq("name", "__never__");

  if (deleteError) throw deleteError;

  const rows = uniqueValues(categories).map((name, index) => ({ name, sort_order: index }));
  if (!rows.length) return;

  const { error: insertError } = await client
    .from("plant_categories")
    .insert(rows);

  if (insertError) throw insertError;
}

async function saveFeaturedToBackend(ids) {
  const client = getSupabaseClient();
  if (!client) return;

  const { error: deleteError } = await client
    .from("featured_plants")
    .delete()
    .neq("plant_id", "__never__");

  if (deleteError) throw deleteError;

  if (!ids.length) return;

  const { error: insertError } = await client
    .from("featured_plants")
    .insert(ids.map((id, index) => ({ plant_id: id, position: index })));

  if (insertError) throw insertError;
}

async function saveSiteSettingsToBackend(settings) {
  const client = getSupabaseClient();
  if (!client) return;

  const { error } = await client
    .from("site_settings")
    .upsert({
      key: "shipping",
      value: settings,
      updated_at: new Date().toISOString()
    }, { onConflict: "key" });

  if (error) throw error;
}

async function seedBackendFromDefaultPlants() {
  const client = getSupabaseClient();
  if (!client || typeof plants === "undefined") return;

  const defaultPlants = plants.map(normalizePlant);
  await savePlantsToBackend(defaultPlants);
  await saveCategoriesToBackend(uniqueValues([...DEFAULT_CATEGORIES, ...defaultPlants.flatMap(plant => plant.categories || [])])).catch(error => {
    if (!isMissingCategoriesError(error)) throw error;
  });

  await saveFeaturedToBackend(defaultPlants.slice(0, 3).map(plant => plant.id));
  await loadBackendData();
}

async function uploadPlantImages(plantId, files) {
  const client = getSupabaseClient();
  if (!client) return Promise.all([...files].map(fileToDataUrl));

  const uploadedUrls = [];

  for (const file of files) {
    const extension = file.name.split(".").pop() || "jpg";
    const filePath = `${plantId}/${Date.now()}-${Math.random().toString(16).slice(2)}.${extension}`;
    const { error } = await client.storage
      .from("plant-images")
      .upload(filePath, file, {
        cacheControl: "3600",
        upsert: false
      });

    if (error) throw error;

    const { data } = client.storage.from("plant-images").getPublicUrl(filePath);
    uploadedUrls.push(data.publicUrl);
  }

  return uploadedUrls;
}

function saveCart() {
  localStorage.setItem("cart", JSON.stringify(cart));
}

function addToCart(plant, quantity = 1) {
  const existingItem = cart.find(item => item.name === plant.name);
  const image = getPlantImage(plant);
  const addedQuantity = Math.max(1, Math.round(Number(quantity)) || 1);

  if (existingItem) {
    existingItem.quantity = Math.min(99, Math.max(1, Math.round(Number(existingItem.quantity)) || 0) + addedQuantity);
  } else {
    cart.push({
      id: plant.id,
      name: plant.name,
      price: plant.price,
      image,
      quantity: addedQuantity
    });
  }

  saveCart();
  updateHeaderCart();
}

function showAddToCartFeedback(button, plantName, quantity) {
  if (!button) return;

  const originalText = button.dataset.originalText || button.textContent;
  button.dataset.originalText = originalText;
  button.textContent = `Added ${quantity} ${plantName}`;
  button.classList.add("is-added");

  window.clearTimeout(button.feedbackTimeout);
  button.feedbackTimeout = window.setTimeout(() => {
    button.textContent = button.dataset.originalText || originalText;
    button.classList.remove("is-added");
  }, 1800);
}

function getCurrentUser() {
  return localStorage.getItem("currentUser");
}

function getLocalPurchaseHistory() {
  return safeJsonParse(PURCHASE_HISTORY_STORAGE_KEY, {});
}

function saveLocalPurchaseHistory(history) {
  localStorage.setItem(PURCHASE_HISTORY_STORAGE_KEY, JSON.stringify(history));
}

function createOrderRecord(pendingOrder) {
  const createdAt = pendingOrder.createdAt || new Date().toISOString();
  const orderId = pendingOrder.id || `PLV-${createdAt.replace(/[-:.TZ]/g, "").slice(0, 14)}`;

  return {
    id: orderId,
    createdAt,
    items: pendingOrder.cart || [],
    totals: pendingOrder.totals || calculateCartTotals(),
    deliveryInfo: pendingOrder.deliveryInfo || {},
    status: pendingOrder.status || "Order submitted",
    paymentStatus: pendingOrder.paymentStatus || "Awaiting e-transfer",
    paymentMethod: pendingOrder.paymentMethod || "E-transfer",
    customerEmail: pendingOrder.customerEmail || pendingOrder.deliveryInfo?.email || "",
    confirmation: pendingOrder.confirmation || null
  };
}

function databaseOrderToRecord(row) {
  return createOrderRecord({
    id: row.order_number,
    createdAt: row.created_at,
    cart: row.items || [],
    totals: row.totals || {},
    deliveryInfo: row.delivery_info || {},
    status: row.status || "Order submitted",
    paymentStatus: row.payment_status || "Awaiting e-transfer",
    paymentMethod: row.payment_method || "E-transfer",
    customerEmail: row.customer_email || row.delivery_info?.email || "",
    confirmation: row.confirmation || null
  });
}

function saveOrderToLocalHistory(username, order) {
  if (!username) return;

  const history = getLocalPurchaseHistory();
  const userOrders = history[username] || [];

  if (!userOrders.some(savedOrder => savedOrder.id === order.id)) {
    history[username] = [order, ...userOrders];
    saveLocalPurchaseHistory(history);
  }
}

function getOrderEmailParams(order) {
  const details = (order.items || []).map(item =>
    `${item.name} | Qty: ${item.quantity} | ${formatCad(Number(item.price || 0))} each | ${formatCad(Number(item.price || 0) * Number(item.quantity || 0))}`
  ).join("\n");
  const delivery = order.deliveryInfo || {};
  const totals = order.totals || {};

  return {
    to_email: order.customerEmail || delivery.email || "",
    shop_email: CONTACT_EMAIL,
    order_id: order.id,
    order_date: new Date(order.createdAt).toLocaleString("en-CA", { dateStyle: "long", timeStyle: "short" }),
    customer_name: delivery.name || "Customer",
    customer_email: order.customerEmail || delivery.email || "",
    customer_phone: delivery.phone || "",
    customer_address: [delivery.address, delivery.city, delivery.postal].filter(Boolean).join(", "),
    order_details: details,
    subtotal: Number(totals.subtotal || 0).toFixed(2),
    tax: Number(totals.tax || 0).toFixed(2),
    shipping: Number(totals.shipping || 0).toFixed(2),
    total: Number(totals.total || 0).toFixed(2),
    currency: totals.currency || "CAD",
    payment_method: order.paymentMethod || "E-transfer",
    payment_status: order.paymentStatus || "Awaiting e-transfer",
    e_transfer_email: CONTACT_EMAIL,
    status: order.status || "Order submitted",
    email_subject: `Order received - ${order.id}`,
    email_heading: "Order received",
    email_intro: `Please send the exact total by e-transfer to ${CONTACT_EMAIL} and include your order number in the message.`,
    is_admin_order: false,
    is_order_receipt: true,
    is_delivery_confirmation: false
  };
}

function wait(milliseconds) {
  return new Promise(resolve => window.setTimeout(resolve, milliseconds));
}

async function sendEmailJsTemplate(templateId, params) {
  if (!isEmailJsReady(templateId)) return { skipped: true };
  return emailjs.send(EMAILJS_CONFIG.serviceId, templateId, params);
}

async function sendOrderNotifications(order) {
  const params = getOrderEmailParams(order);
  const results = { adminSent: false, customerSent: false };

  if (isEmailJsReady(EMAILJS_CONFIG.adminOrderTemplateId)) {
    await sendEmailJsTemplate(EMAILJS_CONFIG.adminOrderTemplateId, {
      ...params,
      to_email: CONTACT_EMAIL,
      email_subject: `New Plantovia order ${order.id}`,
      email_heading: "New Plantovia order",
      email_intro: "A new order was securely saved in the Plantovia admin order desk.",
      is_admin_order: true,
      is_order_receipt: false
    });
    results.adminSent = true;
  }

  if (isEmailJsReady(EMAILJS_CONFIG.customerReceiptTemplateId)) {
    if (results.adminSent) await wait(1100);
    await sendEmailJsTemplate(EMAILJS_CONFIG.customerReceiptTemplateId, params);
    results.customerSent = true;
  }

  return results;
}

async function sendDeliveryConfirmationNotification(order) {
  const confirmation = order.confirmation || {};
  const signedAt = confirmation.signed_at || confirmation.confirmedAt || new Date().toISOString();

  return sendEmailJsTemplate(EMAILJS_CONFIG.deliveryConfirmationTemplateId, {
    ...getOrderEmailParams(order),
    to_email: CONTACT_EMAIL,
    email_subject: `Delivery confirmed for ${order.id}`,
    email_heading: "Signed delivery confirmation",
    email_intro: "The customer signed to confirm that this order was received in acceptable condition.",
    is_admin_order: false,
    is_order_receipt: false,
    is_delivery_confirmation: true,
    signature: confirmation.signature || "",
    signed_at: new Date(signedAt).toLocaleString("en-CA", { dateStyle: "long", timeStyle: "short" }),
    signed_by_email: confirmation.signed_by_email || order.customerEmail || "",
    confirmation_statement: confirmation.statement || "I confirm that I received this order in acceptable condition.",
    proof_hash: confirmation.proof_hash || ""
  });
}

async function placeOrderInBackend(deliveryInfo) {
  const client = getSupabaseClient();
  if (!client) throw new Error("Online ordering is temporarily unavailable. Please contact Plantovia.");

  const { data: userData, error: userError } = await client.auth.getUser();
  if (userError || !userData?.user) {
    throw new Error("Sign in before submitting your order so it can be saved to your account.");
  }

  const orderItems = sanitizeCartItems(cart).map(item => ({ id: item.id, quantity: item.quantity }));
  const { data, error } = await client.rpc("place_order", {
    p_items: orderItems,
    p_delivery_info: deliveryInfo
  });

  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error("The order could not be created. Please try again.");
  return databaseOrderToRecord(row);
}

async function saveOrderConfirmation(orderId, signature) {
  const client = getSupabaseClient();
  if (!client) throw new Error("Delivery confirmation requires an online account.");

  const { data, error } = await client.rpc("confirm_order_received", {
    p_order_number: orderId,
    p_signature: signature,
    p_user_agent: navigator.userAgent || ""
  });

  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error("The delivery confirmation could not be saved.");

  const order = databaseOrderToRecord(row);
  try {
    await sendDeliveryConfirmationNotification(order);
  } catch (notificationError) {
    console.error("Delivery confirmation email failed:", notificationError);
  }
  return order;
}

async function getBlockedAccountStatus(userId) {
  const client = getSupabaseClient();
  if (!client || !userId) return false;

  const { data, error } = await client.from("profiles").select("blocked").eq("user_id", userId).maybeSingle();
  if (error) {
    console.error("Account status check failed:", error);
    return false;
  }
  return Boolean(data?.blocked);
}

async function enforceBlockedAccountSession() {
  const client = getSupabaseClient();
  if (!client) return false;
  const { data } = await client.auth.getSession();
  const user = data.session?.user;
  if (!user || String(user.email || "").toLowerCase() === ADMIN_EMAIL) return false;
  if (!(await getBlockedAccountStatus(user.id))) return false;
  await client.auth.signOut();
  localStorage.removeItem("currentUser");
  sessionStorage.setItem("plantoviaAccountNotice", "This Plantovia account has been blocked. Contact plantovia.shop@gmail.com for help.");
  return true;
}

function updateUserDisplay() {
  renderDrawerAccountSection();
}

function calculateCartTotals() {
  const subtotal = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const tax = subtotal * TAX_RATE;
  const siteSettings = getSiteSettings();
  const freeShippingThreshold = Number(siteSettings.freeMississaugaShippingThreshold || 0);
  const deliveryFee = Number(siteSettings.mississaugaDeliveryFee || 0);
  const qualifiesForFreeMississaugaShipping = subtotal > 0 && freeShippingThreshold > 0 && subtotal >= freeShippingThreshold;
  const shipping = subtotal > 0 && !qualifiesForFreeMississaugaShipping ? deliveryFee : 0;
  const total = subtotal + tax + shipping;

  return { subtotal, tax, shipping, total, freeShippingThreshold, deliveryFee, qualifiesForFreeMississaugaShipping };
}

function updateShippingStatement() {
  const message = document.getElementById("free-shipping-message");
  const siteSettings = getSiteSettings();
  const threshold = Number(siteSettings.freeMississaugaShippingThreshold || 0);
  const deliveryFee = Number(siteSettings.mississaugaDeliveryFee || 0);

  if (!message) return;

  if (threshold > 0) {
    message.textContent = `Free shipping within Mississauga on orders over ${formatCad(threshold)}. Orders below that have a ${formatCad(deliveryFee)} delivery fee.`;
  } else {
    message.textContent = `Mississauga delivery is available for ${formatCad(deliveryFee)}.`;
  }
}

function updateHeaderCart() {
  const cartCount = document.getElementById("cart-count");
  const cartTotal = document.getElementById("cart-total");

  if (!cartCount || !cartTotal) return;

  const totalItems = cart.reduce((sum, item) => sum + item.quantity, 0);
  const totals = calculateCartTotals();

  cartCount.textContent = `${totalItems} ${totalItems === 1 ? "item" : "items"}`;
  cartTotal.textContent = totals.subtotal.toFixed(2);
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function dateKeyFromDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function calendarRangeLabel(range) {
  if (!range.startDate) return "Any date";
  const start = new Date(`${range.startDate}T12:00:00`).toLocaleDateString("en-CA", { dateStyle: "medium" });
  if (!range.endDate) return start;
  const end = new Date(`${range.endDate}T12:00:00`).toLocaleDateString("en-CA", { dateStyle: "medium" });
  return `${start} - ${end}`;
}

function buildDateRangeCalendar(monthDate, range) {
  const year = monthDate.getFullYear();
  const month = monthDate.getMonth();
  const firstWeekday = new Date(year, month, 1).getDay();
  const dayCount = new Date(year, month + 1, 0).getDate();
  const cells = [];

  for (let blank = 0; blank < firstWeekday; blank += 1) {
    cells.push('<span class="admin-calendar-blank" aria-hidden="true"></span>');
  }

  for (let day = 1; day <= dayCount; day += 1) {
    const key = dateKeyFromDate(new Date(year, month, day));
    const selected = key === range.startDate || key === range.endDate;
    const inRange = range.startDate && range.endDate && key > range.startDate && key < range.endDate;
    cells.push(`<button class="admin-calendar-day ${selected ? "selected" : ""} ${inRange ? "in-range" : ""}" data-date="${key}" type="button" aria-pressed="${selected ? "true" : "false"}">${day}</button>`);
  }

  return `
    <div class="admin-calendar">
      <div class="admin-calendar-header">
        <button class="admin-calendar-month" data-direction="previous" type="button" aria-label="Previous month">&#8249;</button>
        <strong>${monthDate.toLocaleDateString("en-CA", { month: "long", year: "numeric" })}</strong>
        <button class="admin-calendar-month" data-direction="next" type="button" aria-label="Next month">&#8250;</button>
      </div>
      <div class="admin-calendar-weekdays" aria-hidden="true">${["S", "M", "T", "W", "T", "F", "S"].map(day => `<span>${day}</span>`).join("")}</div>
      <div class="admin-calendar-grid">${cells.join("")}</div>
      <div class="admin-calendar-actions">
        <button class="button secondary admin-use-month" type="button">Use This Month</button>
        <span>${escapeHtml(calendarRangeLabel(range))}</span>
      </div>
    </div>`;
}

function pickCalendarRangeDate(range, dateKey) {
  if (!range.startDate || range.endDate) {
    range.startDate = dateKey;
    range.endDate = "";
  } else if (dateKey < range.startDate) {
    range.endDate = range.startDate;
    range.startDate = dateKey;
  } else {
    range.endDate = dateKey;
  }
}

function plantCardTemplate(plant) {
  const image = getPlantImage(plant);
  const images = plant.images && plant.images.length ? plant.images : [image];
  const categoryTags = (plant.categories || []).slice(0, 3);

  return `
    <section class="plant-card" data-id="${plant.id}" data-name="${plant.name}" data-price="${plant.price}" data-image="${image}">
      <div class="plant-image-slider" style="--bg-image: url('${image}')">
        <button class="plant-img-arrow plant-img-left" type="button" aria-label="Previous ${plant.name} image">&lsaquo;</button>
        <a href="plant.html?id=${plant.id}">
          <img class="plant-card-img" src="${image}" alt="${plant.name}" data-images="${encodeURIComponent(JSON.stringify(images))}">
        </a>
        <button class="plant-img-arrow plant-img-right" type="button" aria-label="Next ${plant.name} image">&rsaquo;</button>
      </div>

      <div class="plant-card-body">
        <span class="stock-badge ${plant.status === "low" ? "low-stock" : "good-stock"}">${getStatusLabel(plant.status)}</span>
        <h2>
          <a href="plant.html?id=${plant.id}" class="plant-name-link">${plant.name}</a>
        </h2>
        <p class="price">$${Number(plant.price).toFixed(2)}</p>
        <div class="category-chip-row">
          ${categoryTags.map(category => `<span class="category-chip">${escapeHtml(category)}</span>`).join("")}
        </div>
        <p>${escapeHtml(plant.description)}</p>

        <ul class="care-list">
          ${plant.requirements.map(requirement => `<li>${escapeHtml(requirement)}</li>`).join("")}
        </ul>

        <div class="quantity-control">
          <button class="decrease" aria-label="Decrease ${plant.name} quantity">-</button>
          <span class="quantity">1</span>
          <button class="increase" aria-label="Increase ${plant.name} quantity">+</button>
        </div>

        <button class="add-to-cart">Add to Cart</button>
      </div>
    </section>
  `;
}

function getFilteredCataloguePlants() {
  const searchText = activeCatalogueSearch.trim().toLowerCase();

  return getPlants().filter(plant => {
    const categories = plant.categories || [];
    const matchesCategory =
      activeCategoryFilter === "all" ||
      categories.some(category => category.toLowerCase() === activeCategoryFilter.toLowerCase());

    const matchesSearch =
      !searchText ||
      plant.name.toLowerCase().includes(searchText) ||
      plant.description.toLowerCase().includes(searchText) ||
      categories.some(category => category.toLowerCase().includes(searchText));

    return matchesCategory && matchesSearch;
  });
}

function updateCatalogueFilterText(count) {
  const label = document.getElementById("catalogue-filter-label");
  if (!label) return;

  const pieces = [];
  if (activeCategoryFilter !== "all") pieces.push(activeCategoryFilter);
  if (activeCatalogueSearch.trim()) pieces.push(`search: ${activeCatalogueSearch.trim()}`);

  label.textContent = pieces.length
    ? `${count} result${count === 1 ? "" : "s"} for ${pieces.join(" and ")}`
    : "Prices are listed per plant or portion. Local delivery is calculated at checkout.";
}

function setupPlantImageSliders() {
  document.querySelectorAll(".plant-image-slider").forEach(slider => {
    const img = slider.querySelector(".plant-card-img");
    const leftBtn = slider.querySelector(".plant-img-left");
    const rightBtn = slider.querySelector(".plant-img-right");

    if (!img || !leftBtn || !rightBtn) return;

    const images = JSON.parse(decodeURIComponent(img.dataset.images || "%5B%5D"));
    let index = 0;

    if (images.length <= 1) {
      leftBtn.hidden = true;
      rightBtn.hidden = true;
      return;
    }

    function showImage() {
      img.src = images[index];
      slider.style.setProperty("--bg-image", `url('${images[index]}')`);
    }

    leftBtn.addEventListener("click", () => {
      index = (index - 1 + images.length) % images.length;
      showImage();
    });

    rightBtn.addEventListener("click", () => {
      index = (index + 1) % images.length;
      showImage();
    });
  });
}

function setupSlider() {
  const slider = document.querySelector(".image-slider");
  const featuredCard = document.getElementById("featured-card");
  if (!slider || !featuredCard) return;

  const track = slider.querySelector(".image-track");
  const leftArrow = slider.querySelector(".left");
  const rightArrow = slider.querySelector(".right");
  const featuredName = document.getElementById("featured-name");
  const featuredPrice = document.getElementById("featured-price");
  const featuredDescription = document.getElementById("featured-description");
  const featuredRequirements = document.getElementById("featured-requirements");
  const qtyDisplay = document.getElementById("featured-quantity");
  const incBtn = document.getElementById("featured-increase");
  const decBtn = document.getElementById("featured-decrease");
  const addBtn = document.getElementById("featured-add-to-cart");

  if (!track || !leftArrow || !rightArrow || !featuredName || !featuredPrice || !featuredDescription || !featuredRequirements || !qtyDisplay || !incBtn || !decBtn || !addBtn) return;

  const allPlants = getPlants();
  const featuredIds = getFeaturedPlantIds();
  const featuredPlants = featuredIds
    .map(id => allPlants.find(plant => plant.id === id))
    .filter(Boolean);

  if (!featuredPlants.length) return;

  track.innerHTML = featuredPlants.map(plant => {
    const image = getPlantImage(plant);
    return `<a class="featured-plant-link" href="plant.html?id=${encodeURIComponent(plant.id)}" aria-label="View ${escapeHtml(plant.name)}"><img src="${image}" alt="${escapeHtml(plant.name)}" style="--bg-image: url('${image}')"></a>`;
  }).join("");

  let currentIndex = 0;
  let quantity = 1;

  function updateFeaturedInfo() {
    const plant = featuredPlants[currentIndex];
    const image = getPlantImage(plant);

    slider.style.setProperty("--featured-bg-image", `url('${image}')`);
    featuredName.innerHTML = `<a class="featured-name-link" href="plant.html?id=${encodeURIComponent(plant.id)}">${escapeHtml(plant.name)}</a>`;
    featuredPrice.textContent = plant.price.toFixed(2);
    featuredDescription.textContent = plant.description;
    featuredCard.querySelectorAll(".stock-badge").forEach(badge => badge.remove());
    featuredDescription.insertAdjacentHTML("beforebegin", `<span class="stock-badge ${plant.status === "low" ? "low-stock" : "good-stock"}">${getStatusLabel(plant.status)}</span>`);
    featuredRequirements.innerHTML = plant.requirements.map(requirement => `<li>${requirement}</li>`).join("");
    featuredCard.dataset.name = plant.name;
    featuredCard.dataset.price = plant.price;
    featuredCard.dataset.image = image;
    featuredCard.dataset.id = plant.id;
    quantity = 1;
    qtyDisplay.textContent = quantity;
  }

  function updateSlider() {
    track.style.transform = `translateX(-${currentIndex * 100}%)`;
    updateFeaturedInfo();
  }

  rightArrow.addEventListener("click", () => {
    currentIndex = (currentIndex + 1) % featuredPlants.length;
    updateSlider();
  });

  leftArrow.addEventListener("click", () => {
    currentIndex = (currentIndex - 1 + featuredPlants.length) % featuredPlants.length;
    updateSlider();
  });

  incBtn.addEventListener("click", () => {
    quantity++;
    qtyDisplay.textContent = quantity;
  });

  decBtn.addEventListener("click", () => {
    if (quantity > 1) {
      quantity--;
      qtyDisplay.textContent = quantity;
    }
  });

  addBtn.addEventListener("click", () => {
    const plant = featuredPlants[currentIndex];
    addToCart(plant, quantity);
    showAddToCartFeedback(addBtn, plant.name, quantity);
    quantity = 1;
    qtyDisplay.textContent = quantity;
  });

  updateFeaturedInfo();
}

function setupPlantCards() {
  document.querySelectorAll(".plant-card").forEach(card => {
    const decreaseBtn = card.querySelector(".decrease");
    const increaseBtn = card.querySelector(".increase");
    const quantityText = card.querySelector(".quantity");
    const addToCartBtn = card.querySelector(".add-to-cart");

    if (!decreaseBtn || !increaseBtn || !quantityText || !addToCartBtn) return;

    let quantity = 1;

    increaseBtn.addEventListener("click", () => {
      quantity++;
      quantityText.textContent = quantity;
    });

    decreaseBtn.addEventListener("click", () => {
      if (quantity > 1) {
        quantity--;
        quantityText.textContent = quantity;
      }
    });

    addToCartBtn.addEventListener("click", () => {
      const plant = {
        id: card.dataset.id,
        name: card.dataset.name,
        price: Number(card.dataset.price),
        images: [card.dataset.image]
      };

      addToCart(plant, quantity);
      showAddToCartFeedback(addToCartBtn, plant.name, quantity);
      quantity = 1;
      quantityText.textContent = quantity;
    });
  });
}

function renderPlants() {
  const grid = document.getElementById("plant-grid");
  if (!grid) return;

  const pageSetting = document.body.dataset.page || "all";
  const filteredPlants = getFilteredCataloguePlants();
  const shouldPaginate = pageSetting !== "all";
  const page = Number(pageSetting || "1");
  const start = (page - 1) * PAGE_SIZE;
  const plantsToShow = shouldPaginate ? filteredPlants.slice(start, start + PAGE_SIZE) : filteredPlants;
  updateCatalogueFilterText(filteredPlants.length);

  if (!plantsToShow.length) {
    grid.innerHTML = `<p class="empty-state">No plants match this view yet.</p>`;
    return;
  }

  grid.innerHTML = plantsToShow.map(plantCardTemplate).join("");
  setupPlantImageSliders();
  setupPlantCards();
}

function setupSidePanel() {
  if (document.querySelector(".admin-page") || document.getElementById("aqua-side-panel")) return;

  const categories = getCategoryList();

  const scrim = document.createElement("div");
  scrim.id = "aqua-drawer-scrim";
  scrim.className = "shop-drawer-scrim";
  document.body.appendChild(scrim);

  const panel = document.createElement("aside");
  panel.id = "aqua-side-panel";
  panel.className = "shop-drawer";
  panel.setAttribute("aria-hidden", "true");
  panel.innerHTML = `
    <div class="shop-drawer-bubbles" aria-hidden="true">${Array.from({ length: 10 }).map(() => "<span></span>").join("")}</div>
    <div class="shop-drawer-head">
      <div class="shop-drawer-title">
        <img class="shop-drawer-logo" src="assets/plantovia-logo.png" alt="">
        <strong>Menu</strong>
      </div>
      <button class="shop-drawer-close" type="button" aria-label="Close menu">&times;</button>
    </div>
    <div class="shop-drawer-body">
      <section class="shop-drawer-section" id="drawer-account-section"></section>

      <section class="shop-drawer-section">
        <a href="search.html" class="drawer-search-btn">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.35-4.35"/></svg>
          Search Plants
        </a>
      </section>

      <section class="shop-drawer-section">
        <h3>Browse categories</h3>
        <div class="side-category-list">
          <button class="side-category active" type="button" data-category="all">All plants</button>
          ${categories.map(category => `<button class="side-category" type="button" data-category="${escapeHtml(category)}">${escapeHtml(category)}</button>`).join("")}
        </div>
      </section>

      <section class="shop-drawer-section">
        <h3>Shop</h3>
        <a href="index.html#plant-grid">Catalogue</a>
        <a href="cart.html">Cart</a>
      </section>

      <section class="shop-drawer-section">
        <h3>Support</h3>
        <a href="contact.html">Contact Us</a>
      </section>
    </div>
  `;

  document.body.appendChild(panel);
  renderDrawerAccountSection();

  const triggers = [];
  document.querySelectorAll(".top-menu").forEach(menu => {
    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "menu-trigger";
    trigger.setAttribute("aria-haspopup", "true");
    trigger.setAttribute("aria-expanded", "false");
    trigger.setAttribute("aria-controls", "aqua-side-panel");
    trigger.innerHTML = `<span class="menu-trigger-icon" aria-hidden="true"><span></span></span>Menu`;
    menu.insertAdjacentElement("afterbegin", trigger);
    triggers.push(trigger);
  });

  const closeBtn = panel.querySelector(".shop-drawer-close");

  function openPanel() {
    panel.classList.add("open");
    scrim.classList.add("open");
    panel.setAttribute("aria-hidden", "false");
    document.body.classList.add("drawer-open");
    triggers.forEach(trigger => trigger.setAttribute("aria-expanded", "true"));
  }

  function closePanel() {
    panel.classList.remove("open");
    scrim.classList.remove("open");
    panel.setAttribute("aria-hidden", "true");
    document.body.classList.remove("drawer-open");
    triggers.forEach(trigger => trigger.setAttribute("aria-expanded", "false"));
  }

  function togglePanel() {
    if (panel.classList.contains("open")) closePanel();
    else openPanel();
  }

  function focusCatalogue() {
    const grid = document.getElementById("plant-grid");
    if (grid) {
      grid.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  triggers.forEach(trigger => trigger.addEventListener("click", togglePanel));
  closeBtn.addEventListener("click", closePanel);
  scrim.addEventListener("click", closePanel);

  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && panel.classList.contains("open")) closePanel();
  });

  panel.addEventListener("click", async event => {
    if (event.target.closest(".drawer-signout-btn")) {
      await performGlobalSignOut();
      return;
    }

    const categoryButton = event.target.closest(".side-category");
    if (!categoryButton) return;

    activeCategoryFilter = categoryButton.dataset.category || "all";
    panel.querySelectorAll(".side-category").forEach(button => {
      button.classList.toggle("active", button === categoryButton);
    });
    renderPlants();
    focusCatalogue();
    closePanel();
  });
}

function renderDrawerAccountSection() {
  const section = document.getElementById("drawer-account-section");
  if (!section) return;

  const currentUser = getCurrentUser();

  if (!currentUser) {
    section.innerHTML = `
      <h3>Account</h3>
      <a href="account.html">Sign In / Create Account</a>
    `;
    return;
  }

  const admin = isAdminUser();

  section.innerHTML = `
    <h3>Account</h3>
    <p class="drawer-account-email">Signed in as<br><strong>${escapeHtml(currentUser)}</strong></p>
    <a href="purchase-history.html">Purchase History</a>
    ${admin ? '<a href="admin.html" class="drawer-admin-link">Admin Dashboard</a>' : ""}
    <button class="drawer-signout-btn" type="button">Sign Out</button>
  `;
}

async function performGlobalSignOut() {
  const client = getSupabaseClient();
  if (client) await client.auth.signOut();
  localStorage.removeItem("currentUser");
  localStorage.removeItem("adminSession");
  window.location.reload();
}

function introLeafMarkup() {
  return `<svg viewBox="0 0 64 88" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M32 4C16 14 6 32 6 50c0 18 12 32 26 34 14-2 26-16 26-34C58 32 48 14 32 4z" fill="currentColor"/>
    <path d="M32 4v80" stroke="rgba(6,25,18,0.28)" stroke-width="2" stroke-linecap="round"/>
  </svg>`;
}

function setupIntroAnimation() {
  const isHome = Boolean(document.querySelector(".hero"));
  if (!isHome) return;
  if (!window.matchMedia("(max-width: 850px)").matches) return;
  if (sessionStorage.getItem("aquaIntroPlayed")) return;

  sessionStorage.setItem("aquaIntroPlayed", "true");
  const intro = document.createElement("div");
  intro.className = "intro-splash";
  intro.innerHTML = `
    <div class="intro-leaves" aria-hidden="true">
      <span class="intro-leaf intro-leaf-left">${introLeafMarkup()}</span>
      <span class="intro-leaf intro-leaf-right">${introLeafMarkup()}</span>
    </div>
    <div class="intro-bubbles" aria-hidden="true">${Array.from({ length: 16 }).map(() => "<span></span>").join("")}</div>
    <div class="intro-burst" aria-hidden="true"></div>
    <img class="intro-mark" src="assets/plantovia-logo.png" alt="Plantovia logo">
    <span>PLANTOVIA</span>
  `;
  document.body.appendChild(intro);

  const hideDelay = 1700;
  const removeDelay = 2250;
  setTimeout(() => intro.classList.add("intro-hide"), hideDelay);
  setTimeout(() => intro.remove(), removeDelay);
}

function setupScrollEffects() {
  const revealTargets = document.querySelectorAll("[data-reveal]");
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  if (reduceMotion || !("IntersectionObserver" in window)) {
    revealTargets.forEach(target => target.classList.add("is-visible"));
  } else {
    const observer = new IntersectionObserver((entries, obs) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          obs.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: "0px 0px -60px 0px" });

    revealTargets.forEach(target => observer.observe(target));
  }
}

function setupBackToTop() {
  if (document.getElementById("aqua-back-to-top")) return;

  const button = document.createElement("button");
  button.id = "aqua-back-to-top";
  button.type = "button";
  button.className = "back-to-top";
  button.setAttribute("aria-label", "Back to top");
  button.innerHTML = "&uarr;";
  document.body.appendChild(button);

  button.addEventListener("click", () => {
    window.scrollTo({ top: 0, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  });

  window.addEventListener("scroll", () => {
    button.classList.toggle("is-visible", window.scrollY > 480);
  }, { passive: true });
}

function setupHeaderAutoHide() {
  const header = document.querySelector(".site-header");
  if (!header) return;

  let lastScrollY = window.scrollY;
  const movementThreshold = 6;

  function showHeader() {
    header.classList.remove("header-hidden");
  }

  function hideHeader() {
    header.classList.add("header-hidden");
  }

  function updateHeaderVisibility() {
    const currentScrollY = Math.max(window.scrollY, 0);
    const scrollDifference = currentScrollY - lastScrollY;

    if (currentScrollY <= 12 || document.activeElement.closest?.(".site-header")) {
      showHeader();
    } else if (scrollDifference > movementThreshold && currentScrollY > header.offsetHeight) {
      hideHeader();
    } else if (scrollDifference < -movementThreshold) {
      showHeader();
    }

    lastScrollY = currentScrollY;
  }

  window.addEventListener("scroll", updateHeaderVisibility, { passive: true });
  header.addEventListener("focusin", showHeader);
}

function setupCartPage() {
  const cartItemsContainer = document.getElementById("cart-items");
  const subtotalElement = document.getElementById("cart-subtotal");
  const taxElement = document.getElementById("cart-tax");
  const shippingElement = document.getElementById("cart-shipping");
  const totalElement = document.getElementById("cart-page-total");
  const clearCartBtn = document.getElementById("clear-cart");

  if (!cartItemsContainer) return;

  function updateCartPageTotals() {
    const totals = calculateCartTotals();

    if (subtotalElement) subtotalElement.textContent = totals.subtotal.toFixed(2);
    if (taxElement) taxElement.textContent = totals.tax.toFixed(2);
    if (shippingElement) shippingElement.textContent = totals.shipping.toFixed(2);
    if (totalElement) totalElement.textContent = totals.total.toFixed(2);
  }

  function renderCart() {
    cartItemsContainer.innerHTML = "";

    if (cart.length === 0) {
      cartItemsContainer.innerHTML = `<p class="empty-state">Your cart is empty.</p>`;
      updateCartPageTotals();
      return;
    }

    cart.forEach((item, index) => {
      const itemDiv = document.createElement("div");
      itemDiv.classList.add("cart-item");

      itemDiv.innerHTML = `
        <img src="${item.image}" alt="${item.name}">
        <div>
          <h2>${item.name}</h2>
          <p>$${item.price.toFixed(2)} each</p>
          <p>Quantity: ${item.quantity}</p>
          <p><strong>Item total: $${(item.price * item.quantity).toFixed(2)}</strong></p>
          <div class="cart-remove-control">
            <button class="cart-quantity-decrease" data-index="${index}" aria-label="Decrease ${item.name} quantity">-</button>
            <span class="cart-quantity" data-index="${index}">${item.quantity}</span>
            <button class="cart-quantity-increase" data-index="${index}" aria-label="Increase ${item.name} quantity">+</button>
          </div>
          <button class="remove-all" data-index="${index}">Remove All</button>
        </div>
      `;

      cartItemsContainer.appendChild(itemDiv);
    });

    updateCartPageTotals();
    setupRemoveButtons();
  }

  function setupRemoveButtons() {
    document.querySelectorAll(".cart-quantity-increase").forEach(button => {
      button.addEventListener("click", () => {
        const index = Number(button.dataset.index);
        const item = cart[index];

        if (!item) return;
        item.quantity = Math.min(99, (Math.round(Number(item.quantity)) || 0) + 1);
        saveCart();
        renderCart();
        updateHeaderCart();
      });
    });

    document.querySelectorAll(".cart-quantity-decrease").forEach(button => {
      button.addEventListener("click", () => {
        const index = Number(button.dataset.index);
        const item = cart[index];

        if (!item) return;
        if ((Math.round(Number(item.quantity)) || 0) <= 1) {
          cart.splice(index, 1);
        } else {
          item.quantity--;
        }

        saveCart();
        renderCart();
        updateHeaderCart();
      });
    });

    document.querySelectorAll(".remove-all").forEach(button => {
      button.addEventListener("click", () => {
        cart.splice(Number(button.dataset.index), 1);
        saveCart();
        renderCart();
        updateHeaderCart();
      });
    });
  }

  if (clearCartBtn) {
    clearCartBtn.addEventListener("click", () => {
      cart = [];
      saveCart();
      renderCart();
      updateHeaderCart();
    });
  }

  renderCart();
}

function setupDeliveryPage() {
  const saveDeliveryBtn = document.getElementById("save-delivery");
  const message = document.getElementById("delivery-message");
  const emailInput = document.getElementById("delivery-email");
  const client = getSupabaseClient();

  if (!saveDeliveryBtn) return;

  if (client && emailInput) {
    client.auth.getUser().then(({ data }) => {
      if (data?.user?.email) {
        emailInput.value = data.user.email;
        emailInput.readOnly = true;
      }
    });
  }

  saveDeliveryBtn.addEventListener("click", async () => {
    if (client) {
      const { data } = await client.auth.getUser();
      if (!data?.user) {
        message.innerHTML = `Please <a href="account.html">sign in or create an account</a> before checkout.`;
        return;
      }
    }

    const deliveryInfo = {
      name: document.getElementById("delivery-name").value.trim(),
      phone: document.getElementById("delivery-phone").value.trim(),
      email: emailInput.value.trim(),
      address: document.getElementById("delivery-address").value.trim(),
      city: document.getElementById("delivery-city").value.trim(),
      postal: document.getElementById("delivery-postal").value.trim()
    };

    if (Object.values(deliveryInfo).some(value => !value)) {
      message.textContent = "Please fill in all delivery fields.";
      return;
    }

    if (!/^\S+@\S+\.\S+$/.test(deliveryInfo.email)) {
      message.textContent = "Enter a valid email address.";
      return;
    }

    if (!/^[A-Za-z]\d[A-Za-z][ -]?\d[A-Za-z]\d$/.test(deliveryInfo.postal)) {
      message.textContent = "Enter a valid Canadian postal code.";
      return;
    }

    localStorage.setItem("deliveryInfo", JSON.stringify(deliveryInfo));
    window.location.href = "payment.html";
  });
}

function setupPaymentPage() {
  const placeOrderBtn = document.getElementById("place-order");
  const message = document.getElementById("payment-message");
  const subtotalElement = document.getElementById("payment-subtotal");
  const taxElement = document.getElementById("payment-tax");
  const shippingElement = document.getElementById("payment-shipping");
  const totalElement = document.getElementById("payment-total");
  const accountStatus = document.getElementById("payment-account-status");
  const client = getSupabaseClient();

  if (!placeOrderBtn) return;

  const totals = calculateCartTotals();

  if (subtotalElement) subtotalElement.textContent = totals.subtotal.toFixed(2);
  if (taxElement) taxElement.textContent = totals.tax.toFixed(2);
  if (shippingElement) shippingElement.textContent = totals.shipping.toFixed(2);
  if (totalElement) totalElement.textContent = totals.total.toFixed(2);

  if (client && accountStatus) {
    client.auth.getUser().then(({ data }) => {
      accountStatus.innerHTML = data?.user
        ? `Ordering as <strong>${escapeHtml(data.user.email)}</strong>. This order will be saved to your account.`
        : `Please <a href="account.html">sign in or create an account</a> before submitting the order.`;
    });
  }

  placeOrderBtn.addEventListener("click", async () => {
    const deliveryInfo = safeJsonParse("deliveryInfo", null);

    if (cart.length === 0) {
      message.textContent = "Your cart is empty.";
      return;
    }

    if (!deliveryInfo) {
      message.textContent = "Please add delivery details first.";
      return;
    }

    placeOrderBtn.disabled = true;
    placeOrderBtn.textContent = "Saving secure order...";
    message.textContent = "";

    try {
      const order = await placeOrderInBackend(deliveryInfo);
      const username = getCurrentUser();
      saveOrderToLocalHistory(username, order);

      let notificationStatus = { adminSent: false, customerSent: false };
      try {
        notificationStatus = await sendOrderNotifications(order);
      } catch (emailError) {
        console.error("Order email failed:", emailError);
      }

      localStorage.setItem("lastOrder", JSON.stringify({ ...order, notificationStatus }));
      localStorage.removeItem("pendingOrder");
      localStorage.removeItem("deliveryInfo");
      cart = [];
      saveCart();
      updateHeaderCart();
      window.location.href = `success.html?order=${encodeURIComponent(order.id)}`;
    } catch (error) {
      message.textContent = error.message || "The order could not be submitted. Please try again.";
      placeOrderBtn.disabled = false;
      placeOrderBtn.textContent = "Submit E-transfer Order";
    }
  });
}

function setupSuccessPage() {
  const orderNumber = document.getElementById("success-order-number");
  if (!orderNumber) return;

  const order = safeJsonParse("lastOrder", null);
  const total = document.getElementById("success-order-total");
  const receiptStatus = document.getElementById("success-receipt-status");

  if (!order) {
    orderNumber.textContent = new URLSearchParams(window.location.search).get("order") || "Saved in your account";
    return;
  }

  orderNumber.textContent = order.id;
  if (total) total.textContent = formatCad(order.totals?.total || 0);
  if (receiptStatus) {
    receiptStatus.textContent = order.notificationStatus?.customerSent
      ? `A receipt was sent to ${order.customerEmail}.`
      : "Your order is saved in your account. Email receipt setup still needs to be completed in EmailJS.";
  }
}

function setupSearchPage() {
  const searchInput = document.getElementById("search-input");
  const resultsGrid = document.getElementById("search-results");

  if (!searchInput || !resultsGrid) return;
  document.body.classList.add("search-body");

  const categoryList = document.getElementById("search-category-list");
  const priceMinInput = document.getElementById("search-price-min");
  const priceMaxInput = document.getElementById("search-price-max");

  let activeSearchCategory = "all";

  if (categoryList) {
    const categories = getCategoryList();
    categoryList.innerHTML = `
      <button class="side-category active" type="button" data-category="all">All plants</button>
      ${categories.map(category => `<button class="side-category" type="button" data-category="${escapeHtml(category)}">${escapeHtml(category)}</button>`).join("")}
    `;
  }

  const suggestions = document.createElement("div");
  suggestions.id = "search-suggestions";
  suggestions.className = "search-suggestions";
  suggestions.setAttribute("aria-label", "Suggested plants");
  searchInput.insertAdjacentElement("afterend", suggestions);

  function matchesFilters(plant) {
    if (activeSearchCategory !== "all") {
      const categories = (plant.categories || []).map(category => category.toLowerCase());
      if (!categories.includes(activeSearchCategory.toLowerCase())) return false;
    }

    const min = priceMinInput && priceMinInput.value !== "" ? Number(priceMinInput.value) : null;
    const max = priceMaxInput && priceMaxInput.value !== "" ? Number(priceMaxInput.value) : null;

    if (min !== null && Number.isFinite(min) && plant.price < min) return false;
    if (max !== null && Number.isFinite(max) && plant.price > max) return false;

    return true;
  }

  function getSearchRelevance(plant, normalizedSearch) {
    if (!normalizedSearch) return 0;

    const name = plant.name.toLowerCase();
    const description = plant.description.toLowerCase();
    const categories = (plant.categories || []).map(category => category.toLowerCase());
    const requirements = (plant.requirements || []).map(requirement => requirement.toLowerCase());
    const nameWords = name.split(/\s+/);

    let score = 0;

    if (name === normalizedSearch) score += 1000;
    if (name.startsWith(normalizedSearch)) score += 700;
    if (nameWords.some(word => word.startsWith(normalizedSearch))) score += 520;
    if (name.includes(normalizedSearch)) score += 420;
    if (categories.some(category => category === normalizedSearch)) score += 320;
    if (categories.some(category => category.startsWith(normalizedSearch))) score += 260;
    if (categories.some(category => category.includes(normalizedSearch))) score += 210;
    if (requirements.some(requirement => requirement.toLowerCase().includes(normalizedSearch))) score += 120;
    if (description.includes(normalizedSearch)) score += 80;

    score -= Math.max(name.length - normalizedSearch.length, 0) * 0.5;
    return score;
  }

  function showResults(searchText) {
    const normalizedSearch = searchText.trim().toLowerCase();
    const filteredPlants = getPlants()
      .map((plant, originalIndex) => ({
        plant,
        originalIndex,
        relevance: getSearchRelevance(plant, normalizedSearch)
      }))
      .filter(item => (!normalizedSearch || item.relevance > 0) && matchesFilters(item.plant))
      .sort((first, second) =>
        second.relevance - first.relevance ||
        first.originalIndex - second.originalIndex
      )
      .map(item => item.plant);

    if (!filteredPlants.length) {
      resultsGrid.innerHTML = `<p class="empty-state">No plants match these filters.</p>`;
      return;
    }

    resultsGrid.innerHTML = filteredPlants.map(plantCardTemplate).join("");
    setupPlantImageSliders();
    setupPlantCards();
  }

  function hideSuggestions() {
    suggestions.classList.remove("is-open");
    suggestions.innerHTML = "";
  }

  function showSuggestions(searchText) {
    const normalizedSearch = searchText.trim().toLowerCase();

    if (!normalizedSearch) {
      hideSuggestions();
      return;
    }

    const matchingPlants = getPlants()
      .filter(plant => plant.name.toLowerCase().includes(normalizedSearch))
      .sort((first, second) => {
        const firstStarts = first.name.toLowerCase().startsWith(normalizedSearch) ? 0 : 1;
        const secondStarts = second.name.toLowerCase().startsWith(normalizedSearch) ? 0 : 1;
        return firstStarts - secondStarts || first.name.localeCompare(second.name);
      })
      .slice(0, 6);

    if (!matchingPlants.length) {
      hideSuggestions();
      return;
    }

    suggestions.innerHTML = matchingPlants.map(plant => `
      <button class="search-suggestion" type="button" data-name="${escapeHtml(plant.name)}">
        ${escapeHtml(plant.name)}
      </button>
    `).join("");
    suggestions.classList.add("is-open");
  }

  const initialQuery = new URLSearchParams(window.location.search).get("q") || "";
  searchInput.value = initialQuery;
  showResults(initialQuery);
  showSuggestions(initialQuery);

  searchInput.addEventListener("input", () => {
    showResults(searchInput.value);
    showSuggestions(searchInput.value);
  });

  searchInput.addEventListener("keydown", event => {
    if (event.key === "Escape") {
      hideSuggestions();
    }

    if (event.key === "Enter") {
      const firstSuggestion = suggestions.querySelector(".search-suggestion");
      if (firstSuggestion && suggestions.classList.contains("is-open")) {
        event.preventDefault();
        searchInput.value = firstSuggestion.dataset.name;
        hideSuggestions();
        showResults(searchInput.value);
      }
    }
  });

  suggestions.addEventListener("click", event => {
    const suggestion = event.target.closest(".search-suggestion");
    if (!suggestion) return;

    searchInput.value = suggestion.dataset.name;
    hideSuggestions();
    showResults(searchInput.value);
    searchInput.focus();
  });

  if (categoryList) {
    categoryList.addEventListener("click", event => {
      const button = event.target.closest(".side-category");
      if (!button) return;

      activeSearchCategory = button.dataset.category || "all";
      categoryList.querySelectorAll(".side-category").forEach(chip => {
        chip.classList.toggle("active", chip === button);
      });
      showResults(searchInput.value);
    });
  }

  if (priceMinInput) {
    priceMinInput.addEventListener("input", () => showResults(searchInput.value));
  }

  if (priceMaxInput) {
    priceMaxInput.addEventListener("input", () => showResults(searchInput.value));
  }
}

function setupContactForm() {
  const form = document.getElementById("contact-form");
  if (!form) return;

  const message = document.getElementById("contact-message");

  form.addEventListener("submit", event => {
    event.preventDefault();

    const name = document.getElementById("contact-name").value.trim();
    const email = document.getElementById("contact-email").value.trim();
    const subject = document.getElementById("contact-subject").value.trim() || "Plantovia question";
    const body = document.getElementById("contact-body").value.trim();

    if (!name || !email || !body) {
      if (message) message.textContent = "Please add your name, email, and message.";
      return;
    }

    const emailBody = [
      body,
      "",
      `From: ${name}`,
      `Reply email: ${email}`
    ].join("\n");

    window.location.href = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(emailBody)}`;

    if (message) {
      message.textContent = "Your email is ready to send to plantovia.shop@gmail.com.";
    }
  });
}

function setupAccountPage() {
  const signupBtn = document.getElementById("signup-btn");
  const signinBtn = document.getElementById("signin-btn");
  const accountMessage = document.getElementById("account-message");
  const historyPanel = document.getElementById("purchase-history");
  const statusBox = document.getElementById("account-status-box");
  const statusEmail = document.getElementById("account-status-email");
  const signupBox = document.getElementById("signup-box");
  const signinBox = document.getElementById("signin-box");
  const resetBox = document.getElementById("reset-password-box");
  const forgotBtn = document.getElementById("forgot-password-btn");
  const resetBtn = document.getElementById("reset-password-btn");
  const client = getSupabaseClient();

  if (!signupBtn || !signinBtn || !accountMessage) return;

  const signupUsernameInput = document.getElementById("signup-username");
  const signupPasswordInput = document.getElementById("signup-password");
  const signinUsernameInput = document.getElementById("signin-username");
  const signinPasswordInput = document.getElementById("signin-password");

  function resetAuthFields() {
    if (signupUsernameInput) signupUsernameInput.value = "";
    if (signupPasswordInput) signupPasswordInput.value = "";
    if (signinUsernameInput) signinUsernameInput.value = localStorage.getItem("lastSignInEmail") || "";
    if (signinPasswordInput) signinPasswordInput.value = "";
  }

  resetAuthFields();
  setTimeout(resetAuthFields, 80);

  const accountNotice = sessionStorage.getItem("plantoviaAccountNotice");
  if (accountNotice) {
    accountMessage.textContent = accountNotice;
    sessionStorage.removeItem("plantoviaAccountNotice");
  }

  function showAuthView(mode) {
    if (statusBox) statusBox.hidden = mode !== "signed-in";
    if (signupBox) signupBox.hidden = mode !== "signed-out";
    if (signinBox) signinBox.hidden = mode !== "signed-out";
    if (resetBox) resetBox.hidden = mode !== "reset";
  }

  function urlIndicatesPasswordRecovery() {
    const query = new URLSearchParams(window.location.search);
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    if (query.get("type") === "recovery" || hash.get("type") === "recovery") return true;

    // Supabase's PKCE flow redirects here with only "?code=..." and no "type" param.
    // The only place account.html is ever sent a bare auth code is the password-reset
    // redirectTo, so treat that as a recovery link too.
    return query.has("code");
  }

  let inPasswordRecovery = urlIndicatesPasswordRecovery();

  function updateAccountView() {
    if (inPasswordRecovery) {
      showAuthView("reset");
      return;
    }

    const currentUser = getCurrentUser();
    if (currentUser) {
      if (statusEmail) statusEmail.textContent = currentUser;
      showAuthView("signed-in");
    } else {
      showAuthView("signed-out");
    }
  }

  function enterPasswordRecoveryView() {
    inPasswordRecovery = true;
    showAuthView("reset");
    accountMessage.textContent = "Choose a new password to finish resetting your account.";
  }

  document.addEventListener("plantovia:password-recovery", enterPasswordRecoveryView);
  if (passwordRecoveryPending || inPasswordRecovery) enterPasswordRecoveryView();

  async function loadSupabaseAccount() {
    updateAccountView();

    if (!client) return;

    const { data } = await client.auth.getUser();

    if (data && data.user) {
      localStorage.setItem("currentUser", data.user.email);
      localStorage.removeItem("adminSession");
    } else if (getCurrentUser()) {
      localStorage.removeItem("currentUser");
    }

    updateUserDisplay();
    updateAccountView();
  }

  signupBtn.addEventListener("click", async () => {
    const username = document.getElementById("signup-username").value.trim();
    const password = document.getElementById("signup-password").value.trim();

    if (!username || !password) {
      accountMessage.textContent = "Enter a username and password.";
      return;
    }

    if (!client) {
      accountMessage.textContent = "Online accounts are temporarily unavailable. Please try again later.";
      return;
    }

    if (!username.includes("@")) {
      accountMessage.textContent = "Use an email address for online accounts.";
      return;
    }

    if (password.length < 8) {
      accountMessage.textContent = "Use a password with at least 8 characters.";
      return;
    }

    const { data, error } = await client.auth.signUp({
      email: username,
      password,
      options: { emailRedirectTo: `${window.location.origin}/confirmed.html` }
    });

    if (error) {
      accountMessage.textContent = error.message;
      return;
    }

    if (data.user && !data.session) {
      accountMessage.textContent = "Account created. Check your inbox and confirm your email, then sign in below.";
      updateAccountView();
      return;
    }

    localStorage.setItem("currentUser", data.user ? data.user.email : username);
    localStorage.setItem("lastSignInEmail", data.user ? data.user.email : username);
    localStorage.removeItem("adminSession");
    accountMessage.textContent = "Account created.";
    updateUserDisplay();
    updateAccountView();
  });

  signinBtn.addEventListener("click", async () => {
    const username = document.getElementById("signin-username").value.trim();
    const password = document.getElementById("signin-password").value.trim();

    if (!client) {
      accountMessage.textContent = "Online accounts are temporarily unavailable. Please try again later.";
      return;
    }

    const { data, error } = await client.auth.signInWithPassword({ email: username, password });

    if (error) {
      accountMessage.textContent = error.message;
      return;
    }

    if (await getBlockedAccountStatus(data.user.id)) {
      await client.auth.signOut();
      localStorage.removeItem("currentUser");
      accountMessage.textContent = "This Plantovia account has been blocked. Contact plantovia.shop@gmail.com for help.";
      updateAccountView();
      return;
    }

    localStorage.setItem("currentUser", data.user.email);
    localStorage.setItem("lastSignInEmail", data.user.email);
    localStorage.removeItem("adminSession");
    accountMessage.innerHTML = isAdminUser(data.user.email)
      ? `Signed in as admin. <a href="admin.html">Open admin panel</a>.`
      : "Signed in.";
    updateUserDisplay();
    updateAccountView();
  });

  document.addEventListener("click", async event => {
    const signoutButton = event.target.closest("#customer-signout");
    if (!signoutButton) return;

    if (client) await client.auth.signOut();
    localStorage.removeItem("currentUser");
    localStorage.removeItem("adminSession");
    accountMessage.textContent = "Signed out.";
    updateUserDisplay();
    updateAccountView();
  });

  if (forgotBtn) {
    forgotBtn.addEventListener("click", async () => {
      const email = document.getElementById("signin-username").value.trim();

      if (!email) {
        accountMessage.textContent = "Enter your email address above, then choose \"Forgot your password?\" again.";
        document.getElementById("signin-username").focus();
        return;
      }

      if (!client) {
        accountMessage.textContent = "Online accounts are temporarily unavailable. Please try again later.";
        return;
      }

      forgotBtn.disabled = true;
      const { error } = await client.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/account.html`
      });
      forgotBtn.disabled = false;

      accountMessage.textContent = error
        ? error.message
        : "If that email has a Plantovia account, a password reset link has been sent.";
    });
  }

  if (resetBtn) {
    resetBtn.addEventListener("click", async () => {
      const newPassword = document.getElementById("reset-password-new").value.trim();

      if (newPassword.length < 8) {
        accountMessage.textContent = "Use a password with at least 8 characters.";
        return;
      }

      if (!client) {
        accountMessage.textContent = "Online accounts are temporarily unavailable. Please try again later.";
        return;
      }

      resetBtn.disabled = true;
      resetBtn.textContent = "Updating...";
      const { data, error } = await client.auth.updateUser({ password: newPassword });
      resetBtn.disabled = false;
      resetBtn.textContent = "Update Password";

      if (error) {
        accountMessage.textContent = error.message;
        return;
      }

      if (data.user) {
        localStorage.setItem("currentUser", data.user.email);
        localStorage.removeItem("adminSession");
      }

      passwordRecoveryPending = false;
      inPasswordRecovery = false;
      window.history.replaceState(null, "", window.location.pathname);
      accountMessage.textContent = "Password updated. You're signed in.";
      updateUserDisplay();
      updateAccountView();
    });
  }

  loadSupabaseAccount();
}

function setupPurchaseHistoryPage() {
  const historyPanel = document.getElementById("purchase-history");
  if (!historyPanel) return;

  const client = getSupabaseClient();

  let customerOrders = [];
  let historyFiltersOpen = false;
  const historyFilters = { minPrice: "", maxPrice: "", startDate: "", endDate: "" };
  let historyCalendarMonth = new Date();
  historyCalendarMonth = new Date(historyCalendarMonth.getFullYear(), historyCalendarMonth.getMonth(), 1);

  function historyFilterCount() {
    return Object.values(historyFilters).filter(value => String(value).trim()).length;
  }

  function visibleHistoryOrders() {
    const min = historyFilters.minPrice === "" ? null : Number(historyFilters.minPrice);
    const max = historyFilters.maxPrice === "" ? null : Number(historyFilters.maxPrice);

    return customerOrders.filter(order => {
      const total = Number(order.totals?.total || 0);
      if (min !== null && Number.isFinite(min) && total < min) return false;
      if (max !== null && Number.isFinite(max) && total > max) return false;
      const created = dateKeyFromDate(new Date(order.createdAt || order.created_at));
      if (historyFilters.startDate && created < historyFilters.startDate) return false;
      if (historyFilters.endDate && created > historyFilters.endDate) return false;
      return true;
    });
  }

  function historyFilterTemplate() {
    if (!historyFiltersOpen) return "";
    return `
      <section class="admin-filter-panel" aria-label="Order filters">
        <div class="admin-filter-fields history-filter-fields">
          <label>Minimum total<input id="history-filter-min" type="number" min="0" step="0.01" value="${escapeHtml(historyFilters.minPrice)}" placeholder="No minimum"></label>
          <label>Maximum total<input id="history-filter-max" type="number" min="0" step="0.01" value="${escapeHtml(historyFilters.maxPrice)}" placeholder="No maximum"></label>
        </div>
        <div class="admin-filter-calendar-wrap">
          <div><p class="eyebrow">Date range</p><p>Choose a start and end day, or select the entire displayed month.</p></div>
          ${buildDateRangeCalendar(historyCalendarMonth, historyFilters)}
        </div>
        <button class="button secondary admin-clear-filters" type="button">Clear Filters</button>
      </section>`;
  }

  function orderHistoryTemplate(orders) {
    return `
      <div class="order-history-list">
        ${orders.map(order => {
          const items = order.items || [];
          const totals = order.totals || {};
          const confirmation = order.confirmation?.signature ? order.confirmation : null;
          const confirmedAt = confirmation?.signed_at || confirmation?.confirmedAt || null;
          const date = new Date(order.createdAt || order.created_at).toLocaleDateString("en-CA", {
            year: "numeric",
            month: "short",
            day: "numeric"
          });

          return `
            <article class="order-history-card">
              <div class="order-history-header">
                <div>
                  <p class="eyebrow">${escapeHtml(order.status || "Received")}</p>
                  <h2>${escapeHtml(order.id || order.order_number || "Order")}</h2>
                  <span class="order-payment-status">${escapeHtml(order.paymentStatus || order.payment_status || "Awaiting e-transfer")}</span>
                </div>
                <strong>${date}</strong>
              </div>
              <div class="history-line-items">
                ${items.map(item => `
                  <p>
                    <span>${escapeHtml(item.name)} x ${item.quantity}</span>
                    <strong>$${Number(item.price * item.quantity || 0).toFixed(2)}</strong>
                  </p>
                `).join("")}
              </div>
              <div class="history-totals">
                <p>Subtotal <span>$${Number(totals.subtotal || 0).toFixed(2)}</span></p>
                <p>HST <span>$${Number(totals.tax || 0).toFixed(2)}</span></p>
                <p>Local delivery <span>$${Number(totals.shipping || 0).toFixed(2)}</span></p>
                <h3>Total <span>$${Number(totals.total || 0).toFixed(2)}</span></h3>
              </div>
              <div class="order-confirmation">
                ${confirmation ? `
                  <p class="confirmation-stamp">Received confirmed by <strong>${escapeHtml(confirmation.signature)}</strong> on ${new Date(confirmedAt).toLocaleDateString("en-CA")}.</p>
                  <p class="proof-reference">Proof reference: ${escapeHtml(String(confirmation.proof_hash || "saved").slice(0, 16))}</p>
                ` : `
                  <p>Confirm only after the complete order has arrived in acceptable condition.</p>
                  <label>
                    E-signature
                    <input class="confirmation-signature" type="text" minlength="2" maxlength="120" autocomplete="name" placeholder="Type your full legal name">
                  </label>
                  <label class="confirmation-consent">
                    <input class="confirmation-ack" type="checkbox">
                    <span>I confirm that I received this order in acceptable condition and agree that my typed name is my electronic signature.</span>
                  </label>
                  <button class="button secondary confirm-order-received" type="button" data-order-id="${escapeHtml(order.id || order.order_number)}">Confirm Order Received</button>
                `}
              </div>
            </article>
          `;
        }).join("")}
      </div>
    `;
  }

  function renderHistoryList() {
    if (!getCurrentUser()) {
      historyPanel.innerHTML = `<p class="empty-state">Sign in to view your purchase history. <a href="account.html">Sign in</a></p>`;
      return;
    }

    if (!customerOrders.length) {
      historyPanel.innerHTML = `<p class="empty-state">No purchases yet. Your completed orders will appear here.</p>`;
      return;
    }

    const matches = visibleHistoryOrders();

    historyPanel.innerHTML = `
      <div class="history-filter-bar">
        <button class="button secondary history-filter-toggle" type="button" aria-expanded="${historyFiltersOpen}">Filters${historyFilterCount() ? ` (${historyFilterCount()})` : ""}</button>
      </div>
      ${historyFilterTemplate()}
      <p class="admin-result-count">${matches.length} matching ${matches.length === 1 ? "order" : "orders"}</p>
      ${matches.length ? orderHistoryTemplate(matches) : '<p class="empty-state">No orders match these filters.</p>'}
    `;
  }

  async function loadPurchaseHistory() {
    const currentUser = getCurrentUser();

    if (!currentUser) {
      customerOrders = [];
      historyPanel.innerHTML = `<p class="empty-state">Sign in to view your purchase history. <a href="account.html">Sign in</a></p>`;
      return;
    }

    if (client) {
      const { data: userData } = await client.auth.getUser();

      if (!userData || !userData.user) {
        customerOrders = [];
        historyPanel.innerHTML = `<p class="empty-state">Sign in to view your purchase history. <a href="account.html">Sign in</a></p>`;
        return;
      }

      const { data: rows, error } = await client
        .from("orders")
        .select("*")
        .eq("user_id", userData.user.id)
        .order("created_at", { ascending: false });

      if (error) {
        customerOrders = [];
        historyPanel.innerHTML = `<p class="empty-state">${escapeHtml(error.message)}</p>`;
        return;
      }

      customerOrders = (rows || []).map(databaseOrderToRecord);
      renderHistoryList();
      return;
    }

    const history = getLocalPurchaseHistory();
    customerOrders = history[currentUser] || [];
    renderHistoryList();
  }

  historyPanel.addEventListener("input", event => {
    const fields = { "history-filter-min": "minPrice", "history-filter-max": "maxPrice" };
    const key = fields[event.target.id];
    if (!key) return;

    historyFilters[key] = event.target.value;
    const id = event.target.id;
    renderHistoryList();

    const input = document.getElementById(id);
    if (input) {
      input.focus();
      if (input.setSelectionRange) input.setSelectionRange(input.value.length, input.value.length);
    }
  });

  historyPanel.addEventListener("click", async event => {
    if (event.target.closest(".history-filter-toggle")) {
      historyFiltersOpen = !historyFiltersOpen;
      renderHistoryList();
      return;
    }

    const monthButton = event.target.closest(".admin-calendar-month");
    if (monthButton) {
      historyCalendarMonth = new Date(
        historyCalendarMonth.getFullYear(),
        historyCalendarMonth.getMonth() + (monthButton.dataset.direction === "next" ? 1 : -1),
        1
      );
        renderHistoryList();
        return;
      }

      const dayButton = event.target.closest(".admin-calendar-day");
      if (dayButton) {
        pickCalendarRangeDate(historyFilters, dayButton.dataset.date);
        renderHistoryList();
        return;
      }

      if (event.target.closest(".admin-use-month")) {
        historyFilters.startDate = dateKeyFromDate(new Date(historyCalendarMonth.getFullYear(), historyCalendarMonth.getMonth(), 1));
        historyFilters.endDate = dateKeyFromDate(new Date(historyCalendarMonth.getFullYear(), historyCalendarMonth.getMonth() + 1, 0));
        renderHistoryList();
        return;
      }

      if (event.target.closest(".admin-clear-filters")) {
        Object.keys(historyFilters).forEach(key => { historyFilters[key] = ""; });
        renderHistoryList();
        return;
      }

      const confirmButton = event.target.closest(".confirm-order-received");
      if (!confirmButton) return;

      const card = confirmButton.closest(".order-history-card");
      const signatureInput = card.querySelector(".confirmation-signature");
      const confirmationAck = card.querySelector(".confirmation-ack");
      const signature = signatureInput.value.trim();

      if (signature.length < 2) {
        signatureInput.focus();
        return;
      }

      if (!confirmationAck?.checked) {
        confirmationAck?.focus();
        return;
      }

      const confirmed = window.confirm("Confirm that this complete order was received in acceptable condition?");
      if (!confirmed) return;

      confirmButton.textContent = "Saving...";

      try {
        await saveOrderConfirmation(confirmButton.dataset.orderId, signature);
        await loadPurchaseHistory();
      } catch (error) {
        confirmButton.textContent = error.message;
      }
    });

  loadPurchaseHistory();
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function setupAdminPage() {
  const adminPanel = document.getElementById("admin-panel");
  if (!adminPanel || adminPanel.dataset.adminView !== "plants") return;
  const client = getSupabaseClient();
  const adminView = adminPanel.dataset.adminView === "plants" ? "plants" : "orders";

  function renderBackendLogin() {
    adminPanel.innerHTML = `
      <section class="admin-locked">
        <h2>Backend admin login</h2>
        <p>Only the authorized Plantovia admin account can open catalogue and order records.</p>
        <label>Email</label>
        <input id="backend-admin-email" type="email" placeholder="Admin email">
        <label>Password</label>
        <input id="backend-admin-password" type="password" placeholder="Password">
        <button id="backend-admin-login" class="button primary" type="button">Sign In</button>
        <p id="backend-admin-message" class="form-message"></p>
      </section>
    `;
  }

  function renderUnauthorized(email = "") {
    adminPanel.innerHTML = `
      <section class="admin-locked">
        <h2>Authorized admin only</h2>
        <p>${email ? `${escapeHtml(email)} is signed in, but this account is not authorized to view Plantovia orders.` : "The secure backend is unavailable."}</p>
        <a class="button primary" href="account.html">Open account page</a>
      </section>
    `;
  }

  async function startAdmin() {
    if (client) {
      const { data } = await client.auth.getSession();
      if (!data.session) {
        renderBackendLogin();
        return;
      }

      const sessionEmail = String(data.session.user?.email || "").toLowerCase();
      if (sessionEmail !== ADMIN_EMAIL) {
        renderUnauthorized(sessionEmail);
        return;
      }
    } else {
      renderUnauthorized();
      return;
    }

    if (adminView === "orders") await loadAdminOrders();
    renderAdmin();
  }

  if (!client) {
    renderUnauthorized();
    return;
  }

  let editablePlants = getPlants();
  let featuredIds = getFeaturedPlantIds();
  let editableCategories = getCategoryList();
  let adminSearchText = "";
  let adminOrders = [];
  let adminOrderSearchText = "";
  let adminOrdersError = "";

  async function loadAdminOrders() {
    adminOrdersError = "";
    const { data, error } = await client
      .from("orders")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(250);

    if (error) {
      adminOrdersError = error.message;
      adminOrders = [];
      return;
    }

    adminOrders = (data || []).map(databaseOrderToRecord);
  }

  function getNewPlantTemplate() {
    const baseName = "New Plant";
    const ids = new Set(editablePlants.map(plant => plant.id));
    let id = createSlug(baseName);
    let index = 2;

    while (ids.has(id)) {
      id = `${createSlug(baseName)}-${index}`;
      index++;
    }

    return normalizePlant({
      id,
      name: baseName,
      price: 0,
      images: ["assets/hero-aquascape.png"],
      description: "Add a short plant description here.",
      requirements: ["Light: Low to medium", "CO2: Not required", "Difficulty: Easy"],
      status: "good",
      categories: ["Easy care"]
    });
  }

  function getVisibleAdminPlants() {
    const searchText = adminSearchText.trim().toLowerCase();
    if (!searchText) return editablePlants;

    return editablePlants.filter(plant =>
      plant.name.toLowerCase().includes(searchText) ||
      plant.id.toLowerCase().includes(searchText) ||
      plant.description.toLowerCase().includes(searchText) ||
      (plant.categories || []).some(category => category.toLowerCase().includes(searchText))
    );
  }

  function renderAdminCategoryCheckboxes(plant) {
    const plantCategories = plant.categories || [];

    return editableCategories.map(category => `
      <label class="admin-chip-check">
        <input type="checkbox" class="admin-category" value="${escapeHtml(category)}" ${plantCategories.includes(category) ? "checked" : ""}>
        <span>${escapeHtml(category)}</span>
      </label>
    `).join("");
  }

  function renderAdminCategoryManager() {
    return editableCategories.map(category => `
      <span class="admin-category-pill">
        ${escapeHtml(category)}
        <button class="remove-category" type="button" data-category="${escapeHtml(category)}" aria-label="Remove ${escapeHtml(category)} category">×</button>
      </span>
    `).join("");
  }

  function getVisibleAdminOrders() {
    const searchText = adminOrderSearchText.trim().toLowerCase();
    if (!searchText) return adminOrders;

    return adminOrders.filter(order => {
      const delivery = order.deliveryInfo || {};
      const itemNames = (order.items || []).map(item => item.name).join(" ");
      return [order.id, order.customerEmail, delivery.name, delivery.phone, delivery.address,
        delivery.city, delivery.postal, order.status, order.paymentStatus, itemNames]
        .some(value => String(value || "").toLowerCase().includes(searchText));
    });
  }

  function renderAdminOrders() {
    const visibleOrders = getVisibleAdminOrders();
    const awaitingPayment = adminOrders.filter(order => order.paymentStatus === "Awaiting e-transfer").length;
    const confirmedDeliveries = adminOrders.filter(order => order.confirmation?.signature).length;

    return `
      <section class="admin-orders" aria-labelledby="admin-orders-title">
        <div class="admin-orders-heading">
          <div>
            <p class="eyebrow">Order desk</p>
            <h2 id="admin-orders-title">Orders and delivery proof</h2>
            <p>${adminOrders.length} saved orders | ${awaitingPayment} awaiting e-transfer | ${confirmedDeliveries} deliveries confirmed</p>
          </div>
          <button id="refresh-admin-orders" class="button secondary" type="button">Refresh Orders</button>
        </div>
        <label class="admin-order-search">
          Search orders
          <input id="admin-order-search" type="search" placeholder="Search name, order number, phone, email, or plant" value="${escapeHtml(adminOrderSearchText)}" autocomplete="off">
        </label>
        ${adminOrdersError ? `<p class="form-message">${escapeHtml(adminOrdersError)}</p>` : ""}
        <div class="admin-order-list">
          ${visibleOrders.length ? visibleOrders.map(order => {
            const delivery = order.deliveryInfo || {};
            const totals = order.totals || {};
            const confirmation = order.confirmation?.signature ? order.confirmation : null;
            const signedAt = confirmation?.signed_at || confirmation?.confirmedAt || "";
            return `
              <article class="admin-order-card" data-order-id="${escapeHtml(order.id)}">
                <div class="admin-order-card-head">
                  <div>
                    <p class="eyebrow">${escapeHtml(order.paymentStatus)}</p>
                    <h3>${escapeHtml(order.id)}</h3>
                    <p>${new Date(order.createdAt).toLocaleString("en-CA", { dateStyle: "medium", timeStyle: "short" })}</p>
                  </div>
                  <strong>${formatCad(totals.total || 0)}</strong>
                </div>
                <div class="admin-order-columns">
                  <div>
                    <h4>Customer and delivery</h4>
                    <p><strong>${escapeHtml(delivery.name || "Customer")}</strong></p>
                    <p><a href="mailto:${encodeURIComponent(order.customerEmail || "")}">${escapeHtml(order.customerEmail || "No email")}</a></p>
                    <p>${escapeHtml(delivery.phone || "No phone")}</p>
                    <p>${escapeHtml([delivery.address, delivery.city, delivery.postal].filter(Boolean).join(", "))}</p>
                  </div>
                  <div>
                    <h4>Items</h4>
                    ${(order.items || []).map(item => `
                      <p class="admin-order-item"><span>${escapeHtml(item.name)} x ${Number(item.quantity || 0)}</span><strong>${formatCad(Number(item.price || 0) * Number(item.quantity || 0))}</strong></p>
                    `).join("")}
                  </div>
                </div>
                <div class="admin-order-controls">
                  <label class="admin-payment-check">
                    <input class="admin-order-payment-received" type="checkbox" ${order.paymentStatus === "Paid" ? "checked" : ""}>
                    <span>
                      <strong>E-transfer received</strong>
                      <small>${order.paymentStatus === "Paid" ? "Payment confirmed" : "Awaiting payment"}</small>
                    </span>
                  </label>
                  <label>Fulfillment
                    <select class="admin-order-status">
                      ${["Order submitted", "Preparing", "Out for delivery", "Delivered", "Cancelled"].map(status => `<option ${order.status === status ? "selected" : ""}>${status}</option>`).join("")}
                    </select>
                  </label>
                  <button class="save-admin-order button primary" type="button">Save Fulfillment</button>
                </div>
                <div class="admin-delivery-proof ${confirmation ? "is-confirmed" : ""}">
                  ${confirmation ? `
                    <h4>Signed delivery confirmation</h4>
                    <p><strong>${escapeHtml(confirmation.signature)}</strong> signed on ${new Date(signedAt).toLocaleString("en-CA", { dateStyle: "long", timeStyle: "short" })}.</p>
                    <p>${escapeHtml(confirmation.statement || "Order received.")}</p>
                    <p>Signer account: ${escapeHtml(confirmation.signed_by_email || order.customerEmail || "")}</p>
                    <p class="proof-reference">Proof hash: ${escapeHtml(confirmation.proof_hash || "Legacy confirmation")}</p>
                  ` : `<p>No customer delivery confirmation has been signed yet.</p>`}
                </div>
              </article>
            `;
          }).join("") : `<p class="empty-state">No orders match this search.</p>`}
        </div>
      </section>
    `;
  }

  function renderAdmin() {
    const visiblePlants = getVisibleAdminPlants();
    const siteSettings = getSiteSettings();

    if (adminView === "orders") {
      adminPanel.innerHTML = `
        <div class="admin-view-actions">
          <a class="button secondary" href="admin-plants.html">Open Plant Catalogue</a>
          <button id="backend-admin-logout" class="button secondary" type="button">Sign Out</button>
        </div>
        ${renderAdminOrders()}
      `;
      return;
    }

    adminPanel.innerHTML = `
      <div class="admin-toolbar">
        <div>
          <h2>Catalogue</h2>
          <p>${editablePlants.length} plants available. ${visiblePlants.length} shown.</p>
        </div>
        <div class="admin-toolbar-actions">
          <button id="add-plant" class="button primary" type="button">Add Plant</button>
          ${client ? `<button id="backend-admin-logout" class="button secondary">Sign Out</button>` : ""}
        </div>
      </div>
      <div class="admin-control-strip">
        <label>
          Search plants
          <input id="admin-search" type="search" placeholder="Name, category, or description" value="${escapeHtml(adminSearchText)}">
        </label>
        <label>
          Create category
          <span class="admin-inline-add">
            <input id="admin-new-category" type="text" placeholder="Example: Beginner bundle">
            <button id="add-category" class="button secondary" type="button">Add</button>
          </span>
        </label>
        <label>
          Free Mississauga shipping above CAD
          <span class="admin-inline-add">
            <input id="admin-free-shipping-threshold" type="number" min="0" step="0.01" value="${Number(siteSettings.freeMississaugaShippingThreshold || 0)}">
          </span>
        </label>
        <label>
          Delivery fee under that amount
          <span class="admin-inline-add">
            <input id="admin-delivery-fee" type="number" min="0" step="0.01" value="${Number(siteSettings.mississaugaDeliveryFee || 0)}">
            <button id="save-site-settings" class="button secondary" type="button">Save</button>
          </span>
        </label>
        <div class="admin-category-manager" aria-label="Current categories">
          ${renderAdminCategoryManager()}
        </div>
      </div>
      <div class="admin-grid">
        ${visiblePlants.map(plant => {
          const plantIndex = editablePlants.findIndex(item => item.id === plant.id);

          return `
          <section class="admin-card" data-id="${plant.id}">
            <div class="admin-card-header">
              <div>
                <p class="eyebrow">${plant.id}</p>
                <h2>${escapeHtml(plant.name)}</h2>
              </div>
              <div class="admin-card-tools">
                <button class="order-plant" data-direction="up" type="button" ${plantIndex === 0 ? "disabled" : ""} aria-label="Move ${escapeHtml(plant.name)} up">↑</button>
                <button class="order-plant" data-direction="down" type="button" ${plantIndex === editablePlants.length - 1 ? "disabled" : ""} aria-label="Move ${escapeHtml(plant.name)} down">↓</button>
                <button class="delete-plant" type="button" aria-label="Remove ${escapeHtml(plant.name)}">Remove</button>
                <label class="featured-toggle">
                  <input type="checkbox" class="admin-featured" ${featuredIds.includes(plant.id) ? "checked" : ""}>
                  Featured
                </label>
              </div>
            </div>

            <label>Plant name</label>
            <input class="admin-name" type="text" value="${escapeHtml(plant.name)}">

            <label>Price</label>
            <input class="admin-price" type="number" min="0" step="0.01" value="${plant.price}">

            <label>Status</label>
            <select class="admin-status">
              <option value="good" ${plant.status !== "low" ? "selected" : ""}>Good stock</option>
              <option value="low" ${plant.status === "low" ? "selected" : ""}>Low on stock</option>
            </select>

            <label>Description</label>
            <textarea class="admin-description" rows="4">${escapeHtml(plant.description)}</textarea>

            <label>Care requirements</label>
            <textarea class="admin-requirements" rows="3">${escapeHtml((plant.requirements || []).join("\n"))}</textarea>

            <label>Category tags</label>
            <div class="admin-category-options">
              ${renderAdminCategoryCheckboxes(plant)}
            </div>

            <label>Images</label>
            <div class="admin-images">
              ${(plant.images || []).map((image, index) => `
                <div class="admin-image">
                  <img src="${image}" alt="${plant.name} image ${index + 1}" style="--admin-bg-image: url('${image}')">
                  <button class="remove-image" data-index="${index}" type="button">Remove</button>
                </div>
              `).join("")}
            </div>

            <input class="admin-image-upload" type="file" accept="image/*" multiple>
            <button class="save-plant button primary" type="button">Save Plant</button>
          </section>
        `}).join("")}
      </div>
    `;
  }

  function getPlantFromCard(card) {
    const plantId = card.dataset.id;
    const plant = editablePlants.find(item => item.id === plantId);

    return {
      ...plant,
      name: card.querySelector(".admin-name").value.trim() || plant.name,
      price: Number(card.querySelector(".admin-price").value || 0),
      status: card.querySelector(".admin-status").value,
      description: card.querySelector(".admin-description").value.trim(),
      requirements: card.querySelector(".admin-requirements").value
        .split("\n")
        .map(requirement => requirement.trim())
        .filter(Boolean),
      categories: [...card.querySelectorAll(".admin-category:checked")].map(input => input.value)
    };
  }

  adminPanel.addEventListener("click", async event => {
    const backendLoginButton = event.target.closest("#backend-admin-login");
    if (backendLoginButton && client) {
      const email = document.getElementById("backend-admin-email").value.trim();
      const password = document.getElementById("backend-admin-password").value;
      const message = document.getElementById("backend-admin-message");

      client.auth.signInWithPassword({ email, password }).then(async ({ data, error }) => {
        if (error) {
          message.textContent = error.message;
          return;
        }

        if (String(data.user?.email || "").toLowerCase() !== ADMIN_EMAIL) {
          await client.auth.signOut();
          renderUnauthorized(email);
          return;
        }

        localStorage.setItem("currentUser", data.user.email);
        editablePlants = getPlants();
        featuredIds = getFeaturedPlantIds();
        editableCategories = getCategoryList();
        if (adminView === "orders") await loadAdminOrders();
        renderAdmin();
      });
      return;
    }

    const backendLogoutButton = event.target.closest("#backend-admin-logout");
    if (backendLogoutButton && client) {
      client.auth.signOut().then(() => {
        localStorage.removeItem("currentUser");
        renderBackendLogin();
      });
      return;
    }

    const refreshOrdersButton = event.target.closest("#refresh-admin-orders");
    if (refreshOrdersButton) {
      refreshOrdersButton.disabled = true;
      refreshOrdersButton.textContent = "Refreshing...";
      await loadAdminOrders();
      renderAdmin();
      return;
    }

    const saveAdminOrderButton = event.target.closest(".save-admin-order");
    if (saveAdminOrderButton) {
      const card = saveAdminOrderButton.closest(".admin-order-card");
      const orderId = card.dataset.orderId;
      const paymentStatus = card.querySelector(".admin-order-payment-received").checked ? "Paid" : "Awaiting e-transfer";
      const status = card.querySelector(".admin-order-status").value;
      saveAdminOrderButton.disabled = true;
      saveAdminOrderButton.textContent = "Saving...";

      const { error } = await client
        .from("orders")
        .update({
          payment_status: paymentStatus,
          status,
          updated_at: new Date().toISOString()
        })
        .eq("order_number", orderId);

      if (error) {
        saveAdminOrderButton.disabled = false;
        saveAdminOrderButton.textContent = error.message;
        return;
      }

      adminOrders = adminOrders.map(order => order.id === orderId
        ? { ...order, paymentStatus, status }
        : order);
      renderAdmin();
      return;
    }

    const addPlantButton = event.target.closest("#add-plant");
    if (addPlantButton) {
      const newPlant = getNewPlantTemplate();
      editablePlants = [newPlant, ...editablePlants];
      savePlants(editablePlants);
      adminSearchText = "";
      Promise.resolve(client ? savePlantsToBackend(editablePlants) : null)
        .catch(error => console.error("Add plant failed:", error));
      renderAdmin();
      return;
    }

    const saveSiteSettingsButton = event.target.closest("#save-site-settings");
    if (saveSiteSettingsButton) {
      const thresholdInput = document.getElementById("admin-free-shipping-threshold");
      const deliveryFeeInput = document.getElementById("admin-delivery-fee");
      const nextSettings = {
        freeMississaugaShippingThreshold: Number(thresholdInput.value || 0),
        mississaugaDeliveryFee: Number(deliveryFeeInput.value || 0)
      };

      saveSiteSettings(nextSettings);
      saveSiteSettingsButton.textContent = "Saving...";

      Promise.resolve(client ? saveSiteSettingsToBackend(getSiteSettings()) : null)
        .then(() => {
          saveSiteSettingsButton.textContent = "Saved";
          updateShippingStatement();
          setTimeout(() => {
            saveSiteSettingsButton.textContent = "Save";
          }, 1200);
        })
        .catch(error => {
          saveSiteSettingsButton.textContent = error.message;
        });
      return;
    }

    const addCategoryButton = event.target.closest("#add-category");
    if (addCategoryButton) {
      const input = document.getElementById("admin-new-category");
      const category = normalizeCategoryName(input.value);
      if (!category) return;

      editableCategories = uniqueValues([...editableCategories, category]);
      saveCategories(editableCategories);
      Promise.resolve(client ? saveCategoriesToBackend(editableCategories) : null)
        .catch(error => console.error("Category save failed:", error));
      renderAdmin();
      return;
    }

    const removeCategoryButton = event.target.closest(".remove-category");
    if (removeCategoryButton) {
      const category = removeCategoryButton.dataset.category;
      editableCategories = editableCategories.filter(item => item !== category);
      editablePlants = editablePlants.map(plant => ({
        ...plant,
        categories: (plant.categories || []).filter(item => item !== category)
      }));
      saveCategories(editableCategories);
      savePlants(editablePlants);

      Promise.resolve(client ? Promise.all([
        saveCategoriesToBackend(editableCategories),
        savePlantsToBackend(editablePlants)
      ]) : null)
        .catch(error => console.error("Category removal failed:", error));

      renderAdmin();
      return;
    }

    const orderButton = event.target.closest(".order-plant");
    if (orderButton) {
      const plantId = orderButton.closest(".admin-card").dataset.id;
      const currentIndex = editablePlants.findIndex(plant => plant.id === plantId);
      const nextIndex = orderButton.dataset.direction === "up" ? currentIndex - 1 : currentIndex + 1;

      if (nextIndex < 0 || nextIndex >= editablePlants.length) return;

      [editablePlants[currentIndex], editablePlants[nextIndex]] = [editablePlants[nextIndex], editablePlants[currentIndex]];
      savePlants(editablePlants);
      Promise.resolve(client ? savePlantsToBackend(editablePlants) : null)
        .catch(error => console.error("Order save failed:", error));
      renderAdmin();
      return;
    }

    const removeButton = event.target.closest(".remove-image");
    if (removeButton) {
      const card = removeButton.closest(".admin-card");
      const plant = editablePlants.find(item => item.id === card.dataset.id);
      const imageIndex = Number(removeButton.dataset.index);
      plant.images.splice(imageIndex, 1);
      if (!plant.images.length) plant.images.push("assets/hero-aquascape.png");
      savePlants(editablePlants);
      if (client) savePlantToBackend(plant).catch(error => console.error("Image removal failed:", error));
      renderAdmin();
      return;
    }

    const deletePlantButton = event.target.closest(".delete-plant");
    if (deletePlantButton) {
      const card = deletePlantButton.closest(".admin-card");
      const plantId = card.dataset.id;
      const plant = editablePlants.find(item => item.id === plantId);
      const confirmed = window.confirm(`Remove ${plant.name} from the catalogue? This will remove it from the public site too.`);

      if (!confirmed) return;

      editablePlants = editablePlants.filter(item => item.id !== plantId);
      featuredIds = featuredIds.filter(id => id !== plantId);
      savePlants(editablePlants);
      saveFeaturedPlantIds(featuredIds);
      deletePlantButton.textContent = "Removing...";

      Promise.resolve(client ? deletePlantFromBackend(plantId).then(() => saveFeaturedToBackend(featuredIds)) : null)
        .then(() => {
          renderAdmin();
        })
        .catch(error => {
          deletePlantButton.textContent = error.message;
        });
      return;
    }

    const saveButton = event.target.closest(".save-plant");
    if (saveButton) {
      const card = saveButton.closest(".admin-card");
      const updatedPlant = getPlantFromCard(card);
      editablePlants = editablePlants.map(plant => plant.id === updatedPlant.id ? updatedPlant : plant);
      savePlants(editablePlants);
      saveButton.textContent = "Saving...";

      Promise.resolve(client ? savePlantToBackend(updatedPlant) : null)
        .then(() => {
          saveButton.textContent = "Saved";
          setTimeout(() => {
            saveButton.textContent = "Save Plant";
          }, 1200);
        })
        .catch(error => {
          saveButton.textContent = error.message;
        });
    }
  });

  adminPanel.addEventListener("input", event => {
    const orderSearchInput = event.target.closest("#admin-order-search");
    if (orderSearchInput) {
      adminOrderSearchText = orderSearchInput.value;
      renderAdmin();
      const nextOrderSearch = document.getElementById("admin-order-search");
      if (nextOrderSearch) {
        nextOrderSearch.focus();
        nextOrderSearch.setSelectionRange(nextOrderSearch.value.length, nextOrderSearch.value.length);
      }
      return;
    }

    const searchInput = event.target.closest("#admin-search");
    if (!searchInput) return;

    adminSearchText = searchInput.value;
    renderAdmin();
    const nextSearchInput = document.getElementById("admin-search");
    if (nextSearchInput) {
      nextSearchInput.focus();
      nextSearchInput.setSelectionRange(nextSearchInput.value.length, nextSearchInput.value.length);
    }
  });

  adminPanel.addEventListener("change", async event => {
    const paymentReceivedCheckbox = event.target.closest(".admin-order-payment-received");
    if (paymentReceivedCheckbox) {
      const card = paymentReceivedCheckbox.closest(".admin-order-card");
      const orderId = card.dataset.orderId;
      const paymentStatus = paymentReceivedCheckbox.checked ? "Paid" : "Awaiting e-transfer";
      const previousStatus = paymentReceivedCheckbox.checked ? "Awaiting e-transfer" : "Paid";
      paymentReceivedCheckbox.disabled = true;

      const { error } = await client
        .from("orders")
        .update({
          payment_status: paymentStatus,
          updated_at: new Date().toISOString()
        })
        .eq("order_number", orderId);

      if (error) {
        paymentReceivedCheckbox.checked = previousStatus === "Paid";
        paymentReceivedCheckbox.disabled = false;
        window.alert(`Payment status could not be saved: ${error.message}`);
        return;
      }

      adminOrders = adminOrders.map(order => order.id === orderId
        ? { ...order, paymentStatus }
        : order);
      renderAdmin();
      return;
    }

    const featuredToggle = event.target.closest(".admin-featured");
    if (featuredToggle) {
      const plantId = featuredToggle.closest(".admin-card").dataset.id;
      featuredIds = featuredToggle.checked
        ? [...new Set([...featuredIds, plantId])]
        : featuredIds.filter(id => id !== plantId);
      saveFeaturedPlantIds(featuredIds);
      if (client) saveFeaturedToBackend(featuredIds).catch(error => console.error("Featured save failed:", error));
      return;
    }

    const uploadInput = event.target.closest(".admin-image-upload");
    if (uploadInput && uploadInput.files.length) {
      const card = uploadInput.closest(".admin-card");
      const plant = editablePlants.find(item => item.id === card.dataset.id);
      const newImages = client
        ? await uploadPlantImages(plant.id, uploadInput.files)
        : await Promise.all([...uploadInput.files].map(fileToDataUrl));

      plant.images = [...(plant.images || []), ...newImages].filter(Boolean);
      savePlants(editablePlants);
      if (client) await savePlantToBackend(plant);
      renderAdmin();
    }
  });

  startAdmin();
}

function safeRun(label, fn) {
  try {
    fn();
  } catch (error) {
    console.error(`Plantovia: ${label} failed`, error);
  }
}

async function safeRunAsync(label, fn) {
  try {
    await fn();
  } catch (error) {
    console.error(`Plantovia: ${label} failed`, error);
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  // Failsafe: page content must never stay permanently invisible just because
  // [data-reveal] elements never received their .is-visible class. This runs
  // independently of everything below, so even an unexpected failure elsewhere
  // can't leave the page looking blank.
  setTimeout(() => {
    document.querySelectorAll("[data-reveal]:not(.is-visible)").forEach(el => el.classList.add("is-visible"));
  }, 2000);

  safeRun("setupIntroAnimation", setupIntroAnimation);
  await safeRunAsync("ensureBackendDataLoaded", ensureBackendDataLoaded);
  await safeRunAsync("enforceBlockedAccountSession", enforceBlockedAccountSession);
  safeRun("setupSidePanel", setupSidePanel);
  safeRun("renderPlants", renderPlants);
  safeRun("setupSlider", setupSlider);
  safeRun("setupCartPage", setupCartPage);
  safeRun("setupDeliveryPage", setupDeliveryPage);
  safeRun("setupPaymentPage", setupPaymentPage);
  safeRun("setupSuccessPage", setupSuccessPage);
  safeRun("setupAccountPage", setupAccountPage);
  safeRun("setupPurchaseHistoryPage", setupPurchaseHistoryPage);
  safeRun("setupSearchPage", setupSearchPage);
  safeRun("setupContactForm", setupContactForm);
  safeRun("setupAdminPage", setupAdminPage);
  safeRun("updateShippingStatement", updateShippingStatement);
  safeRun("updateUserDisplay", updateUserDisplay);
  safeRun("updateHeaderCart", updateHeaderCart);
  safeRun("setupHeaderAutoHide", setupHeaderAutoHide);
  safeRun("setupScrollEffects", setupScrollEffects);
  safeRun("setupBackToTop", setupBackToTop);
});

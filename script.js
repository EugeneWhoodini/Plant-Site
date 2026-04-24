let cart = JSON.parse(localStorage.getItem("cart")) || [];

const TAX_RATE = 0.13;
const SHIPPING_COST = 1.00;

const EMAILJS_PUBLIC_KEY = "mYsVEfGV4fqyvVSXu";
const EMAILJS_SERVICE_ID = "service_r88ycqr";
const EMAILJS_TEMPLATE_ID = "template_qsa5879";

if (typeof emailjs !== "undefined") {
  emailjs.init(EMAILJS_PUBLIC_KEY);
}

function saveCart() {
  localStorage.setItem("cart", JSON.stringify(cart));
}

function getCurrentUser() {
  return localStorage.getItem("currentUser");
}

function updateUserDisplay() {
  const userDisplay = document.getElementById("user-display");
  const currentUser = getCurrentUser();

  if (userDisplay) {
    userDisplay.textContent = currentUser ? currentUser : "Guest";
  }
}

function calculateCartTotals() {
  let subtotal = 0;

  cart.forEach(item => {
    subtotal += item.price * item.quantity;
  });

  const tax = subtotal * TAX_RATE;
  const shipping = subtotal > 0 ? SHIPPING_COST : 0;
  const total = subtotal + tax + shipping;

  return { subtotal, tax, shipping, total };
}

function updateHeaderCart() {
  const cartCount = document.getElementById("cart-count");
  const cartTotal = document.getElementById("cart-total");

  if (!cartCount || !cartTotal) return;

  let totalItems = 0;

  cart.forEach(item => {
    totalItems += item.quantity;
  });

  const totals = calculateCartTotals();

  cartCount.textContent = totalItems;
  cartTotal.textContent = totals.subtotal.toFixed(2);
}

function setupSlider() {
  const slider = document.querySelector(".image-slider");
  if (!slider) return;

  const track = slider.querySelector(".image-track");
  const images = slider.querySelectorAll("img");
  const leftArrow = slider.querySelector(".left");
  const rightArrow = slider.querySelector(".right");

  const featuredCard = document.getElementById("featured-card");
  const featuredName = document.getElementById("featured-name");
  const featuredPrice = document.getElementById("featured-price");
  const featuredDescription = document.getElementById("featured-description");
  const featuredRequirements = document.getElementById("featured-requirements");

  const qtyDisplay = document.getElementById("featured-quantity");
  const incBtn = document.getElementById("featured-increase");
  const decBtn = document.getElementById("featured-decrease");
  const addBtn = document.getElementById("featured-add-to-cart");

  const featuredPlants = [
    {
      name: "Red Tiger Lotus",
      price: 14.99,
      image: "Insert image file location here",
      description: "Insert appropriate info here",
      requirements: [
        "Insert appropriate info here",
        "Insert appropriate info here",
        "Insert appropriate info here"
      ]
    },
    {
      name: "Bucephalandra Blue",
      price: 18.50,
      image: "Insert image file location here",
      description: "Insert appropriate info here",
      requirements: [
        "Insert appropriate info here",
        "Insert appropriate info here",
        "Insert appropriate info here"
      ]
    },
    {
      name: "Rotala Blood Red",
      price: 7.99,
      image: "Insert image file location here",
      description: "Insert appropriate info here",
      requirements: [
        "Insert appropriate info here",
        "Insert appropriate info here",
        "Insert appropriate info here"
      ]
    }
  ];

  let currentIndex = 0;
  let quantity = 1;

  function updateFeaturedInfo() {
    const plant = featuredPlants[currentIndex];

    featuredName.textContent = plant.name;
    featuredPrice.textContent = plant.price.toFixed(2);
    featuredDescription.textContent = plant.description;

    featuredRequirements.innerHTML = "";

    plant.requirements.forEach(requirement => {
      const li = document.createElement("li");
      li.textContent = requirement;
      featuredRequirements.appendChild(li);
    });

    featuredCard.dataset.name = plant.name;
    featuredCard.dataset.price = plant.price;
    featuredCard.dataset.image = plant.image;

    quantity = 1;
    qtyDisplay.textContent = quantity;
  }

  function updateSlider() {
    track.style.transform = `translateX(-${currentIndex * 100}%)`;
    updateFeaturedInfo();
  }

  rightArrow.addEventListener("click", () => {
    currentIndex = (currentIndex + 1) % images.length;
    updateSlider();
  });

  leftArrow.addEventListener("click", () => {
    currentIndex = (currentIndex - 1 + images.length) % images.length;
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
    const name = featuredCard.dataset.name;
    const price = Number(featuredCard.dataset.price);
    const image = featuredCard.dataset.image;

    const existingItem = cart.find(item => item.name === name);

    if (existingItem) {
      existingItem.quantity += quantity;
    } else {
      cart.push({ name, price, image, quantity });
    }

    saveCart();
    updateHeaderCart();

    quantity = 1;
    qtyDisplay.textContent = quantity;
  });

  updateFeaturedInfo();
}

function setupPlantCards() {
  const plantCards = document.querySelectorAll(".plant-card");

  plantCards.forEach(card => {
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
      const name = card.dataset.name;
      const price = Number(card.dataset.price);
      const image = card.dataset.image;

      const existingItem = cart.find(item => item.name === name);

      if (existingItem) {
        existingItem.quantity += quantity;
      } else {
        cart.push({ name, price, image, quantity });
      }

      saveCart();
      updateHeaderCart();

      quantity = 1;
      quantityText.textContent = quantity;
    });
  });
}

function setupCartPage() {
  const cartItemsContainer = document.getElementById("cart-items");
  const subtotalElement = document.getElementById("cart-subtotal");
  const taxElement = document.getElementById("cart-tax");
  const shippingElement = document.getElementById("cart-shipping");
  const totalElement = document.getElementById("cart-page-total");
  const clearCartBtn = document.getElementById("clear-cart");

  if (!cartItemsContainer) return;

  function renderCart() {
    cartItemsContainer.innerHTML = "";

    if (cart.length === 0) {
      cartItemsContainer.innerHTML = "<p>Your cart is empty.</p>";
    }

    cart.forEach((item, index) => {
      const itemDiv = document.createElement("div");
      itemDiv.classList.add("cart-item");

      itemDiv.innerHTML = `
        <img src="${item.image}" alt="${item.name}">
        <div>
          <h3>${item.name}</h3>
          <p>Price per piece: $${item.price.toFixed(2)}</p>
          <p>Quantity in cart: ${item.quantity}</p>
          <p>Item total: $${(item.price * item.quantity).toFixed(2)}</p>

          <div class="cart-remove-control">
            <button class="remove-decrease" data-index="${index}">-</button>
            <span class="remove-amount" data-index="${index}">1</span>
            <button class="remove-increase" data-index="${index}">+</button>
          </div>

          <button class="remove-chosen" data-index="${index}">Remove Chosen Amount</button>
          <button class="remove-all" data-index="${index}">Remove All</button>
        </div>
      `;

      cartItemsContainer.appendChild(itemDiv);
    });

    updateCartPageTotals();
    setupRemoveButtons();
  }

  function updateCartPageTotals() {
    const totals = calculateCartTotals();

    if (subtotalElement) subtotalElement.textContent = totals.subtotal.toFixed(2);
    if (taxElement) taxElement.textContent = totals.tax.toFixed(2);
    if (shippingElement) shippingElement.textContent = totals.shipping.toFixed(2);
    if (totalElement) totalElement.textContent = totals.total.toFixed(2);
  }

  function setupRemoveButtons() {
    const removeAmounts = {};

    document.querySelectorAll(".remove-amount").forEach(span => {
      const index = span.dataset.index;
      removeAmounts[index] = 1;
    });

    document.querySelectorAll(".remove-increase").forEach(button => {
      button.addEventListener("click", () => {
        const index = button.dataset.index;
        const item = cart[index];

        if (removeAmounts[index] < item.quantity) {
          removeAmounts[index]++;
        }

        document.querySelector(`.remove-amount[data-index="${index}"]`).textContent = removeAmounts[index];
      });
    });

    document.querySelectorAll(".remove-decrease").forEach(button => {
      button.addEventListener("click", () => {
        const index = button.dataset.index;

        if (removeAmounts[index] > 1) {
          removeAmounts[index]--;
        }

        document.querySelector(`.remove-amount[data-index="${index}"]`).textContent = removeAmounts[index];
      });
    });

    document.querySelectorAll(".remove-chosen").forEach(button => {
      button.addEventListener("click", () => {
        const index = Number(button.dataset.index);
        const amountToRemove = removeAmounts[index];

        if (amountToRemove >= cart[index].quantity) {
          cart.splice(index, 1);
        } else {
          cart[index].quantity -= amountToRemove;
        }

        saveCart();
        renderCart();
        updateHeaderCart();
      });
    });

    document.querySelectorAll(".remove-all").forEach(button => {
      button.addEventListener("click", () => {
        const index = Number(button.dataset.index);

        cart.splice(index, 1);

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

  if (!saveDeliveryBtn) return;

  saveDeliveryBtn.addEventListener("click", () => {
    const deliveryInfo = {
      name: document.getElementById("delivery-name").value.trim(),
      phone: document.getElementById("delivery-phone").value.trim(),
      email: document.getElementById("delivery-email").value.trim(),
      address: document.getElementById("delivery-address").value.trim(),
      city: document.getElementById("delivery-city").value.trim(),
      postal: document.getElementById("delivery-postal").value.trim()
    };

    if (
      !deliveryInfo.name ||
      !deliveryInfo.phone ||
      !deliveryInfo.email ||
      !deliveryInfo.address ||
      !deliveryInfo.city ||
      !deliveryInfo.postal
    ) {
      message.textContent = "Please fill in all delivery fields.";
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

  if (!placeOrderBtn) return;

  const totals = calculateCartTotals();

  if (subtotalElement) subtotalElement.textContent = totals.subtotal.toFixed(2);
  if (taxElement) taxElement.textContent = totals.tax.toFixed(2);
  if (shippingElement) shippingElement.textContent = totals.shipping.toFixed(2);
  if (totalElement) totalElement.textContent = totals.total.toFixed(2);

  placeOrderBtn.addEventListener("click", async () => {
    const deliveryInfo = JSON.parse(localStorage.getItem("deliveryInfo")) || null;

    if (cart.length === 0) {
      message.textContent = "Cart empty.";
      return;
    }

    if (!deliveryInfo) {
      message.textContent = "Missing delivery info.";
      return;
    }

    message.textContent = "Redirecting to Stripe payment...";

    try {
      const response = await fetch("/api/create-checkout-session", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          cart: cart,
          deliveryInfo: deliveryInfo
        })
      });

      const data = await response.json();

if (!response.ok) {
  message.textContent = "Stripe error: " + data.error;
  return;
}

window.location.href = data.url;

    } catch (err) {
      console.error("Stripe error:", err);
      message.textContent = "Payment failed.";
    }
  });
}

function sendOrderEmailAfterPayment() {
  const deliveryInfo = JSON.parse(localStorage.getItem("deliveryInfo")) || null;
  const cartData = JSON.parse(localStorage.getItem("cart")) || [];

  if (!deliveryInfo || cartData.length === 0) return;

  const totals = calculateCartTotals();

  const orderDetails = cartData.map(item =>
    `${item.name} | Qty: ${item.quantity} | $${item.price}`
  ).join("\n");

  const templateParams = {
    order_id: Date.now(),
    customer_name: deliveryInfo.name,
    customer_email: deliveryInfo.email,
    customer_phone: deliveryInfo.phone,
    customer_address: `${deliveryInfo.address}, ${deliveryInfo.city}, ${deliveryInfo.postal}`,
    order_details: orderDetails,
    subtotal: totals.subtotal.toFixed(2),
    tax: totals.tax.toFixed(2),
    shipping: totals.shipping.toFixed(2),
    total: totals.total.toFixed(2)
  };

  emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, templateParams)
    .then(() => {
      console.log("Email sent after payment");

      // clear cart AFTER success
      localStorage.removeItem("cart");
    })
    .catch(err => {
      console.error("Email error:", err);
    });
}

function setupAccountPage() {
  const signupBtn = document.getElementById("signup-btn");
  const signinBtn = document.getElementById("signin-btn");
  const accountMessage = document.getElementById("account-message");

  if (!signupBtn || !signinBtn || !accountMessage) return;

  signupBtn.addEventListener("click", () => {
    const username = document.getElementById("signup-username").value.trim();
    const password = document.getElementById("signup-password").value.trim();

    if (!username || !password) {
      accountMessage.textContent = "Enter username and password.";
      return;
    }

    const users = JSON.parse(localStorage.getItem("users")) || [];
    const exists = users.find(user => user.username === username);

    if (exists) {
      accountMessage.textContent = "User already exists.";
      return;
    }

    users.push({ username, password });
    localStorage.setItem("users", JSON.stringify(users));

    accountMessage.textContent = "Account created.";
  });

  signinBtn.addEventListener("click", () => {
    const username = document.getElementById("signin-username").value.trim();
    const password = document.getElementById("signin-password").value.trim();

    const users = JSON.parse(localStorage.getItem("users")) || [];

    const found = users.find(user => {
      return user.username === username && user.password === password;
    });

    if (found) {
      localStorage.setItem("currentUser", username);
      accountMessage.textContent = "Signed in!";
      updateUserDisplay();
    } else {
      accountMessage.textContent = "Wrong credentials.";
    }
  });
}

setupSlider();
setupPlantCards();
setupCartPage();
setupDeliveryPage();
setupPaymentPage();
setupAccountPage();
updateUserDisplay();
updateHeaderCart();
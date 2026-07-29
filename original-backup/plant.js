document.addEventListener("DOMContentLoaded", async () => {
  if (window.ensureAquaFloraBackendDataLoaded) {
    await window.ensureAquaFloraBackendDataLoaded();
  }

  const params = new URLSearchParams(window.location.search);
  const plantId = params.get("id");
  const selectedPlant = getPlants().find(plant => plant.id === plantId);

  let detailQuantity = 1;
  let detailImageIndex = 0;

  const detailPage = document.querySelector(".plant-detail-page");
  const detailImage = document.getElementById("detail-image");
  const detailName = document.getElementById("detail-name");
  const detailPrice = document.getElementById("detail-price");
  const detailDescription = document.getElementById("detail-description");
  const detailRequirements = document.getElementById("detail-requirements");

  if (!selectedPlant) {
    detailPage.innerHTML = `
      <div class="form-page">
        <p class="eyebrow">Plant not found</p>
        <h1>This plant could not be found.</h1>
        <a href="index.html" class="button primary">Back to Shop</a>
      </div>
    `;
    return;
  }

  function updateDetailImage() {
    if (!detailImage) return;

    detailImage.src = selectedPlant.images[detailImageIndex] || "assets/hero-aquascape.png";
    detailImage.alt = selectedPlant.name;
    detailImage.closest(".plant-detail-image-box").style.setProperty("--detail-bg-image", `url('${detailImage.src}')`);
  }

  updateDetailImage();
  detailName.textContent = selectedPlant.name;
  detailPrice.textContent = "$" + selectedPlant.price.toFixed(2);
  detailDescription.textContent = selectedPlant.description;
  detailDescription.insertAdjacentHTML("beforebegin", `
    <div class="category-chip-row detail-tags">
      ${(selectedPlant.categories || []).map(category => `<span class="category-chip">${escapeHtml(category)}</span>`).join("")}
    </div>
  `);
  detailDescription.insertAdjacentHTML("beforebegin", `<span class="stock-badge ${selectedPlant.status === "low" ? "low-stock" : "good-stock"}">${getStatusLabel(selectedPlant.status)}</span>`);
  detailRequirements.innerHTML = selectedPlant.requirements.map(requirement => `<li>${requirement}</li>`).join("");

  const plusButton = document.getElementById("detail-plus");
  const minusButton = document.getElementById("detail-minus");
  const quantityDisplay = document.getElementById("detail-quantity");
  const addButton = document.getElementById("detail-add-cart");
  const rightButton = document.getElementById("detail-img-right");
  const leftButton = document.getElementById("detail-img-left");

  if (plusButton) {
    plusButton.addEventListener("click", () => {
      detailQuantity++;
      quantityDisplay.textContent = detailQuantity;
    });
  }

  if (minusButton) {
    minusButton.addEventListener("click", () => {
      if (detailQuantity > 1) {
        detailQuantity--;
        quantityDisplay.textContent = detailQuantity;
      }
    });
  }

  if (addButton) {
    addButton.addEventListener("click", () => {
      addToCart(selectedPlant, detailQuantity);
      if (typeof showAddToCartFeedback === "function") {
        showAddToCartFeedback(addButton, selectedPlant.name, detailQuantity);
      }
      detailQuantity = 1;
      quantityDisplay.textContent = detailQuantity;
    });
  }

  if (rightButton) {
    rightButton.addEventListener("click", () => {
      if (selectedPlant.images.length <= 1) return;

      detailImageIndex = (detailImageIndex + 1) % selectedPlant.images.length;
      updateDetailImage();
    });
  }

  if (leftButton) {
    leftButton.addEventListener("click", () => {
      if (selectedPlant.images.length <= 1) return;

      detailImageIndex = (detailImageIndex - 1 + selectedPlant.images.length) % selectedPlant.images.length;
      updateDetailImage();
    });
  }
});

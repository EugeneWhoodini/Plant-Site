// Get the plant id from the URL
const params = new URLSearchParams(window.location.search);
const plantId = params.get("id");

// Find the matching plant from plants.js
const selectedPlant = plants.find(function (plant) {
  return plant.id === plantId;
});

let detailQuantity = 1;

// If no plant is found, show an error message
if (!selectedPlant) {
  document.querySelector(".plant-detail-page").innerHTML = `
    <h2>Plant not found</h2>
    <p>This plant could not be found.</p>
    <a href="index.html">Go back to plants</a>
  `;
} else {
  // Fill the page with plant information
  document.getElementById("detail-image").src = selectedPlant.images[0];
  document.getElementById("detail-image").alt = selectedPlant.name;

  document.getElementById("detail-name").textContent = selectedPlant.name;
  document.getElementById("detail-price").textContent = "$" + selectedPlant.price.toFixed(2);
  document.getElementById("detail-description").textContent = selectedPlant.description;

  const requirementsList = document.getElementById("detail-requirements");
requirementsList.innerHTML = "";

selectedPlant.requirements.forEach(function (requirement) {
  const li = document.createElement("li");
  li.textContent = requirement;
  requirementsList.appendChild(li);
});
}

// Quantity plus button
document.getElementById("detail-plus").addEventListener("click", function () {
  detailQuantity++;
  document.getElementById("detail-quantity").textContent = detailQuantity;
});

// Quantity minus button
document.getElementById("detail-minus").addEventListener("click", function () {
  if (detailQuantity > 1) {
    detailQuantity--;
    document.getElementById("detail-quantity").textContent = detailQuantity;
  }
});

// Add to cart button
document.getElementById("detail-add-cart").addEventListener("click", function () {
  if (selectedPlant) {
    addToCart(selectedPlant, detailQuantity);
  }
});
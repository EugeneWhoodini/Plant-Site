(function () {
  "use strict";

  const PAGE_SIZE = 40;
  const FINAL_STATUSES = new Set(["Delivered", "Cancelled"]);

  window.PlantoviaOrdersAdmin = {
    start(panel, client, view, navigation) {
      let orders = [];
      let searchText = "";
      let page = 1;
      let loadError = "";
      let filtersOpen = false;
      let calendarMonth = new Date();
      calendarMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), 1);
      const filters = { phone: "", minPrice: "", maxPrice: "", startDate: "", endDate: "" };

      async function loadOrders() {
        loadError = "";
        const { data, error } = await client.from("orders").select("*")
          .order("created_at", { ascending: false }).limit(1000);
        if (error) {
          orders = [];
          loadError = error.message;
        } else {
          orders = (data || []).map(databaseOrderToRecord);
        }
      }

      function isFinalized(order) {
        return FINAL_STATUSES.has(order.status);
      }

      function stateClass(order) {
        if (isFinalized(order)) return "order-state-finalized";
        return order.paymentStatus === "Paid" ? "order-state-paid" : "order-state-unpaid";
      }

      function dateKey(date) {
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
      }

      function visibleOrders() {
        const query = searchText.trim().toLowerCase();
        const phone = filters.phone.replace(/\D/g, "");
        const min = filters.minPrice === "" ? null : Number(filters.minPrice);
        const max = filters.maxPrice === "" ? null : Number(filters.maxPrice);

        return orders.filter(order => {
          if (view === "finalized" ? !isFinalized(order) : isFinalized(order)) return false;
          const delivery = order.deliveryInfo || {};
          const items = (order.items || []).map(item => item.name).join(" ");
          const text = [order.id, order.customerEmail, delivery.name, delivery.phone, delivery.address,
            delivery.city, delivery.postal, order.status, order.paymentStatus, items]
            .map(value => String(value || "").toLowerCase());
          if (query && !text.some(value => value.includes(query))) return false;
          if (phone && !String(delivery.phone || "").replace(/\D/g, "").includes(phone)) return false;
          const total = Number(order.totals?.total || 0);
          if (min !== null && Number.isFinite(min) && total < min) return false;
          if (max !== null && Number.isFinite(max) && total > max) return false;
          const created = dateKey(new Date(order.createdAt));
          if (filters.startDate && created < filters.startDate) return false;
          if (filters.endDate && created > filters.endDate) return false;
          return true;
        });
      }

      function filterCount() {
        return Object.values(filters).filter(value => String(value).trim()).length;
      }

      function rangeLabel() {
        if (!filters.startDate) return "Any date";
        const start = new Date(`${filters.startDate}T12:00:00`).toLocaleDateString("en-CA", { dateStyle: "medium" });
        if (!filters.endDate) return start;
        const end = new Date(`${filters.endDate}T12:00:00`).toLocaleDateString("en-CA", { dateStyle: "medium" });
        return `${start} - ${end}`;
      }

      function calendarTemplate() {
        const year = calendarMonth.getFullYear();
        const month = calendarMonth.getMonth();
        const firstWeekday = new Date(year, month, 1).getDay();
        const dayCount = new Date(year, month + 1, 0).getDate();
        const cells = [];
        for (let blank = 0; blank < firstWeekday; blank += 1) {
          cells.push('<span class="admin-calendar-blank" aria-hidden="true"></span>');
        }
        for (let day = 1; day <= dayCount; day += 1) {
          const key = dateKey(new Date(year, month, day));
          const selected = key === filters.startDate || key === filters.endDate;
          const inRange = filters.startDate && filters.endDate && key > filters.startDate && key < filters.endDate;
          cells.push(`<button class="admin-calendar-day ${selected ? "selected" : ""} ${inRange ? "in-range" : ""}" data-date="${key}" type="button" aria-pressed="${selected ? "true" : "false"}">${day}</button>`);
        }
        return `
          <div class="admin-calendar">
            <div class="admin-calendar-header">
              <button class="admin-calendar-month" data-direction="previous" type="button" aria-label="Previous month">&#8249;</button>
              <strong>${calendarMonth.toLocaleDateString("en-CA", { month: "long", year: "numeric" })}</strong>
              <button class="admin-calendar-month" data-direction="next" type="button" aria-label="Next month">&#8250;</button>
            </div>
            <div class="admin-calendar-weekdays" aria-hidden="true">${["S", "M", "T", "W", "T", "F", "S"].map(day => `<span>${day}</span>`).join("")}</div>
            <div class="admin-calendar-grid">${cells.join("")}</div>
            <div class="admin-calendar-actions">
              <button class="button secondary admin-use-month" type="button">Use This Month</button>
              <span>${escapeHtml(rangeLabel())}</span>
            </div>
          </div>`;
      }

      function filterTemplate() {
        if (!filtersOpen) return "";
        return `
          <section class="admin-filter-panel" aria-label="Order filters">
            <div class="admin-filter-fields">
              <label>Customer phone<input id="admin-filter-phone" type="tel" value="${escapeHtml(filters.phone)}" placeholder="Any phone number"></label>
              <label>Minimum total<input id="admin-filter-min" type="number" min="0" step="0.01" value="${escapeHtml(filters.minPrice)}" placeholder="No minimum"></label>
              <label>Maximum total<input id="admin-filter-max" type="number" min="0" step="0.01" value="${escapeHtml(filters.maxPrice)}" placeholder="No maximum"></label>
            </div>
            <div class="admin-filter-calendar-wrap">
              <div><p class="eyebrow">Date range</p><p>Choose a start and end day, or select the entire displayed month.</p></div>
              ${calendarTemplate()}
            </div>
            <button class="button secondary admin-clear-filters" type="button">Clear Filters</button>
          </section>`;
      }

      function orderCard(order) {
        const delivery = order.deliveryInfo || {};
        const totals = order.totals || {};
        const confirmation = order.confirmation?.signature ? order.confirmation : null;
        const signedAt = confirmation?.signed_at || confirmation?.confirmedAt || "";
        return `
          <article class="admin-order-card ${stateClass(order)}" data-order-id="${escapeHtml(order.id)}">
            <div class="admin-order-card-head">
              <div><p class="eyebrow">${escapeHtml(order.paymentStatus)}</p><h3>${escapeHtml(order.id)}</h3><p>${new Date(order.createdAt).toLocaleString("en-CA", { dateStyle: "medium", timeStyle: "short" })}</p></div>
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
              <div><h4>Items</h4>${(order.items || []).map(item => `<p class="admin-order-item"><span>${escapeHtml(item.name)} x ${Number(item.quantity || 0)}</span><strong>${formatCad(Number(item.price || 0) * Number(item.quantity || 0))}</strong></p>`).join("")}</div>
            </div>
            <div class="admin-order-controls">
              <label class="admin-payment-check">
                <input class="admin-order-payment-received-v2" type="checkbox" ${order.paymentStatus === "Paid" ? "checked" : ""}>
                <span><strong>E-transfer received</strong><small>${order.paymentStatus === "Paid" ? "Payment confirmed" : "Awaiting payment"}</small></span>
              </label>
              <label>Fulfillment
                <select class="admin-order-status-v2">${["Order submitted", "Preparing", "Out for delivery", "Delivered", "Cancelled"].map(status => `<option ${order.status === status ? "selected" : ""}>${status}</option>`).join("")}</select>
              </label>
              <button class="save-admin-order-v2 button primary" type="button">Save Fulfillment</button>
            </div>
            <div class="admin-delivery-proof ${confirmation ? "is-confirmed" : ""}">
              ${confirmation ? `<h4>Signed delivery confirmation</h4><p><strong>${escapeHtml(confirmation.signature)}</strong> signed on ${new Date(signedAt).toLocaleString("en-CA", { dateStyle: "long", timeStyle: "short" })}.</p><p>${escapeHtml(confirmation.statement || "Order received.")}</p><p>Signer account: ${escapeHtml(confirmation.signed_by_email || order.customerEmail || "")}</p><p class="proof-reference">Proof hash: ${escapeHtml(confirmation.proof_hash || "Legacy confirmation")}</p>` : "<p>No customer delivery confirmation has been signed yet.</p>"}
            </div>
          </article>`;
      }

      function pagination(totalPages) {
        if (totalPages <= 1) return "";
        return `
          <nav class="admin-pagination" aria-label="Order pages">
            <button class="button secondary admin-order-page" data-direction="previous" type="button" ${page <= 1 ? "disabled" : ""}>Previous</button>
            <span>Page ${page} of ${totalPages}</span>
            <button class="button secondary admin-order-page" data-direction="next" type="button" ${page >= totalPages ? "disabled" : ""}>Next</button>
          </nav>`;
      }

      function render() {
        const matches = visibleOrders();
        const totalPages = Math.max(1, Math.ceil(matches.length / PAGE_SIZE));
        page = Math.min(page, totalPages);
        const pageOrders = matches.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
        const processingCount = orders.filter(order => !isFinalized(order)).length;
        const finalizedCount = orders.filter(isFinalized).length;
        const heading = view === "finalized" ? "Finalized orders" : "Processing orders";
        const summary = view === "finalized"
          ? `${finalizedCount} delivered or cancelled orders`
          : `${processingCount} active orders | ${orders.filter(order => !isFinalized(order) && order.paymentStatus !== "Paid").length} awaiting e-transfer`;

        panel.innerHTML = `
          ${navigation(view)}
          <section class="admin-orders" aria-labelledby="admin-orders-title">
            <div class="admin-orders-heading">
              <div><p class="eyebrow">Order desk</p><h2 id="admin-orders-title">${heading}</h2><p>${summary}</p></div>
              <div class="admin-order-heading-actions">
                <button class="button secondary admin-filter-toggle" type="button" aria-expanded="${filtersOpen}">Filters${filterCount() ? ` (${filterCount()})` : ""}</button>
                <button class="button secondary refresh-admin-orders-v2" type="button">Refresh Orders</button>
              </div>
            </div>
            <label class="admin-order-search">Search orders
              <input id="admin-order-search-v2" type="search" placeholder="Order number, customer, email, phone, address, plant, or status" value="${escapeHtml(searchText)}" autocomplete="off">
            </label>
            ${filterTemplate()}
            ${loadError ? `<p class="form-message">${escapeHtml(loadError)}</p>` : ""}
            <p class="admin-result-count">${matches.length} matching ${matches.length === 1 ? "order" : "orders"}</p>
            <div class="admin-order-list">${pageOrders.length ? pageOrders.map(orderCard).join("") : '<p class="empty-state">No orders match these filters.</p>'}</div>
            ${pagination(totalPages)}
          </section>`;
      }

      function refocus(id) {
        const input = document.getElementById(id);
        if (!input) return;
        input.focus();
        if (input.setSelectionRange) input.setSelectionRange(input.value.length, input.value.length);
      }

      panel.addEventListener("input", event => {
        const fields = {
          "admin-order-search-v2": ["search", ""],
          "admin-filter-phone": ["phone", ""],
          "admin-filter-min": ["minPrice", ""],
          "admin-filter-max": ["maxPrice", ""]
        };
        const match = fields[event.target.id];
        if (!match) return;
        if (match[0] === "search") searchText = event.target.value;
        else filters[match[0]] = event.target.value;
        page = 1;
        const id = event.target.id;
        render();
        refocus(id);
      });

      panel.addEventListener("click", async event => {
        if (event.target.closest(".refresh-admin-orders-v2")) {
          await loadOrders(); render(); return;
        }
        if (event.target.closest(".admin-filter-toggle")) {
          filtersOpen = !filtersOpen; render(); return;
        }
        const monthButton = event.target.closest(".admin-calendar-month");
        if (monthButton) {
          calendarMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + (monthButton.dataset.direction === "next" ? 1 : -1), 1);
          render(); return;
        }
        const dayButton = event.target.closest(".admin-calendar-day");
        if (dayButton) {
          const selected = dayButton.dataset.date;
          if (!filters.startDate || filters.endDate) {
            filters.startDate = selected; filters.endDate = "";
          } else if (selected < filters.startDate) {
            filters.endDate = filters.startDate; filters.startDate = selected;
          } else {
            filters.endDate = selected;
          }
          page = 1; render(); return;
        }
        if (event.target.closest(".admin-use-month")) {
          filters.startDate = dateKey(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), 1));
          filters.endDate = dateKey(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 0));
          page = 1; render(); return;
        }
        if (event.target.closest(".admin-clear-filters")) {
          Object.keys(filters).forEach(key => { filters[key] = ""; });
          page = 1; render(); return;
        }
        const pageButton = event.target.closest(".admin-order-page");
        if (pageButton) {
          page += pageButton.dataset.direction === "next" ? 1 : -1;
          render(); panel.scrollIntoView({ behavior: "smooth", block: "start" }); return;
        }
        const saveButton = event.target.closest(".save-admin-order-v2");
        if (!saveButton) return;
        const card = saveButton.closest(".admin-order-card");
        const orderId = card.dataset.orderId;
        const status = card.querySelector(".admin-order-status-v2").value;
        const paymentStatus = card.querySelector(".admin-order-payment-received-v2").checked ? "Paid" : "Awaiting e-transfer";
        saveButton.disabled = true;
        saveButton.textContent = "Saving...";
        const { error } = await client.from("orders").update({ status, payment_status: paymentStatus, updated_at: new Date().toISOString() }).eq("order_number", orderId);
        if (error) {
          saveButton.disabled = false; saveButton.textContent = error.message; return;
        }
        orders = orders.map(order => order.id === orderId ? { ...order, status, paymentStatus } : order);
        render();
      });

      panel.addEventListener("change", async event => {
        const checkbox = event.target.closest(".admin-order-payment-received-v2");
        if (!checkbox) return;
        const card = checkbox.closest(".admin-order-card");
        const orderId = card.dataset.orderId;
        const checked = checkbox.checked;
        const paymentStatus = checked ? "Paid" : "Awaiting e-transfer";
        checkbox.disabled = true;
        const { error } = await client.from("orders").update({ payment_status: paymentStatus, updated_at: new Date().toISOString() }).eq("order_number", orderId);
        if (error) {
          checkbox.checked = !checked; checkbox.disabled = false;
          window.alert(`Payment status could not be saved: ${error.message}`); return;
        }
        orders = orders.map(order => order.id === orderId ? { ...order, paymentStatus } : order);
        render();
      });

      loadOrders().then(render);
    }
  };
})();
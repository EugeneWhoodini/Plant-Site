(function () {
  "use strict";

  const RANGE_OPTIONS = [
    ["all", "All time"],
    ["30", "Last 30 days"],
    ["90", "Last 90 days"],
    ["365", "This year"]
  ];

  window.PlantoviaDashboardAdmin = {
    start(panel, client, navigation) {
      let orders = [];
      let loadError = "";
      let rangeFilter = "all";

      async function loadOrders() {
        loadError = "";
        const { data, error } = await client.from("orders").select("*")
          .order("created_at", { ascending: false }).limit(2000);
        if (error) {
          orders = [];
          loadError = error.message;
        } else {
          orders = (data || []).map(databaseOrderToRecord);
        }
      }

      function scopedOrders() {
        if (rangeFilter === "all") return orders;
        const days = Number(rangeFilter);
        const cutoff = Date.now() - days * 86400000;
        return orders.filter(order => new Date(order.createdAt).getTime() >= cutoff);
      }

      function computeStats() {
        const scoped = scopedOrders();
        const paidOrders = scoped.filter(order => order.paymentStatus === "Paid");
        const pendingOrders = scoped.filter(order => order.paymentStatus !== "Paid");
        const cancelledCount = scoped.filter(order => order.status === "Cancelled").length;

        const totalRevenue = paidOrders.reduce((sum, order) => sum + Number(order.totals?.total || 0), 0);
        const pendingRevenue = pendingOrders.reduce((sum, order) => sum + Number(order.totals?.total || 0), 0);
        const avgOrderValue = paidOrders.length ? totalRevenue / paidOrders.length : 0;

        const plantStats = new Map();
        paidOrders.forEach(order => {
          (order.items || []).forEach(item => {
            const key = item.id || item.name;
            if (!key) return;
            const existing = plantStats.get(key) || { id: key, name: item.name || "Unnamed plant", quantity: 0, revenue: 0, orders: 0 };
            existing.quantity += Number(item.quantity || 0);
            existing.revenue += Number(item.lineTotal != null ? item.lineTotal : Number(item.price || 0) * Number(item.quantity || 0));
            existing.orders += 1;
            plantStats.set(key, existing);
          });
        });

        const plantList = Array.from(plantStats.values());
        const byRevenue = [...plantList].sort((a, b) => b.revenue - a.revenue);
        const byQuantity = [...plantList].sort((a, b) => b.quantity - a.quantity);
        const lowest = [...plantList].sort((a, b) => a.quantity - b.quantity);

        return {
          orderCount: scoped.length,
          paidOrderCount: paidOrders.length,
          pendingOrderCount: pendingOrders.length,
          cancelledCount,
          totalRevenue,
          pendingRevenue,
          avgOrderValue,
          plantCount: plantList.length,
          topByRevenue: byRevenue.slice(0, 8),
          topByQuantity: byQuantity.slice(0, 8),
          lowestPerformers: lowest.slice(0, 5),
          maxRevenue: byRevenue.length ? byRevenue[0].revenue : 0,
          maxQuantity: byQuantity.length ? byQuantity[0].quantity : 0
        };
      }

      function rankList(items, valueKey, maxValue, formatValue) {
        if (!items.length) {
          return '<p class="empty-state">Not enough paid orders yet to rank plants.</p>';
        }
        return `
          <div class="dashboard-rank-list">
            ${items.map((entry, index) => {
              const pct = maxValue > 0 ? Math.max(4, Math.round((entry[valueKey] / maxValue) * 100)) : 0;
              return `
                <div class="dashboard-rank-row">
                  <span class="dashboard-rank-position">${index + 1}</span>
                  <div class="dashboard-rank-main">
                    <div class="dashboard-rank-label">
                      <strong>${escapeHtml(entry.name)}</strong>
                      <span>${formatValue(entry)}</span>
                    </div>
                    <div class="dashboard-rank-bar"><div class="dashboard-rank-fill" style="width:${pct}%"></div></div>
                  </div>
                </div>`;
            }).join("")}
          </div>`;
      }

      function render() {
        const stats = computeStats();

        panel.innerHTML = `
          ${navigation("dashboard")}
          <section class="admin-orders dashboard-panel" aria-labelledby="dashboard-title">
            <div class="admin-orders-heading">
              <div><p class="eyebrow">Admin</p><h2 id="dashboard-title">Revenue dashboard</h2><p>Track total revenue and see which plants sell the most and least.</p></div>
              <button class="button secondary refresh-admin-dashboard" type="button">Refresh Data</button>
            </div>

            <div class="dashboard-range-toggle" role="group" aria-label="Date range">
              ${RANGE_OPTIONS.map(([value, label]) => `<button class="dashboard-range-btn ${rangeFilter === value ? "active" : ""}" type="button" data-range="${value}">${label}</button>`).join("")}
            </div>

            ${loadError ? `<p class="form-message">${escapeHtml(loadError)}</p>` : ""}

            <div class="dashboard-stats">
              <div class="dashboard-stat-card dashboard-stat-highlight">
                <span class="dashboard-stat-label">Total revenue</span>
                <span class="dashboard-stat-value">${formatCad(stats.totalRevenue)}</span>
                <span class="dashboard-stat-sub">${stats.paidOrderCount} paid ${stats.paidOrderCount === 1 ? "order" : "orders"}</span>
              </div>
              <div class="dashboard-stat-card">
                <span class="dashboard-stat-label">Pending revenue</span>
                <span class="dashboard-stat-value">${formatCad(stats.pendingRevenue)}</span>
                <span class="dashboard-stat-sub">${stats.pendingOrderCount} awaiting e-transfer</span>
              </div>
              <div class="dashboard-stat-card">
                <span class="dashboard-stat-label">Average order value</span>
                <span class="dashboard-stat-value">${formatCad(stats.avgOrderValue)}</span>
                <span class="dashboard-stat-sub">Across paid orders</span>
              </div>
              <div class="dashboard-stat-card">
                <span class="dashboard-stat-label">Total orders</span>
                <span class="dashboard-stat-value">${stats.orderCount}</span>
                <span class="dashboard-stat-sub">${stats.cancelledCount} cancelled</span>
              </div>
              <div class="dashboard-stat-card">
                <span class="dashboard-stat-label">Plants sold</span>
                <span class="dashboard-stat-value">${stats.plantCount}</span>
                <span class="dashboard-stat-sub">Distinct plants with paid sales</span>
              </div>
            </div>

            <div class="dashboard-grid">
              <div class="dashboard-panel-card">
                <h3>Top sellers by quantity</h3>
                ${rankList(stats.topByQuantity, "quantity", stats.maxQuantity, entry => `${entry.quantity} sold`)}
              </div>
              <div class="dashboard-panel-card">
                <h3>Top earners by revenue</h3>
                ${rankList(stats.topByRevenue, "revenue", stats.maxRevenue, entry => formatCad(entry.revenue))}
              </div>
              <div class="dashboard-panel-card">
                <h3>Lowest performers</h3>
                <p class="dashboard-panel-note">Plants with the fewest paid sales in this range. Consider promoting or discounting these.</p>
                ${rankList(stats.lowestPerformers, "quantity", stats.maxQuantity, entry => `${entry.quantity} sold`)}
              </div>
            </div>
          </section>`;
      }

      panel.addEventListener("click", async event => {
        if (event.target.closest(".refresh-admin-dashboard")) {
          await loadOrders();
          render();
          return;
        }
        const rangeBtn = event.target.closest(".dashboard-range-btn");
        if (rangeBtn) {
          rangeFilter = rangeBtn.dataset.range;
          render();
        }
      });

      loadOrders().then(render);
    }
  };
})();

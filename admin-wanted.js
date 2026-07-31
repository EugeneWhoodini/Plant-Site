(function () {
  "use strict";

  window.PlantoviaWantedAdmin = {
    start(panel, client, navigation) {
      let requests = [];
      let loadError = "";

      async function loadRequests() {
        loadError = "";
        const { data, error } = await client
          .from("stock_requests")
          .select("plant_id,customer_email,created_at")
          .order("created_at", { ascending: false })
          .limit(5000);
        if (error) {
          requests = [];
          loadError = error.message;
        } else {
          requests = data || [];
        }
      }

      function computeDemand() {
        const plants = typeof getPlants === "function" ? getPlants() : [];
        const plantMap = new Map(plants.map(plant => [plant.id, plant]));
        const demand = new Map();

        requests.forEach(request => {
          const existing = demand.get(request.plant_id) || {
            id: request.plant_id,
            name: plantMap.get(request.plant_id)?.name || request.plant_id,
            status: plantMap.get(request.plant_id)?.status || "unknown",
            count: 0,
            lastRequested: request.created_at
          };
          existing.count += 1;
          if (new Date(request.created_at) > new Date(existing.lastRequested)) {
            existing.lastRequested = request.created_at;
          }
          demand.set(request.plant_id, existing);
        });

        return Array.from(demand.values()).sort((a, b) => b.count - a.count);
      }

      function render() {
        const demand = computeDemand();
        const maxCount = demand.length ? demand[0].count : 0;

        panel.innerHTML = `
          ${navigation("wanted")}
          <section class="admin-orders dashboard-panel" aria-labelledby="wanted-title">
            <div class="admin-orders-heading">
              <div>
                <p class="eyebrow">Admin</p>
                <h2 id="wanted-title">Wanted plants</h2>
                <p>Plants customers have asked to be notified about when they're back in stock, ranked by demand.</p>
              </div>
              <button class="button secondary refresh-admin-wanted" type="button">Refresh Data</button>
            </div>

            ${loadError ? `<p class="form-message">${escapeHtml(loadError)}</p>` : ""}

            ${!demand.length ? `<p class="empty-state">No stock requests yet.</p>` : `
              <div class="dashboard-rank-list wanted-list">
                ${demand.map(entry => {
                  const pct = maxCount > 0 ? Math.max(4, Math.round((entry.count / maxCount) * 100)) : 0;
                  return `
                    <div class="dashboard-rank-row wanted-row" data-plant-id="${escapeHtml(entry.id)}">
                      <div class="dashboard-rank-main">
                        <div class="dashboard-rank-label">
                          <strong>${escapeHtml(entry.name)}</strong>
                          <span class="stock-badge ${entry.status === "low" ? "low-stock" : "good-stock"}">${entry.status === "low" ? "Still out of stock" : "Restocked"}</span>
                        </div>
                        <div class="dashboard-rank-bar"><div class="dashboard-rank-fill" style="width:${pct}%"></div></div>
                        <p class="wanted-meta">${entry.count} ${entry.count === 1 ? "request" : "requests"} &middot; last requested ${new Date(entry.lastRequested).toLocaleDateString("en-CA", { dateStyle: "medium" })}</p>
                      </div>
                      <button class="button secondary clear-wanted-requests" type="button">Clear Requests</button>
                    </div>`;
                }).join("")}
              </div>
            `}
          </section>`;
      }

      panel.addEventListener("click", async event => {
        if (event.target.closest(".refresh-admin-wanted")) {
          await loadRequests();
          render();
          return;
        }

        const clearBtn = event.target.closest(".clear-wanted-requests");
        if (clearBtn) {
          const row = clearBtn.closest(".wanted-row");
          const plantId = row.dataset.plantId;
          clearBtn.disabled = true;
          clearBtn.textContent = "Clearing...";
          const { error } = await client.from("stock_requests").delete().eq("plant_id", plantId);
          if (error) {
            loadError = error.message;
            render();
            return;
          }
          await loadRequests();
          render();
        }
      });

      loadRequests().then(render);
    }
  };
})();

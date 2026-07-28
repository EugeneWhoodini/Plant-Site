(function () {
  "use strict";

  const PAGE_SIZE = 50;

  window.PlantoviaAccountsAdmin = {
    start(panel, client, navigation) {
      let accounts = [];
      let searchText = "";
      let page = 1;
      let loadError = "";

      async function loadAccounts() {
        loadError = "";
        const { data, error } = await client
          .from("profiles")
          .select("user_id,email,blocked,blocked_at,created_at,updated_at")
          .order("created_at", { ascending: false })
          .limit(1000);
        if (error) {
          accounts = [];
          loadError = error.message;
        } else {
          accounts = data || [];
        }
      }

      function visibleAccounts() {
        const query = searchText.trim().toLowerCase();
        if (!query) return accounts;
        return accounts.filter(account => [account.email, account.user_id, account.blocked ? "blocked" : "active"]
          .some(value => String(value || "").toLowerCase().includes(query)));
      }

      function renderPagination(totalPages) {
        if (totalPages <= 1) return "";
        return `
          <nav class="admin-pagination" aria-label="Account pages">
            <button class="button secondary admin-account-page" data-direction="previous" type="button" ${page <= 1 ? "disabled" : ""}>Previous</button>
            <span>Page ${page} of ${totalPages}</span>
            <button class="button secondary admin-account-page" data-direction="next" type="button" ${page >= totalPages ? "disabled" : ""}>Next</button>
          </nav>`;
      }

      function render() {
        const matches = visibleAccounts();
        const totalPages = Math.max(1, Math.ceil(matches.length / PAGE_SIZE));
        page = Math.min(page, totalPages);
        const pageAccounts = matches.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
        const blockedCount = accounts.filter(account => account.blocked).length;

        panel.innerHTML = `
          ${navigation("accounts")}
          <section class="admin-accounts" aria-labelledby="admin-accounts-title">
            <div class="admin-orders-heading">
              <div>
                <p class="eyebrow">Account control</p>
                <h2 id="admin-accounts-title">Customer accounts</h2>
                <p>${accounts.length} registered | ${blockedCount} blocked</p>
              </div>
              <button class="button secondary refresh-admin-accounts" type="button">Refresh Accounts</button>
            </div>
            <label class="admin-order-search">Search accounts
              <input id="admin-account-search" type="search" placeholder="Email, account ID, or status" value="${escapeHtml(searchText)}" autocomplete="off">
            </label>
            <p class="admin-security-note">Blocking prevents account history, new orders, and delivery confirmation, and signs the customer out on their next site check. The public storefront remains viewable.</p>
            ${loadError ? `<p class="form-message">${escapeHtml(loadError)}</p>` : ""}
            <div class="admin-account-list">
              ${pageAccounts.length ? pageAccounts.map(account => {
                const isAdmin = String(account.email || "").toLowerCase() === ADMIN_EMAIL;
                return `
                  <article class="admin-account-row ${account.blocked ? "is-blocked" : ""}" data-user-id="${escapeHtml(account.user_id)}">
                    <div class="admin-account-identity">
                      <strong>${escapeHtml(account.email || "No email")}</strong>
                      <small>Created ${new Date(account.created_at).toLocaleDateString("en-CA", { dateStyle: "medium" })}</small>
                      <code>${escapeHtml(account.user_id)}</code>
                    </div>
                    <span class="admin-account-status">${account.blocked ? "Blocked" : "Active"}</span>
                    <label class="admin-block-toggle">
                      <input class="admin-account-blocked" type="checkbox" ${account.blocked ? "checked" : ""} ${isAdmin ? "disabled" : ""}>
                      <span>${isAdmin ? "Admin protected" : "Block account"}</span>
                    </label>
                  </article>`;
              }).join("") : '<p class="empty-state">No accounts match this search.</p>'}
            </div>
            ${renderPagination(totalPages)}
          </section>`;
      }

      function refocus() {
        const input = document.getElementById("admin-account-search");
        if (!input) return;
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
      }

      panel.addEventListener("input", event => {
        if (!event.target.matches("#admin-account-search")) return;
        searchText = event.target.value;
        page = 1;
        render();
        refocus();
      });

      panel.addEventListener("click", async event => {
        if (event.target.closest(".refresh-admin-accounts")) {
          await loadAccounts();
          render();
          return;
        }
        const pageButton = event.target.closest(".admin-account-page");
        if (!pageButton) return;
        page += pageButton.dataset.direction === "next" ? 1 : -1;
        render();
        panel.scrollIntoView({ behavior: "smooth", block: "start" });
      });

      panel.addEventListener("change", async event => {
        const checkbox = event.target.closest(".admin-account-blocked");
        if (!checkbox) return;
        const row = checkbox.closest(".admin-account-row");
        const userId = row.dataset.userId;
        const blocked = checkbox.checked;
        checkbox.disabled = true;
        const { error } = await client.from("profiles").update({
          blocked,
          blocked_at: blocked ? new Date().toISOString() : null,
          updated_at: new Date().toISOString()
        }).eq("user_id", userId);
        if (error) {
          checkbox.checked = !blocked;
          checkbox.disabled = false;
          window.alert(`Account status could not be saved: ${error.message}`);
          return;
        }
        accounts = accounts.map(account => account.user_id === userId
          ? { ...account, blocked, blocked_at: blocked ? new Date().toISOString() : null }
          : account);
        render();
      });

      loadAccounts().then(render);
    }
  };
})();
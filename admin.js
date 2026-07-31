(function () {
  "use strict";

  function navigation(active) {
    const links = [
      ["orders", "admin.html", "Processing Orders"],
      ["finalized", "admin-finalized.html", "Finalized Orders"],
      ["plants", "admin-plants.html", "Plant Catalogue"],
      ["accounts", "admin-accounts.html", "Accounts"],
      ["dashboard", "admin-dashboard.html", "Revenue Dashboard"],
      ["wanted", "admin-wanted.html", "Wanted Plants"]
    ];
    return `
      <nav class="admin-internal-nav" aria-label="Admin sections">
        <div class="admin-internal-links">
          ${links.map(([view, href, label]) => `<a href="${href}" class="${view === active ? "active" : ""}" ${view === active ? 'aria-current="page"' : ""}>${label}</a>`).join("")}
        </div>
        <button class="button secondary admin-module-signout" type="button">Sign Out</button>
      </nav>`;
  }

  function loginTemplate(message = "") {
    return `
      <section class="admin-locked">
        <h2>Backend admin login</h2>
        <p>Only the authorized Plantovia admin account can access customer records and store operations.</p>
        <label>Email</label>
        <input id="backend-admin-email-v2" type="email" autocomplete="username" placeholder="Admin email">
        <label>Password</label>
        <input id="backend-admin-password-v2" type="password" autocomplete="current-password" placeholder="Password">
        <button id="backend-admin-login-v2" class="button primary" type="button">Sign In</button>
        <p id="backend-admin-message-v2" class="form-message">${escapeHtml(message)}</p>
      </section>`;
  }

  function unauthorizedTemplate(email = "") {
    return `
      <section class="admin-locked">
        <h2>Authorized admin only</h2>
        <p>${email ? `${escapeHtml(email)} is not authorized to access Plantovia administration.` : "The secure backend is unavailable."}</p>
        <a class="button primary" href="account.html">Open account page</a>
      </section>`;
  }

  async function signOut(client, panel) {
    if (client) await client.auth.signOut();
    localStorage.removeItem("currentUser");
    if (panel.dataset.adminView === "plants") window.location.reload();
    else panel.innerHTML = loginTemplate();
  }

  function attachPlantNavigation(panel, client) {
    function ensureNavigation() {
      if (panel.querySelector(".admin-internal-nav")) return;
      if (!panel.querySelector(".admin-toolbar, .admin-grid")) return;
      panel.insertAdjacentHTML("afterbegin", navigation("plants"));
    }
    new MutationObserver(ensureNavigation).observe(panel, { childList: true });
    ensureNavigation();
    panel.addEventListener("click", event => {
      if (event.target.closest(".admin-module-signout")) signOut(client, panel);
    });
  }

  async function startProtectedView(panel, view, client) {
    if (!client) {
      panel.innerHTML = unauthorizedTemplate();
      return;
    }

    const launch = async () => {
      const { data } = await client.auth.getSession();
      if (!data.session) {
        panel.innerHTML = loginTemplate();
        return;
      }
      const email = String(data.session.user?.email || "").toLowerCase();
      if (email !== ADMIN_EMAIL) {
        panel.innerHTML = unauthorizedTemplate(email);
        return;
      }
      if (view === "accounts") window.PlantoviaAccountsAdmin.start(panel, client, navigation);
      else if (view === "dashboard") window.PlantoviaDashboardAdmin.start(panel, client, navigation);
      else if (view === "wanted") window.PlantoviaWantedAdmin.start(panel, client, navigation);
      else window.PlantoviaOrdersAdmin.start(panel, client, view, navigation);
    };

    panel.addEventListener("click", async event => {
      if (event.target.closest(".admin-module-signout")) {
        await signOut(client, panel);
        return;
      }
      const button = event.target.closest("#backend-admin-login-v2");
      if (!button) return;
      const email = document.getElementById("backend-admin-email-v2").value.trim();
      const password = document.getElementById("backend-admin-password-v2").value;
      button.disabled = true;
      const { data, error } = await client.auth.signInWithPassword({ email, password });
      if (error) {
        panel.innerHTML = loginTemplate(error.message);
        return;
      }
      if (String(data.user?.email || "").toLowerCase() !== ADMIN_EMAIL) {
        await client.auth.signOut();
        panel.innerHTML = unauthorizedTemplate(email);
        return;
      }
      localStorage.setItem("currentUser", data.user.email);
      if (view === "accounts") window.PlantoviaAccountsAdmin.start(panel, client, navigation);
      else if (view === "dashboard") window.PlantoviaDashboardAdmin.start(panel, client, navigation);
      else if (view === "wanted") window.PlantoviaWantedAdmin.start(panel, client, navigation);
      else window.PlantoviaOrdersAdmin.start(panel, client, view, navigation);
    });

    await launch();
  }

  document.addEventListener("DOMContentLoaded", () => {
    const panel = document.getElementById("admin-panel");
    if (!panel) return;
    const client = getSupabaseClient();
    const view = panel.dataset.adminView || "orders";
    if (view === "plants") attachPlantNavigation(panel, client);
    else startProtectedView(panel, view, client);
  });
})();
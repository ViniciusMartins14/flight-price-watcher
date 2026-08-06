const authSection = document.getElementById("auth-section");
const appSection = document.getElementById("app-section");
const userBar = document.getElementById("user-bar");
const userEmailEl = document.getElementById("user-email");
const logoutButton = document.getElementById("logout-button");

const showLoginBtn = document.getElementById("show-login");
const showSignupBtn = document.getElementById("show-signup");
const loginForm = document.getElementById("login-form");
const signupForm = document.getElementById("signup-form");
const loginError = document.getElementById("login-error");
const signupError = document.getElementById("signup-error");

const routesList = document.getElementById("routes-list");
const form = document.getElementById("route-form");
const tripTypeSelect = document.getElementById("tripType");
const returnDateField = document.getElementById("returnDateField");
const returnDateInput = document.getElementById("returnDate");

let pollHandle;

function syncReturnDateField() {
  const isRoundtrip = tripTypeSelect.value === "roundtrip";
  returnDateField.hidden = !isRoundtrip;
  returnDateInput.required = isRoundtrip;
  if (!isRoundtrip) returnDateInput.value = "";
}

tripTypeSelect.addEventListener("change", syncReturnDateField);
syncReturnDateField();

function formatPrice(price, currency) {
  if (currency === "BRL") {
    return `R$ ${Number(price).toLocaleString("pt-BR")}`;
  }
  return `${currency} ${price}`;
}

function formatDateTime(iso) {
  if (!iso) return "-";
  return new Date(iso).toLocaleString("pt-BR");
}

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = String(value ?? "");
  return div.innerHTML;
}

function isSafeGoogleFlightsUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && parsed.hostname === "www.google.com";
  } catch {
    return false;
  }
}

function routeCardHtml(state) {
  const { route, lowestPrice, lowestPriceAt, history, lastError } = state;
  const label = escapeHtml(route.label || `${route.origin} -> ${route.destination}`);
  const origin = escapeHtml(route.origin);
  const destination = escapeHtml(route.destination);
  const lastCheck = history[0];
  const isRoundtrip = route.tripType === "roundtrip" && route.returnDate;
  const dates = isRoundtrip
    ? `${route.departDate} → ${route.returnDate} (ida e volta)`
    : `${route.departDate} (só ida)`;
  const whatsappInfo = route.whatsappNumber
    ? `WhatsApp: ${escapeHtml(route.whatsappNumber)}`
    : "WhatsApp: número padrão";
  const fareLink =
    lastCheck?.url && isSafeGoogleFlightsUrl(lastCheck.url)
      ? `<a class="fare-link" href="${escapeHtml(lastCheck.url)}" target="_blank" rel="noopener noreferrer">Ver no Google Voos →</a>`
      : "";

  return `
    <article class="route-card" data-id="${route.id}">
      <div class="route-card-header">
        <div>
          <div class="route-card-title">${label}</div>
          <div class="route-card-sub">${origin} → ${destination} · ${dates}</div>
          <div class="route-card-sub">${whatsappInfo}</div>
        </div>
        <div class="actions">
          <button class="secondary" data-action="check">Checar agora</button>
          <button class="danger" data-action="remove">Remover</button>
        </div>
      </div>

      <div class="price-row">
        <div class="price-stat">
          <span class="label">Menor preço já visto</span>
          <span class="value low">${lowestPrice ? formatPrice(lowestPrice, lastCheck?.currency ?? "BRL") : "-"}</span>
          <span class="label">${lowestPriceAt ? formatDateTime(lowestPriceAt) : ""}</span>
        </div>
        <div class="price-stat">
          <span class="label">Última checagem</span>
          <span class="value">${lastCheck ? formatPrice(lastCheck.price, lastCheck.currency) : "ainda não checado"}</span>
          <span class="label">${lastCheck ? formatDateTime(lastCheck.checkedAt) : ""}</span>
        </div>
      </div>

      ${fareLink}
      ${lastError ? `<div class="error-text">Erro na última checagem: ${escapeHtml(lastError)}</div>` : ""}
    </article>
  `;
}

async function loadRoutes() {
  const res = await fetch("/api/routes");
  if (res.status === 401) {
    showAuth();
    return;
  }
  const states = await res.json();

  if (states.length === 0) {
    routesList.innerHTML = `<div class="empty-state">Nenhuma rota cadastrada ainda.</div>`;
    return;
  }

  routesList.innerHTML = states.map(routeCardHtml).join("");
}

routesList.addEventListener("click", async (e) => {
  const button = e.target.closest("button[data-action]");
  if (!button) return;

  const card = button.closest(".route-card");
  const id = card.dataset.id;
  const action = button.dataset.action;

  if (action === "remove") {
    if (!confirm("Remover esta rota?")) return;
    await fetch(`/api/routes/${id}`, { method: "DELETE" });
    await loadRoutes();
  }

  if (action === "check") {
    button.disabled = true;
    button.textContent = "Checando...";
    try {
      await fetch(`/api/routes/${id}/check`, { method: "POST" });
    } finally {
      button.disabled = false;
      button.textContent = "Checar agora";
      await loadRoutes();
    }
  }
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(form).entries());

  await fetch("/api/routes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });

  form.reset();
  await loadRoutes();
});

// --- Autenticação ---

function showAuth() {
  clearInterval(pollHandle);
  authSection.hidden = false;
  appSection.hidden = true;
  userBar.hidden = true;
}

function showApp(user) {
  authSection.hidden = true;
  appSection.hidden = false;
  userBar.hidden = false;
  userEmailEl.textContent = user.email;
  loadRoutes();
  clearInterval(pollHandle);
  pollHandle = setInterval(loadRoutes, 30000);
}

showLoginBtn.addEventListener("click", () => {
  showLoginBtn.classList.add("active");
  showSignupBtn.classList.remove("active");
  loginForm.hidden = false;
  signupForm.hidden = true;
});

showSignupBtn.addEventListener("click", () => {
  showSignupBtn.classList.add("active");
  showLoginBtn.classList.remove("active");
  signupForm.hidden = false;
  loginForm.hidden = true;
});

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  loginError.textContent = "";
  const data = Object.fromEntries(new FormData(loginForm).entries());

  const res = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  const body = await res.json();

  if (!res.ok) {
    loginError.textContent = body.error || "Não foi possível entrar.";
    return;
  }

  loginForm.reset();
  showApp(body.user);
});

signupForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  signupError.textContent = "";
  const data = Object.fromEntries(new FormData(signupForm).entries());

  const res = await fetch("/api/auth/signup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  const body = await res.json();

  if (!res.ok) {
    signupError.textContent = body.error || "Não foi possível criar a conta.";
    return;
  }

  signupForm.reset();
  showApp(body.user);
});

logoutButton.addEventListener("click", async () => {
  await fetch("/api/auth/logout", { method: "POST" });
  showAuth();
});

async function init() {
  const res = await fetch("/api/auth/me");
  if (res.ok) {
    const body = await res.json();
    showApp(body.user);
  } else {
    showAuth();
  }
}

init();

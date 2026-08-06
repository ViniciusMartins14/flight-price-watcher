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
const combineStopsField = document.getElementById("combineStopsField");
const combineStopsInput = document.getElementById("combineStops");
const arriveByField = document.getElementById("arriveByField");
const arriveByInput = document.getElementById("arriveBy");
const departDateInput = document.getElementById("departDate");
const tryThreeLegsInput = document.getElementById("tryThreeLegs");

let pollHandle;

function syncReturnDateField() {
  const isRoundtrip = tripTypeSelect.value === "roundtrip";
  returnDateField.hidden = !isRoundtrip;
  returnDateInput.required = isRoundtrip;
  if (!isRoundtrip) returnDateInput.value = "";

  // Tarifa combinada só é suportada pra rotas só de ida por enquanto.
  combineStopsField.hidden = isRoundtrip;
  if (isRoundtrip) combineStopsInput.checked = false;
  syncArriveByField();
}

function syncArriveByField() {
  arriveByField.hidden = !combineStopsInput.checked;
  if (!combineStopsInput.checked) {
    arriveByInput.value = "";
    tryThreeLegsInput.checked = false;
  }
}

combineStopsInput.addEventListener("change", syncArriveByField);

function syncArriveByMin() {
  if (departDateInput.value) arriveByInput.min = departDateInput.value;
}

departDateInput.addEventListener("change", syncArriveByMin);

tripTypeSelect.addEventListener("change", syncReturnDateField);
syncReturnDateField();

// --- Autocomplete de aeroporto (origem/destino) ---
//
// Um <datalist> nativo não é confiável aqui: como as sugestões vêm de um
// fetch assíncrono (com debounce), o navegador às vezes já "decidiu" não
// mostrar o menu no momento da tecla e não reabre sozinho quando as opções
// chegam depois. Por isso, o dropdown de sugestões é feito à mão.

function setupAirportAutocomplete(inputId, dropdownId) {
  const input = document.getElementById(inputId);
  const dropdown = document.getElementById(dropdownId);
  let debounceHandle;
  let requestId = 0;

  function hideDropdown() {
    dropdown.hidden = true;
    dropdown.innerHTML = "";
  }

  function renderSuggestions(airports) {
    if (airports.length === 0) {
      hideDropdown();
      return;
    }
    dropdown.innerHTML = airports
      .map(
        (a) => `
          <div class="airport-option" data-iata="${escapeHtml(a.iata)}">
            <span class="airport-option-code">${escapeHtml(a.iata)}</span>
            <span class="airport-option-label">${escapeHtml(a.city)} — ${escapeHtml(a.name)}</span>
          </div>
        `
      )
      .join("");
    dropdown.hidden = false;
  }

  input.addEventListener("input", () => {
    clearTimeout(debounceHandle);
    const query = input.value.trim();
    if (query.length < 2) {
      hideDropdown();
      return;
    }
    const currentRequestId = ++requestId;
    debounceHandle = setTimeout(async () => {
      const res = await fetch(`/api/airports?q=${encodeURIComponent(query)}`);
      if (!res.ok || currentRequestId !== requestId) return;
      renderSuggestions(await res.json());
    }, 200);
  });

  // mousedown (não click) dispara antes do blur do input, senão o dropdown
  // já teria sumido antes do clique ser processado.
  dropdown.addEventListener("mousedown", (e) => {
    const option = e.target.closest(".airport-option");
    if (!option) return;
    e.preventDefault();
    input.value = option.dataset.iata;
    hideDropdown();
  });

  input.addEventListener("blur", () => {
    setTimeout(hideDropdown, 150);
  });
}

setupAirportAutocomplete("origin", "origin-suggestions");
setupAirportAutocomplete("destination", "destination-suggestions");

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

function formatFlightTime(iso) {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function comboDetailsHtml(combo, directPrice) {
  if (!combo || combo.totalPrice >= directPrice) return "";

  const legHtml = (leg, index) => `
    <div class="combo-leg">
      <strong>Trecho ${index + 1} (${escapeHtml(leg.from)} → ${escapeHtml(leg.to)})</strong>:
      ${formatFlightTime(leg.departAt)} → ${formatFlightTime(leg.arriveAt)} ·
      ${formatPrice(leg.price, leg.currency)}
      ${isSafeGoogleFlightsUrl(leg.url) ? `· <a href="${escapeHtml(leg.url)}" target="_blank" rel="noopener noreferrer">ver voo</a>` : ""}
    </div>
  `;

  const via = combo.legs
    .slice(0, -1)
    .map((leg) => leg.to)
    .join(", ");

  return `
    <div class="combo-details">
      <div class="combo-title">✈️ Tarifa combinada mais barata, via ${escapeHtml(via)}: ${formatPrice(combo.totalPrice, combo.currency)}</div>
      ${combo.legs.map(legHtml).join("")}
      <div class="hint-text" style="margin-top:6px">
        ⚠️ São ${combo.legs.length} passagens separadas: confira o tempo de conexão antes de comprar, e não há
        proteção se um voo atrasar e você perder o outro.
      </div>
    </div>
  `;
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
  const combineInfo = route.combineStops
    ? route.arriveBy
      ? `Combinação: aceita chegar até ${escapeHtml(route.arriveBy)} (stopover)`
      : "Combinação: só conexão apertada (mesmo dia)"
    : "";
  const fareLink =
    lastCheck?.url && isSafeGoogleFlightsUrl(lastCheck.url)
      ? `<a class="fare-link" href="${escapeHtml(lastCheck.url)}" target="_blank" rel="noopener noreferrer">Ver no Google Voos →</a>`
      : "";
  const comboHtml = lastCheck?.combo ? comboDetailsHtml(lastCheck.combo, lastCheck.price) : "";

  return `
    <article class="route-card" data-id="${route.id}">
      <div class="route-card-header">
        <div>
          <div class="route-card-title">${label}</div>
          <div class="route-card-sub">${origin} → ${destination} · ${dates}</div>
          <div class="route-card-sub">${whatsappInfo}</div>
          ${combineInfo ? `<div class="route-card-sub">${combineInfo}</div>` : ""}
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
      ${comboHtml}
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

/* ============================================================
   TERRITORIA.IO — Tienda de recompensas por metros recorridos
   Se ejecuta solo en mapa.html (requiere sesión iniciada).
   ============================================================ */

// --- Configuración general -----------------------------------
const METERS_PER_POINT = 10;      // cada 10 metros recorridos = 1 punto
const MIN_ACCURACY_M = 40;        // ignora lecturas GPS poco precisas
const MIN_STEP_M = 4;             // ignora "ruido" del GPS por debajo de esto
const MAX_REALISTIC_SPEED_MS = 12; // ~43 km/h, filtra saltos/teletransportes
const SYNC_EVERY_METERS = 20;     // sube el avance a Supabase cada 20 m acumulados

// --- Catálogo de recompensas ------------------------------------
// costPoints se puede ajustar libremente. 1 punto = 10 metros caminados.
const REWARDS = [
  {
    id: "cafe-chico",
    name: "Café chico gratis",
    description: "Canjealo en cualquier cafetería adherida a Territoria.io.",
    icon: "☕",
    costPoints: 500, // ≈ 5 km recorridos
  },
  {
    id: "descuento-super-10",
    name: "10% off en supermercado",
    description: "Descuento en tu próxima compra en comercios adheridos.",
    icon: "🛒",
    costPoints: 800, // ≈ 8 km
  },
  {
    id: "descuento-super-20",
    name: "20% off en supermercado",
    description: "Descuento en tu próxima compra en comercios adheridos.",
    icon: "🛒",
    costPoints: 1500, // ≈ 15 km
  },
  {
    id: "envio-gratis",
    name: "Envío gratis",
    description: "Válido en pedidos dentro de comercios asociados.",
    icon: "🚚",
    costPoints: 400, // ≈ 4 km
  },
  {
    id: "merch-territoria",
    name: "Merch de Territoria.io",
    description: "Canjeá tus puntos por un artículo de la tienda oficial.",
    icon: "🎽",
    costPoints: 3000, // ≈ 30 km
  },
];

// Solo corre esta lógica en la página del mapa
if (window.location.pathname.toLowerCase().endsWith("/mapa.html") ||
    window.location.pathname.toLowerCase().endsWith("mapa.html")) {
  initStoreSystem();
}

async function initStoreSystem() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) return; // app.js ya redirige a index.html en este caso
  const userId = session.user.id;

  const state = {
    userId,
    metersTotal: 0,      // total histórico persistido en Supabase
    pendingMeters: 0,     // metros acumulados localmente sin sincronizar
    bonusPoints: 0,       // puntos sumados manualmente (logros, bonos, admin, etc.)
    spentPoints: 0,       // puntos ya canjeados (suma de redemptions)
    lastPosition: null,
    watchId: null,
    redemptions: [],
  };

  await loadUserPoints(state);
  await loadRedemptionHistory(state);
  renderPoints(state);
  renderRewards(state);
  renderHistory(state);

  wireStoreUI(state);
  startGeolocationTracking(state);

  // Expone la función en la consola del navegador para pruebas rápidas:
  // ejemplo -> await territoriaAddPoints(500, "Prueba manual")
  window.territoriaAddPoints = (amount, reason) => addPoints(state, amount, reason);

  // Sincroniza cualquier metro pendiente si el usuario cierra/oculta la pestaña
  window.addEventListener("beforeunload", () => syncPendingMeters(state, true));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") syncPendingMeters(state, true);
  });
}

// --- Carga de datos desde Supabase --------------------------------

async function loadUserPoints(state) {
  const { data, error } = await supabaseClient
    .from("user_points")
    .select("meters_total, bonus_points")
    .eq("user_id", state.userId)
    .maybeSingle();

  if (error) {
    console.error("No se pudo cargar los puntos del usuario:", error.message);
    setTrackingStatus("No se pudieron cargar tus puntos. Probá recargar la página.");
    return;
  }

  if (!data) {
    // Primera vez del usuario: crea su fila en user_points
    const { error: insertError } = await supabaseClient
      .from("user_points")
      .insert({ user_id: state.userId, meters_total: 0, bonus_points: 0 });
    if (insertError) console.error("No se pudo crear el registro de puntos:", insertError.message);
    state.metersTotal = 0;
    state.bonusPoints = 0;
  } else {
    state.metersTotal = Number(data.meters_total) || 0;
    state.bonusPoints = Number(data.bonus_points) || 0;
  }
}

async function loadRedemptionHistory(state) {
  const { data, error } = await supabaseClient
    .from("redemptions")
    .select("reward_id, reward_name, points_cost, code, redeemed_at")
    .eq("user_id", state.userId)
    .order("redeemed_at", { ascending: false });

  if (error) {
    console.error("No se pudo cargar el historial de canjes:", error.message);
    return;
  }

  state.redemptions = data || [];
  state.spentPoints = state.redemptions.reduce((sum, r) => sum + r.points_cost, 0);
}

// --- Cálculo de puntos ---------------------------------------------

function availablePoints(state) {
  const earnedByWalking = Math.floor((state.metersTotal + state.pendingMeters) / METERS_PER_POINT);
  const earned = earnedByWalking + (state.bonusPoints || 0);
  return Math.max(0, earned - state.spentPoints);
}

// --- Suma manual de puntos (logros, bonos, regalos, pruebas, etc.) ------
//
// Uso:
//   await addPoints(state, 200, "Bono de bienvenida");
//
// Suma `amount` puntos directamente al usuario, sin pasar por metros
// caminados. Queda persistido en Supabase (columna bonus_points de
// user_points) y actualiza la UI al instante.
async function addPoints(state, amount, reason = "") {
  const points = Number(amount);
  if (!Number.isFinite(points) || points <= 0) {
    console.warn("addPoints: el monto debe ser un número mayor a 0");
    return { ok: false, error: "monto_invalido" };
  }

  const newBonusTotal = (state.bonusPoints || 0) + points;

  // Optimista: refleja el cambio en la UI antes de confirmar con el servidor
  state.bonusPoints = newBonusTotal;
  renderPoints(state);

  const { error } = await supabaseClient
    .from("user_points")
    .update({ bonus_points: newBonusTotal, updated_at: new Date().toISOString() })
    .eq("user_id", state.userId);

  if (error) {
    console.error("No se pudo guardar los puntos agregados:", error.message);
    // revierte el cambio local si falló el guardado
    state.bonusPoints = newBonusTotal - points;
    renderPoints(state);
    return { ok: false, error: error.message };
  }

  if (reason) {
    console.log(`+${points} puntos agregados (${reason}). Nuevo total disponible: ${availablePoints(state)}`);
  }

  return { ok: true, newTotal: availablePoints(state) };
}

// --- Geolocalización: suma de metros recorridos ---------------------

function startGeolocationTracking(state) {
  if (!("geolocation" in navigator)) {
    setTrackingStatus("Tu navegador no soporta geolocalización, no se pueden sumar puntos.");
    return;
  }

  state.watchId = navigator.geolocation.watchPosition(
    (position) => handlePosition(state, position),
    (err) => {
      console.warn("Geolocalización no disponible:", err.message);
      setTrackingStatus("Activá los permisos de ubicación para empezar a sumar puntos.");
    },
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
  );

  setTrackingStatus("Buscando tu ubicación...");
}

function handlePosition(state, position) {
  const { latitude, longitude, accuracy } = position.coords;
  const timestamp = position.timestamp;

  if (accuracy != null && accuracy > MIN_ACCURACY_M) {
    setTrackingStatus("Ubicación imprecisa, esperando mejor señal GPS...");
    return;
  }

  if (!state.lastPosition) {
    state.lastPosition = { latitude, longitude, timestamp };
    setTrackingStatus("Ubicación activa. Sumando metros a medida que te movés.");
    return;
  }

  const distance = haversineMeters(
    state.lastPosition.latitude, state.lastPosition.longitude,
    latitude, longitude
  );
  const elapsedSeconds = Math.max(1, (timestamp - state.lastPosition.timestamp) / 1000);
  const speed = distance / elapsedSeconds;

  // Descarta ruido GPS o saltos irreales (falseo de ubicación, teletransporte, etc.)
  if (distance < MIN_STEP_M) {
    state.lastPosition = { latitude, longitude, timestamp };
    return;
  }
  if (speed > MAX_REALISTIC_SPEED_MS) {
    state.lastPosition = { latitude, longitude, timestamp };
    return;
  }

  state.pendingMeters += distance;
  state.lastPosition = { latitude, longitude, timestamp };
  renderPoints(state);
  setTrackingStatus(`Sumando puntos... ${Math.round(state.metersTotal + state.pendingMeters)} m recorridos en total.`);

  if (state.pendingMeters >= SYNC_EVERY_METERS) {
    syncPendingMeters(state);
  }
}

function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000; // radio de la Tierra en metros
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

async function syncPendingMeters(state, isFinalSync = false) {
  if (state.pendingMeters <= 0) return;
  const metersToAdd = state.pendingMeters;
  const newTotal = state.metersTotal + metersToAdd;

  // Optimista: actualiza localmente antes de confirmar con el servidor
  state.metersTotal = newTotal;
  state.pendingMeters = 0;

  const { error } = await supabaseClient
    .from("user_points")
    .update({ meters_total: newTotal, updated_at: new Date().toISOString() })
    .eq("user_id", state.userId);

  if (error) {
    console.error("No se pudo sincronizar el avance:", error.message);
    if (!isFinalSync) {
      // Reintenta más adelante: vuelve a sumar lo que no se pudo guardar
      state.metersTotal -= metersToAdd;
      state.pendingMeters += metersToAdd;
    }
    return;
  }

  renderPoints(state);
}

// --- UI: puntos, tienda, historial y canje ---------------------------

function setTrackingStatus(text) {
  const el = document.getElementById("trackingStatus");
  if (el) el.textContent = text;
}

function renderPoints(state) {
  const points = availablePoints(state);
  const metersDisplay = Math.round(state.metersTotal + state.pendingMeters);

  const label = document.getElementById("storePointsLabel");
  if (label) label.textContent = `${points.toLocaleString("es-AR")} pts`;

  const statPoints = document.getElementById("statPoints");
  if (statPoints) statPoints.textContent = points.toLocaleString("es-AR");

  const statMeters = document.getElementById("statMeters");
  if (statMeters) statMeters.textContent = `${metersDisplay.toLocaleString("es-AR")} m`;

  renderRewards(state);
}

function renderRewards(state) {
  const list = document.getElementById("rewardsList");
  if (!list) return;
  const points = availablePoints(state);

  list.innerHTML = REWARDS.map((reward) => {
    const canAfford = points >= reward.costPoints;
    return `
      <div class="reward-card ${canAfford ? "" : "reward-card--locked"}">
        <div class="reward-icon">${reward.icon}</div>
        <div class="reward-info">
          <h3>${reward.name}</h3>
          <p>${reward.description}</p>
        </div>
        <div class="reward-action">
          <span class="reward-cost">${reward.costPoints.toLocaleString("es-AR")} pts</span>
          <button class="reward-redeem-btn" data-reward-id="${reward.id}" ${canAfford ? "" : "disabled"}>
            ${canAfford ? "Canjear" : "Puntos insuficientes"}
          </button>
        </div>
      </div>
    `;
  }).join("");

  list.querySelectorAll(".reward-redeem-btn").forEach((btn) => {
    btn.addEventListener("click", () => redeemReward(state, btn.dataset.rewardId));
  });
}

function renderHistory(state) {
  const list = document.getElementById("historyList");
  if (!list) return;

  if (!state.redemptions.length) {
    list.innerHTML = `<p class="empty-state">Todavía no canjeaste ninguna recompensa.</p>`;
    return;
  }

  list.innerHTML = state.redemptions.map((r) => {
    const date = new Date(r.redeemed_at).toLocaleDateString("es-AR", {
      day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
    });
    return `
      <div class="history-item">
        <div>
          <strong>${r.reward_name}</strong>
          <span class="history-date">${date}</span>
        </div>
        <div class="history-right">
          <span class="history-cost">-${r.points_cost.toLocaleString("es-AR")} pts</span>
          <span class="history-code">${r.code}</span>
        </div>
      </div>
    `;
  }).join("");
}

function generateRedeemCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 8; i++) {
    if (i === 4) code += "-";
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

async function redeemReward(state, rewardId) {
  const reward = REWARDS.find((r) => r.id === rewardId);
  if (!reward) return;

  const points = availablePoints(state);
  if (points < reward.costPoints) {
    setMessage("storeMessage", "No tenés puntos suficientes para esta recompensa.");
    return;
  }

  // Sincroniza cualquier metro pendiente antes de descontar puntos
  await syncPendingMeters(state, true);

  const code = generateRedeemCode();
  setMessage("storeMessage", "Procesando canje...");

  const { data, error } = await supabaseClient
    .from("redemptions")
    .insert({
      user_id: state.userId,
      reward_id: reward.id,
      reward_name: reward.name,
      points_cost: reward.costPoints,
      code,
    })
    .select()
    .single();

  if (error) {
    console.error("No se pudo procesar el canje:", error.message);
    setMessage("storeMessage", "Ocurrió un error al procesar el canje. Intentá nuevamente.");
    return;
  }

  state.redemptions.unshift(data);
  state.spentPoints += reward.costPoints;
  setMessage("storeMessage", "");
  renderPoints(state);
  renderHistory(state);
  showRedeemCode(reward.name, code);
}

function setMessage(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function showRedeemCode(rewardName, code) {
  document.getElementById("redeemRewardName").textContent = rewardName;
  document.getElementById("redeemCode").textContent = code;
  document.getElementById("redeemCodeModal").classList.remove("hidden");
}

function wireStoreUI(state) {
  const storeButton = document.getElementById("storeButton");
  const storeModal = document.getElementById("storeModal");
  const closeStoreModal = document.getElementById("closeStoreModal");
  const redeemCodeModal = document.getElementById("redeemCodeModal");
  const closeRedeemCodeModal = document.getElementById("closeRedeemCodeModal");

  storeButton?.addEventListener("click", () => {
    renderPoints(state);
    renderHistory(state);
    storeModal.classList.remove("hidden");
  });

  const closeStore = () => storeModal.classList.add("hidden");
  closeStoreModal?.addEventListener("click", closeStore);
  storeModal?.querySelector(".store-modal-backdrop")?.addEventListener("click", closeStore);

  const closeRedeem = () => redeemCodeModal.classList.add("hidden");
  closeRedeemCodeModal?.addEventListener("click", closeRedeem);
  redeemCodeModal?.querySelector(".store-modal-backdrop")?.addEventListener("click", closeRedeem);

  document.querySelectorAll(".store-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".store-tab").forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      const target = tab.dataset.tab;
      document.getElementById("rewardsPanel").classList.toggle("hidden", target !== "rewards");
      document.getElementById("historyPanel").classList.toggle("hidden", target !== "history");
    });
  });
}

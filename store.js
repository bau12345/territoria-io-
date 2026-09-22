codigo tienda 
<!-- Botón Flotante de Tienda -->
<button id="shop-btn" class="shop-btn" onclick="toggleShop()">
  🛍️ Tienda (<span id="user-meters">1500</span> m)
</button>

<!-- Modal de la Tienda -->
<div id="shop-modal" class="shop-modal hidden">
  <div class="shop-content">
    <button class="close-btn" onclick="toggleShop()">&times;</button>
    <h2>Tienda de Recompensas Territoria</h2>
    <p>Tus metros acumulados: <strong id="modal-meters">1500</strong> m</p>

    <!-- Panel de carga manual de puntos/metros -->
    <div class="add-points-box" style="margin: 15px 0; padding: 12px; background: #f0f4f2; border-radius: 8px;">
      <label for="manual-points-input" style="font-size: 13px; font-weight: bold; display: block; margin-bottom: 6px; color: #18382a;">
        Agregar metros / puntos manualmente:
      </label>
      <div style="display: flex; gap: 8px; justify-content: center;">
        <input type="number" id="manual-points-input" placeholder="Monto" min="1" style="width: 120px; height: 38px; margin: 0; padding: 0 10px; border: 1px solid #cbdacf; border-radius: 6px;">
        <button type="button" onclick="addManualMeters()" style="height: 38px; padding: 0 15px; background-color: #27ae60; color: white; border: none; border-radius: 6px; font-weight: bold; cursor: pointer;">
          + Sumar
        </button>
      </div>
    </div>

    <!-- Catálogo de Recompensas -->
    <div id="rewards-grid" class="rewards-grid"></div>
  </div>
</div>


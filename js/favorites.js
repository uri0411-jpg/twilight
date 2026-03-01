// favorites.js - מועדפים: שמירה, טעינה, מחיקה של מיקומים
(() => {
  const STORAGE_KEY = "twilight_favorites_v1";
  const MAX_FAVORITES = 20;

  // ─── Storage ──────────────────────────────────────────────────────
  function loadFavorites() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"); }
    catch { return []; }
  }

  function saveFavorites(list) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  }

  function addFavorite(loc) {
    if (!loc?.lat || !loc?.lon) return false;
    const list = loadFavorites();
    const exists = list.some(f => Math.abs(f.lat - loc.lat) < 0.001 && Math.abs(f.lon - loc.lon) < 0.001);
    if (exists) return false;
    if (list.length >= MAX_FAVORITES) list.shift();
    list.push({ lat: loc.lat, lon: loc.lon, name: loc.name || "מיקום", savedAt: Date.now() });
    saveFavorites(list);
    return true;
  }

  function removeFavorite(index) {
    const list = loadFavorites();
    list.splice(index, 1);
    saveFavorites(list);
  }

  function isFavorite(loc) {
    if (!loc) return false;
    return loadFavorites().some(f => Math.abs(f.lat - loc.lat) < 0.001 && Math.abs(f.lon - loc.lon) < 0.001);
  }

  // ─── UI ───────────────────────────────────────────────────────────
  function renderFavorites() {
    const container = document.getElementById("favList");
    if (!container) return;

    const list = loadFavorites();
    container.innerHTML = "";
    if (!list.length) return;

    list.forEach((fav, i) => {
      const el = document.createElement("div");
      el.className = "fav-chip";
      el.innerHTML = `📍 ${fav.name}<span class="fav-remove" title="מחק">×</span>`;

      el.addEventListener("click", (e) => {
        if (e.target.classList.contains("fav-remove")) {
          removeFavorite(i);
          renderFavorites();
          updateFavBtn();
          return;
        }
        const loc = loadFavorites()[i];
        if (!loc) return;
        window.__twilightLoc = loc;
        localStorage.setItem("twilight_loc_v2", JSON.stringify(loc));
        const locInfo   = document.getElementById("locInfo");
        const locCoords = document.getElementById("locCoords");
        if (locInfo)   locInfo.textContent   = loc.name;
        if (locCoords) locCoords.textContent = `${loc.lat.toFixed(4)}, ${loc.lon.toFixed(4)}`;
        window.dispatchEvent(new CustomEvent("twilight:loc", { detail: loc }));
      });

      container.appendChild(el);
    });
  }

  function updateFavBtn() {
    const btn = document.getElementById("btnFav");
    if (!btn) return;
    const loc = window.__twilightLoc;
    const fav = isFavorite(loc);
    btn.textContent = fav ? "★ מועדף" : "☆ הוסף";
    btn.classList.toggle("btn--accent", !fav);
    btn.classList.toggle("btn--fav-active", fav);
  }

  function wireFavButton() {
    const btn = document.getElementById("btnFav");
    if (!btn) return;

    btn.addEventListener("click", () => {
      const loc = window.__twilightLoc;
      if (!loc) { alert("בחר מיקום קודם."); return; }
      if (isFavorite(loc)) return;
      const added = addFavorite(loc);
      if (added) { renderFavorites(); updateFavBtn(); }
    });
  }

  // ─── Init ─────────────────────────────────────────────────────────
  document.addEventListener("DOMContentLoaded", () => {
    wireFavButton();
    renderFavorites();
    updateFavBtn();
  });

  // עדכון כפתור כשמיקום משתנה
  window.addEventListener("twilight:loc", () => {
    updateFavBtn();
  });

  // expose
  window.Favorites = { add: addFavorite, remove: removeFavorite, load: loadFavorites, isFavorite };
})();

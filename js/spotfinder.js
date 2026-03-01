// spotfinder.js v3 — מפה קבועה + רשימה גוללת + markers עם ציון
(() => {
  const $ = (id) => document.getElementById(id);

  // ─── Leaflet instance ─────────────────────────────────────────────
  let map = null;
  let centerMarker = null;
  let spotMarkers  = [];

  // ─── Geo helpers ──────────────────────────────────────────────────
  function haversineKm(lat1, lon1, lat2, lon2) {
    const R = 6371, r = d => (d * Math.PI) / 180;
    const dLat = r(lat2 - lat1), dLon = r(lon2 - lon1);
    const a = Math.sin(dLat/2)**2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(dLon/2)**2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }

  const mapsUrl = (lat, lon) => `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`;
  const wazeUrl = (lat, lon) => `https://waze.com/ul?ll=${lat},${lon}&navigate=yes`;

  // ─── Init Leaflet map ─────────────────────────────────────────────
  function initMap(lat, lon) {
    const mapEl = $("spotMap");
    if (!mapEl || !window.L) return;

    if (map) {
      map.setView([lat, lon], 13);
      return;
    }

    map = L.map("spotMap", {
      center: [lat, lon],
      zoom: 13,
      zoomControl: true,
      attributionControl: false,
    });

    // הסתר placeholder
    const ph = document.getElementById("mapPlaceholder");
    if (ph) ph.style.display = "none";

    // Voyager tile layer — בהיר יותר, מתאים לשימוש יומי
    L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
      maxZoom: 19,
    }).addTo(map);

    L.control.attribution({ prefix: false })
      .addAttribution('© <a href="https://openstreetmap.org">OSM</a>')
      .addTo(map);
  }

  // ─── Custom marker icons ──────────────────────────────────────────
  function makeScoreIcon(score10, typeIcon, isTop) {
    const scoreNum = score10.toFixed(0);
    const bg = score10 >= 8
      ? "linear-gradient(135deg,#ff7a5c,#f4b14b)"
      : score10 >= 6
      ? "linear-gradient(135deg,#f4b14b,#f4c97a)"
      : "linear-gradient(135deg,#555,#777)";
    const size  = isTop ? 52 : 44;
    const html  = `
      <div style="
        width:${size}px; height:${size}px;
        background:${bg};
        border-radius:50% 50% 50% 4px;
        transform: rotate(-45deg);
        box-shadow: 0 4px 14px rgba(0,0,0,.55);
        border: 2px solid rgba(255,255,255,.35);
        display:flex; align-items:center; justify-content:center;
      ">
        <div style="transform:rotate(45deg); text-align:center; line-height:1.1">
          <div style="font-size:${isTop ? 15 : 13}px; font-weight:900; color:#fff">${scoreNum}</div>
          <div style="font-size:${isTop ? 11 : 9}px">${typeIcon}</div>
        </div>
      </div>`;
    return L.divIcon({
      html,
      className: "",
      iconSize:   [size, size],
      iconAnchor: [size/2, size],
      popupAnchor:[0, -size],
    });
  }

  function makeCenterIcon() {
    const html = `
      <div style="
        width:36px; height:36px;
        background:radial-gradient(circle,rgba(90,174,212,.9),rgba(90,174,212,.4));
        border-radius:50%;
        border:3px solid rgba(90,174,212,.9);
        box-shadow:0 0 0 6px rgba(90,174,212,.2), 0 4px 14px rgba(0,0,0,.5);
        display:flex; align-items:center; justify-content:center;
        font-size:16px;
      ">📍</div>`;
    return L.divIcon({ html, className:"", iconSize:[36,36], iconAnchor:[18,18] });
  }

  // ─── Clear map markers ────────────────────────────────────────────
  function clearMarkers() {
    spotMarkers.forEach(m => m.remove());
    spotMarkers = [];
    if (centerMarker) { centerMarker.remove(); centerMarker = null; }
  }

  // ─── Add markers to map ───────────────────────────────────────────
  function addMarkersToMap(center, scored) {
    if (!map) return;
    clearMarkers();

    // Center
    centerMarker = L.marker([center.lat, center.lon], { icon: makeCenterIcon(), zIndexOffset: 1000 })
      .addTo(map)
      .bindTooltip("המיקום שלך", { direction: "top", className: "spot-tooltip" });

    // Fit bounds
    const bounds = [[center.lat, center.lon]];

    scored.forEach((spot, i) => {
      const score10 = +(spot.score * 10).toFixed(1);
      const isTop   = i === 0;
      const icon    = makeScoreIcon(score10, spot.typeInfo?.icon || "📍", isTop);

      const popupHtml = buildPopupHtml(spot, i, score10);
      const m = L.marker([spot.lat, spot.lon], { icon, zIndexOffset: isTop ? 500 : 100 - i })
        .addTo(map)
        .bindPopup(popupHtml, {
          maxWidth: 260,
          className: "spot-popup",
        });

      // לחיצה על פריט ברשימה → פתח popup על המפה
      m._spotIdx = i;
      spotMarkers.push(m);
      bounds.push([spot.lat, spot.lon]);

      // לחיצה על popup → scroll לפריט ברשימה
      m.on("popupopen", () => {
        const listItem = document.getElementById("list-item-" + i);
        if (listItem) listItem.scrollIntoView({ behavior: "smooth", block: "center" });
        highlightListItem(i);
      });
    });

    map.fitBounds(bounds, { padding: [32, 32], maxZoom: 14 });
  }

  // ─── Popup HTML ───────────────────────────────────────────────────
  function buildPopupHtml(spot, idx, score10) {
    const typeInfo  = spot.typeInfo || { label: "נקודה", icon: "📍" };
    const scoreColor = score10 >= 8 ? "#ff7a5c" : score10 >= 6 ? "#f4b14b" : "#aaa";
    return `
      <div style="direction:rtl;font-family:'Heebo',sans-serif;min-width:200px">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px">
          <span style="font-size:20px">${typeInfo.icon}</span>
          <div>
            <div style="font-weight:700;font-size:14px;color:#f4e8d4">#${idx+1} ${spot.name}</div>
            <div style="font-size:11px;color:rgba(244,232,212,.5)">${typeInfo.label}</div>
          </div>
          <div style="margin-right:auto;font-size:22px;font-weight:900;color:${scoreColor}">${score10}</div>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px">
          <span style="background:rgba(255,255,255,.08);border-radius:6px;padding:2px 8px;font-size:11px;color:rgba(244,232,212,.6)">⬆ ${Math.round(spot.elev)}m</span>
          <span style="background:rgba(255,255,255,.08);border-radius:6px;padding:2px 8px;font-size:11px;color:rgba(244,232,212,.6)">↔ ${spot.d.toFixed(1)} ק"מ</span>
          ${!spot.fromGrid ? '<span style="background:rgba(100,220,100,.12);border-radius:6px;padding:2px 8px;font-size:11px;color:rgba(100,220,100,.8)">OSM ✓</span>' : ''}
        </div>
        <div style="display:flex;gap:6px">
          <a href="${mapsUrl(spot.lat, spot.lon)}" target="_blank"
             style="flex:1;text-align:center;padding:7px;background:rgba(240,180,60,.2);border:1px solid rgba(240,180,60,.3);border-radius:8px;color:#ffd46a;font-size:12px;font-weight:600;text-decoration:none">
            🗺 מפות
          </a>
          <a href="${wazeUrl(spot.lat, spot.lon)}" target="_blank"
             style="flex:1;text-align:center;padding:7px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);border-radius:8px;color:#f4e8d4;font-size:12px;font-weight:600;text-decoration:none">
            🚗 Waze
          </a>
        </div>
      </div>`;
  }

  // ─── Highlight list item ──────────────────────────────────────────
  function highlightListItem(idx) {
    document.querySelectorAll(".spot-list-item").forEach((el, i) => {
      el.style.borderColor = i === idx
        ? "rgba(240,180,60,.5)"
        : "rgba(255,185,80,.12)";
    });
  }

  // ─── Overpass ─────────────────────────────────────────────────────
  async function fetchOverpassSpots(lat, lon, radiusM) {
    const query = `
      [out:json][timeout:25];
      (
        node["tourism"="viewpoint"](around:${radiusM},${lat},${lon});
        node["natural"="peak"](around:${radiusM},${lat},${lon});
        node["natural"="hill"](around:${radiusM},${lat},${lon});
        node["man_made"="observation_tower"](around:${radiusM},${lat},${lon});
        node["amenity"="observation_platform"](around:${radiusM},${lat},${lon});
      );
      out body;
    `.trim();
    const res = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      body: "data=" + encodeURIComponent(query),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    if (!res.ok) throw new Error("Overpass נכשל (" + res.status + ")");
    const data = await res.json();
    return data.elements || [];
  }

  // ─── Elevation ────────────────────────────────────────────────────
  async function getElevationsBatch(points) {
    if (!points.length) return [];
    const lats = points.map(p => p.lat).join(",");
    const lons = points.map(p => p.lon).join(",");
    const res  = await fetch(`https://api.open-meteo.com/v1/elevation?latitude=${lats}&longitude=${lons}`);
    if (!res.ok) throw new Error("Elevation failed");
    const data = await res.json();
    return Array.isArray(data.elevation) ? data.elevation : [data.elevation];
  }

  // ─── Type helpers ─────────────────────────────────────────────────
  function spotTypeLabel(tags) {
    if (tags?.tourism === "viewpoint")            return { label:"נקודת תצפית", icon:"🔭", priority:10 };
    if (tags?.man_made === "observation_tower")   return { label:"מגדל תצפית",  icon:"🗼", priority:9  };
    if (tags?.amenity === "observation_platform") return { label:"פלטפורמת תצפית",icon:"🏗",priority:9 };
    if (tags?.natural === "peak")                 return { label:"פסגה",        icon:"⛰️", priority:8  };
    if (tags?.natural === "hill")                 return { label:"גבעה",        icon:"🏔️", priority:7  };
    return                                               { label:"נקודה",       icon:"📍", priority:5  };
  }

  function spotName(tags) {
    return tags?.["name:he"] || tags?.name || tags?.["name:en"] || "נקודה ללא שם";
  }

  // ─── Score ────────────────────────────────────────────────────────
  function scoreSpot(center, spot, elevRange) {
    const d = haversineKm(center.lat, center.lon, spot.lat, spot.lon);
    const x = d / Math.max(0.001, center.radiusKm);
    const distScore  = x < 0.1 ? 0.4 : x < 0.3 ? 0.7 : x < 0.8 ? 1.0 : Math.max(0, 1-(x-0.8)*2);
    const elevNorm   = elevRange.max > elevRange.min ? (spot.elev - elevRange.min) / (elevRange.max - elevRange.min) : 0.5;
    const typePriority = (spot.typeInfo?.priority || 5) / 10;
    return { d, score: Math.min(1, 0.40*elevNorm + 0.35*distScore + 0.25*typePriority) };
  }

  // ─── Fallback grid ────────────────────────────────────────────────
  function buildPolarGrid(center) {
    const points = [];
    const rings = [0.2,0.4,0.6,0.8,1.0], perRing = [4,6,8,10,12];
    const dLat = center.radiusKm / 110.574;
    const dLon = center.radiusKm / (111.320 * Math.cos(center.lat * Math.PI / 180));
    rings.forEach((r, ri) => {
      for (let i = 0; i < perRing[ri]; i++) {
        const a = (2 * Math.PI * i) / perRing[ri];
        points.push({ lat: center.lat + r*dLat*Math.sin(a), lon: center.lon + r*dLon*Math.cos(a), tags:{}, fromGrid:true });
      }
    });
    return points;
  }

  // ─── Render list ──────────────────────────────────────────────────
  function renderList(scored) {
    const container = $("results");
    if (!container) return;
    container.innerHTML = "";

    scored.forEach((spot, i) => {
      const score10    = +(spot.score * 10).toFixed(1);
      const typeInfo   = spot.typeInfo || { label:"נקודה", icon:"📍" };
      const scoreColor = score10 >= 8
        ? "linear-gradient(135deg,rgba(255,122,92,.25),rgba(244,177,75,.15))"
        : score10 >= 6
        ? "linear-gradient(135deg,rgba(244,177,75,.18),rgba(244,201,122,.1))"
        : "rgba(255,255,255,.04)";

      const el = document.createElement("div");
      el.className  = "item spot-list-item";
      el.id         = "list-item-" + i;
      el.style.cursor = "pointer";

      el.innerHTML = `
        <div class="item__left">
          <div class="item__title">
            <span style="font-size:18px">${typeInfo.icon}</span>
            #${i+1} • ${spot.name}
          </div>
          <div class="item__meta">
            <span class="badge">${typeInfo.label}</span>
            <span class="badge">⬆ ${Math.round(spot.elev)}m</span>
            <span class="badge">↔ ${spot.d.toFixed(1)} ק"מ</span>
            ${!spot.fromGrid ? '<span class="badge" style="color:rgba(100,220,100,.8)">OSM ✓</span>' : '<span class="badge" style="opacity:.5">גריד</span>'}
          </div>
        </div>
        <div class="item__actions">
          <div class="item__score" style="background:${scoreColor};font-family:\'Cormorant Garamond\',serif;font-size:22px">${score10}</div>
        </div>`;

      // לחיצה על פריט ברשימה → פתח popup על המפה + scroll למעלה
      el.addEventListener("click", () => {
        const m = spotMarkers[i];
        if (m && map) {
          map.setView(m.getLatLng(), 15, { animate: true });
          m.openPopup();
          highlightListItem(i);
          $("spotMap")?.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      });

      container.appendChild(el);
    });
  }

  // ─── Main ─────────────────────────────────────────────────────────
  async function findSpots() {
    const loc = window.__twilightLoc;
    if (!loc) { alert("בחר מיקום (GPS או חיפוש) ואז נסה שוב."); return; }

    const radiusKm = Number($("radiusKm")?.value || 12);
    const topN     = Number($("topN")?.value     || 5);
    const center   = { lat: loc.lat, lon: loc.lon, radiusKm };

    // הצג מפה וכרטיס תוצאות
    const mapSection = $("mapSection");
    const resultsCard = $("resultsCard");
    if (mapSection) mapSection.style.display = "block";
    if (resultsCard) resultsCard.style.display = "block";

    // אתחל מפה
    initMap(loc.lat, loc.lon);
    clearMarkers();

    const summary = $("resultSummary");
    if (summary) summary.textContent = "מחפש נקודות תצפית ב-OpenStreetMap…";
    const container = $("results");
    if (container) container.innerHTML = "";

    let spots = [], usedOverpass = false;

    // 1. Overpass
    try {
      const elements = await fetchOverpassSpots(loc.lat, loc.lon, radiusKm * 1000);
      spots = elements.map(el => ({
        lat: el.lat, lon: el.lon, tags: el.tags || {},
        name: spotName(el.tags), typeInfo: spotTypeLabel(el.tags), fromGrid: false,
      }));
      usedOverpass = true;
      if (summary) summary.textContent = `נמצאו ${spots.length} נקודות. מחשב גבהים…`;
    } catch (e) {
      console.warn("Overpass failed:", e);
      if (summary) summary.textContent = "Overpass לא זמין — עובר לגריד…";
    }

    // 2. Fallback
    if (!spots.length) {
      spots = buildPolarGrid(center).map(p => ({ ...p, name:"נקודה", typeInfo: spotTypeLabel({}) }));
      if (summary) summary.textContent = `גריד פולארי — ${spots.length} נקודות…`;
    }

    // 3. Elevation
    try {
      const batch = spots.slice(0, 100);
      const elevs = await getElevationsBatch(batch);
      spots = batch.map((s, i) => ({ ...s, elev: elevs[i] ?? 0 }));
    } catch {
      spots = spots.map(s => ({ ...s, elev: 0 }));
    }

    // 4. Score + sort
    const elevRange = {
      min: Math.min(...spots.map(s => s.elev)),
      max: Math.max(...spots.map(s => s.elev)),
    };
    const scored = spots
      .map(s => { const {d, score} = scoreSpot(center, s, elevRange); return {...s, d, score}; })
      .sort((a,b) => b.score - a.score)
      .slice(0, topN);

    if (!scored.length) {
      if (summary) summary.textContent = "לא נמצאו תוצאות. נסה רדיוס גדול יותר.";
      return;
    }

    // 5. Render
    const src = usedOverpass && !scored[0]?.fromGrid ? `${scored.length} נקודות OSM` : `${scored.length} נקודות גריד`;
    if (summary) summary.textContent = `${src} — לחץ על marker או פריט ברשימה לפרטים`;

    addMarkersToMap(center, scored);
    renderList(scored);
  }

  // ─── Wire UI ──────────────────────────────────────────────────────
  function wireUI() {
    const radiusKm  = $("radiusKm");
    const radiusVal = $("radiusVal");
    if (radiusKm && radiusVal) {
      const sync = () => (radiusVal.textContent = radiusKm.value);
      radiusKm.addEventListener("input", sync);
      sync();
    }

    const btnFind = $("btnFind");
    if (btnFind) {
      btnFind.addEventListener("click", async () => {
        btnFind.disabled    = true;
        btnFind.textContent = "מחפש...";
        try { await findSpots(); }
        catch (e) { console.error(e); alert("Spot Finder נכשל: " + (e.message || e)); }
        finally { btnFind.disabled = false; btnFind.textContent = "מצא נקודות"; }
      });
    }
  }

  document.addEventListener("DOMContentLoaded", wireUI);
})();

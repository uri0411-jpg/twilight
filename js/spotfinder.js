// spotfinder.js v4 — כל השיפורים
(() => {
  const $ = (id) => document.getElementById(id);

  let map = null;
  let centerMarker = null;
  let spotMarkers  = [];
  let savedSpots   = JSON.parse(localStorage.getItem('spotFavorites') || '[]');

  // ─── Determine next event ─────────────────────────────────────────
  function getNextEvent(lat, lon) {
    if (!window.SunCalc) return { type: 'sunset', label: 'שקיעה', dir: 'west' };
    const now = new Date();
    const sun = window.SunCalc.calc(lat, lon, now);
    const nowMs = now.getTime();
    // אם הזריחה עוד לפנינו היום → זריחה. אחרת → שקיעה
    if (sun.sunrise && sun.sunrise.getTime() > nowMs) {
      return { type: 'sunrise', label: 'זריחה', dir: 'east',  icon: '🌄' };
    }
    if (sun.sunset && sun.sunset.getTime() > nowMs) {
      return { type: 'sunset',  label: 'שקיעה', dir: 'west',  icon: '🌇' };
    }
    // שני האירועים עברו — הזריחה של מחר
    return { type: 'sunrise', label: 'זריחה (מחר)', dir: 'east', icon: '🌄' };
  }

  // ─── Cardinal direction of a point from center ────────────────────
  function bearingDeg(lat1, lon1, lat2, lon2) {
    const r = d => d * Math.PI / 180;
    const dLon = r(lon2 - lon1);
    const y = Math.sin(dLon) * Math.cos(r(lat2));
    const x = Math.cos(r(lat1)) * Math.sin(r(lat2)) - Math.sin(r(lat1)) * Math.cos(r(lat2)) * Math.cos(dLon);
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  }

  // האם הנקודה פתוחה לכיוון הנדרש (מזרח/מערב)?
  function horizonScore(bearing, requiredDir) {
    // מערב = 270°, מזרח = 90°
    const target = requiredDir === 'west' ? 270 : 90;
    const diff = Math.abs(((bearing - target) + 180) % 360 - 180);
    // diff=0 → 1.0, diff=90 → 0.0
    return Math.max(0, 1 - diff / 90);
  }

  // ─── Geo helpers ──────────────────────────────────────────────────
  function haversineKm(lat1, lon1, lat2, lon2) {
    const R = 6371, r = d => (d * Math.PI) / 180;
    const dLat = r(lat2 - lat1), dLon = r(lon2 - lon1);
    const a = Math.sin(dLat/2)**2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(dLon/2)**2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }

  // פורמט זמן נסיעה
  function fmtDrive(seconds) {
    if (!seconds) return null;
    const min = Math.round(seconds / 60);
    return min < 60 ? `${min} דק'` : `${Math.floor(min/60)}:${String(min%60).padStart(2,'0')} שע'`;
  }

  // פורמט מרחק כביש
  function fmtRoadKm(meters) {
    if (!meters) return null;
    return meters >= 1000 ? `${(meters/1000).toFixed(1)} ק"מ` : `${Math.round(meters)} מ'`;
  }

  // OSRM Table API — מרחק + זמן כביש לכל הנקודות בבת אחת
  async function fetchRoadDistances(center, spots) {
    // coords: מרכז ראשון, אחריו כל הנקודות
    const coords = [
      `${center.lon},${center.lat}`,
      ...spots.map(s => `${s.lon},${s.lat}`)
    ].join(';');

    const url = `https://router.project-osrm.org/table/v1/driving/${coords}`
      + `?sources=0&annotations=distance,duration`;

    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      const data = await res.json();
      if (data.code !== 'Ok') return null;
      // distances[0] = מרכז→כל הנקודות (מטרים)
      // durations[0] = מרכז→כל הנקודות (שניות)
      // index 0 = מרכז עצמו → מדלגים, index 1..n = הנקודות
      const distances = data.distances?.[0]?.slice(1) || [];
      const durations = data.durations?.[0]?.slice(1) || [];
      return spots.map((_, i) => ({
        roadMeters:  distances[i] ?? null,
        roadSeconds: durations[i] ?? null,
      }));
    } catch {
      return null;
    }
  }

  const mapsUrl = (lat, lon) => `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`;
  const wazeUrl = (lat, lon) => `https://waze.com/ul?ll=${lat},${lon}&navigate=yes`;

  // ─── Init Leaflet map ─────────────────────────────────────────────
  function initMap(lat, lon) {
    const mapEl = $('spotMap');
    if (!mapEl || !window.L) return;
    if (map) { map.setView([lat, lon], 13); return; }

    map = L.map('spotMap', { center:[lat,lon], zoom:13, zoomControl:true, attributionControl:false });

    const ph = document.getElementById('mapPlaceholder');
    if (ph) ph.style.display = 'none';

    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', { maxZoom:19 }).addTo(map);
    // sepia warm filter
    const mapPane = document.getElementById('spotMap');
    if (mapPane) {
      const tilePane = mapPane.querySelector('.leaflet-tile-pane');
      if (tilePane) tilePane.style.filter = 'sepia(0.55) saturate(0.85) brightness(0.97) hue-rotate(-8deg)';
      // apply after tiles load
      map.on('load tileload', () => {
        const tp = mapPane.querySelector('.leaflet-tile-pane');
        if (tp) tp.style.filter = 'sepia(0.55) saturate(0.85) brightness(0.97) hue-rotate(-8deg)';
      });
    }
    L.control.attribution({ prefix:false }).addAttribution('© <a href="https://openstreetmap.org">OSM</a>').addTo(map);
  }

  // ─── Icons ────────────────────────────────────────────────────────
  function makeScoreIcon(score10, typeIcon, isTop, horizDir) {
    const bg = score10 >= 8
      ? 'linear-gradient(135deg,#ff7a5c,#f4b14b)'
      : score10 >= 6
      ? 'linear-gradient(135deg,#f4b14b,#f4c97a)'
      : 'linear-gradient(135deg,#555,#777)';
    const size = isTop ? 52 : 44;
    const dirArrow = horizDir === 'west' ? '◀' : '▶';
    const html = `
      <div style="width:${size}px;height:${size}px;background:${bg};border-radius:50% 50% 50% 4px;
        transform:rotate(-45deg);box-shadow:0 4px 14px rgba(0,0,0,.55);
        border:2px solid rgba(255,255,255,.35);display:flex;align-items:center;justify-content:center;">
        <div style="transform:rotate(45deg);text-align:center;line-height:1.1">
          <div style="font-size:${isTop?15:13}px;font-weight:900;color:#fff">${score10}</div>
          <div style="font-size:${isTop?11:9}px">${typeIcon}</div>
        </div>
      </div>`;
    return L.divIcon({ html, className:'', iconSize:[size,size], iconAnchor:[size/2,size], popupAnchor:[0,-size] });
  }

  function makeCenterIcon() {
    const html = `<div style="width:36px;height:36px;background:radial-gradient(circle,rgba(90,174,212,.9),rgba(90,174,212,.4));
      border-radius:50%;border:3px solid rgba(90,174,212,.9);box-shadow:0 0 0 6px rgba(90,174,212,.2),0 4px 14px rgba(0,0,0,.5);
      display:flex;align-items:center;justify-content:center;font-size:16px;">📍</div>`;
    return L.divIcon({ html, className:'', iconSize:[36,36], iconAnchor:[18,18] });
  }

  function clearMarkers() {
    spotMarkers.forEach(m => m.remove());
    spotMarkers = [];
    if (centerMarker) { centerMarker.remove(); centerMarker = null; }
  }

  // ─── Popup ────────────────────────────────────────────────────────
  function buildPopupHtml(spot, idx, score10) {
    const ti = spot.typeInfo || { label:'נקודה', icon:'📍' };
    const scoreColor = score10 >= 8 ? '#ff7a5c' : score10 >= 6 ? '#f4b14b' : '#aaa';
    const horizPct = Math.round((spot.horizScore || 0) * 100);
    const isSaved = savedSpots.some(s => s.lat === spot.lat && s.lon === spot.lon);
    return `
      <div style="direction:rtl;font-family:'Heebo',sans-serif;min-width:210px">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px">
          <span style="font-size:20px">${ti.icon}</span>
          <div style="flex:1">
            <div style="font-weight:700;font-size:14px;color:#f4e8d4">#${idx+1} ${spot.name}</div>
            <div style="font-size:11px;color:rgba(244,232,212,.5)">${ti.label}</div>
          </div>
          <div style="font-size:22px;font-weight:900;color:${scoreColor}">${score10}</div>
        </div>
        <div style="display:flex;gap:5px;flex-wrap:wrap;margin-bottom:8px">
          <span style="background:rgba(255,255,255,.08);border-radius:6px;padding:2px 7px;font-size:11px;color:rgba(244,232,212,.7)">⬆ ${Math.round(spot.elev)}m</span>
          <span style="background:rgba(255,255,255,.08);border-radius:6px;padding:2px 7px;font-size:11px;color:rgba(244,232,212,.7)">
            🚗 ${spot.roadMeters ? fmtRoadKm(spot.roadMeters) : spot.d.toFixed(1)+' ק"מ (קו אוויר)'}
          </span>
          <span style="background:rgba(255,255,255,.08);border-radius:6px;padding:2px 7px;font-size:11px;color:rgba(244,232,212,.7)">
            ⏱ ${spot.roadSeconds ? fmtDrive(spot.roadSeconds) : '~'+Math.round(spot.d/50*60)+String.fromCharCode(39)+'דק'}
          </span>
          <span style="background:rgba(240,165,50,.12);border-radius:6px;padding:2px 7px;font-size:11px;color:rgba(240,180,60,.9)">
            ${spot.nextEvent?.icon || '🌇'} אופק ${horizPct}%
          </span>
          ${!spot.fromGrid ? '<span style="background:rgba(100,220,100,.12);border-radius:6px;padding:2px 7px;font-size:11px;color:rgba(100,220,100,.8)">OSM ✓</span>' : ''}
        </div>
        <div style="display:flex;gap:6px;margin-bottom:6px">
          <a href="${mapsUrl(spot.lat,spot.lon)}" target="_blank"
             style="flex:1;text-align:center;padding:7px;background:rgba(240,180,60,.2);border:1px solid rgba(240,180,60,.3);
             border-radius:8px;color:#ffd46a;font-size:12px;font-weight:600;text-decoration:none">🗺 מפות</a>
          <a href="${wazeUrl(spot.lat,spot.lon)}" target="_blank"
             style="flex:1;text-align:center;padding:7px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);
             border-radius:8px;color:#f4e8d4;font-size:12px;font-weight:600;text-decoration:none">🚗 Waze</a>
          <button onclick="window.toggleSpotFav(${idx})" id="fav-popup-${idx}"
             style="padding:7px 10px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);
             border-radius:8px;color:${isSaved?'#ffd46a':'rgba(244,232,212,.5)'};font-size:14px;cursor:pointer">
             ${isSaved?'★':'☆'}
          </button>
        </div>
      </div>`;
  }

  // ─── Map markers ──────────────────────────────────────────────────
  function addMarkersToMap(center, scored) {
    if (!map) return;
    clearMarkers();
    centerMarker = L.marker([center.lat,center.lon], { icon:makeCenterIcon(), zIndexOffset:1000 })
      .addTo(map).bindTooltip('המיקום שלך', { direction:'top', className:'spot-tooltip' });

    const bounds = [[center.lat, center.lon]];
    scored.forEach((spot, i) => {
      const score10 = +(spot.score * 10).toFixed(1);
      const isTop = i === 0;
      const icon = makeScoreIcon(score10, spot.typeInfo?.icon || '📍', isTop, spot.nextEvent?.dir);
      const m = L.marker([spot.lat,spot.lon], { icon, zIndexOffset: isTop?500:100-i })
        .addTo(map)
        .bindPopup(buildPopupHtml(spot, i, score10), { maxWidth:270, className:'spot-popup' });
      m._spotIdx = i;
      spotMarkers.push(m);
      bounds.push([spot.lat, spot.lon]);
      m.on('popupopen', () => {
        highlightListItem(i);
        document.getElementById('list-item-'+i)?.scrollIntoView({ behavior:'smooth', block:'center' });
      });
    });
    map.fitBounds(bounds, { padding:[32,32], maxZoom:14 });
  }

  function highlightListItem(idx) {
    document.querySelectorAll('.spot-list-item').forEach((el, i) => {
      el.style.borderColor = i === idx ? 'rgba(240,180,60,.55)' : 'rgba(255,185,80,.12)';
    });
  }

  // ─── Favorites ────────────────────────────────────────────────────
  window.toggleSpotFav = function(idx) {
    const spot = window.__lastScored?.[idx];
    if (!spot) return;
    const key = `${spot.lat},${spot.lon}`;
    const existing = savedSpots.findIndex(s => `${s.lat},${s.lon}` === key);
    if (existing >= 0) {
      savedSpots.splice(existing, 1);
    } else {
      savedSpots.push({ lat:spot.lat, lon:spot.lon, name:spot.name, elev:spot.elev, type:spot.typeInfo?.label });
    }
    localStorage.setItem('spotFavorites', JSON.stringify(savedSpots));
    renderSavedSpots();
    // update popup button
    const btn = document.getElementById('fav-popup-'+idx);
    if (btn) {
      const isSaved = existing < 0;
      btn.textContent = isSaved ? '★' : '☆';
      btn.style.color = isSaved ? '#ffd46a' : 'rgba(244,232,212,.5)';
    }
  };

  function renderSavedSpots() {
    const el = $('savedSpots');
    if (!el) return;
    if (!savedSpots.length) { el.style.display = 'none'; return; }
    el.style.display = 'block';
    el.innerHTML = `
      <div class="controls-title" style="margin-bottom:8px">⭐ ספוטים שמורים</div>
      ${savedSpots.map((s,i) => `
        <div style="display:flex;align-items:center;gap:8px;padding:8px;background:rgba(255,255,255,.03);
          border:1px solid rgba(255,185,80,.1);border-radius:12px;margin-bottom:6px">
          <div style="flex:1">
            <div style="font-size:13px;font-weight:600;color:var(--text)">${s.name}</div>
            <div style="font-size:11px;color:var(--muted)">${s.type || ''} · ⬆ ${Math.round(s.elev||0)}m</div>
          </div>
          <a href="${wazeUrl(s.lat,s.lon)}" target="_blank"
             style="font-size:11px;padding:5px 8px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);
             border-radius:8px;color:var(--text);text-decoration:none">🚗</a>
          <button onclick="window.removeSavedSpot(${i})"
             style="background:none;border:none;color:rgba(244,232,212,.3);font-size:16px;cursor:pointer">✕</button>
        </div>`).join('')}`;
  }

  window.removeSavedSpot = function(i) {
    savedSpots.splice(i, 1);
    localStorage.setItem('spotFavorites', JSON.stringify(savedSpots));
    renderSavedSpots();
  };

  // ─── Share spot ───────────────────────────────────────────────────
  window.shareSpot = function(idx) {
    const spot = window.__lastScored?.[idx];
    if (!spot) return;
    const url = mapsUrl(spot.lat, spot.lon);
    const text = `${spot.name} — ספוט תצפית מומלץ לשקיעה/זריחה\n${url}`;
    if (navigator.share) {
      navigator.share({ title: spot.name, text, url });
    } else {
      navigator.clipboard.writeText(text).then(() => alert('הקישור הועתק!'));
    }
  };

  // ─── Overpass ─────────────────────────────────────────────────────
  async function fetchOverpassSpots(lat, lon, radiusM, types) {
    // רק סוגים שמשמעותם תצפית — ללא beach/park שנותנים רעש
    const typeFilters = {
      viewpoint: `node["tourism"="viewpoint"]`,
      peak:      `node["natural"="peak"]["name"]`,
      hill:      `node["natural"="hill"]["name"]`,
      tower:     `node["man_made"="observation_tower"]`,
      platform:  `node["amenity"="observation_platform"]`,
      beach:     `node["natural"="beach"]["name"]`,
      park:      `node["leisure"="park"]["name"]`,
    };
    const selected = types.length ? types : ['viewpoint','peak','hill','tower','platform'];
    const lines = selected
      .filter(t => typeFilters[t])
      .map(t => `  ${typeFilters[t]}(around:${radiusM},${lat},${lon});`)
      .join('\n');

    // out tags — מחזיר גם tags כדי לסנן לפי גישה ושם
    const query = `[out:json][timeout:30];
(
${lines}
);
out tags center;`;

    const res = await fetch('https://overpass-api.de/api/interpreter', {
      method:'POST', body:'data='+encodeURIComponent(query),
      headers:{ 'Content-Type':'application/x-www-form-urlencoded' },
    });
    if (!res.ok) throw new Error('Overpass נכשל ('+res.status+')');
    const data = await res.json();

    return (data.elements || []).filter(el => {
      const tags = el.tags || {};
      // פסול: גישה אסורה
      if (tags.access === 'private' || tags.access === 'no') return false;
      // פסול: חייב שיהיה lat/lon
      if (!el.lat || !el.lon) return false;
      // תצפית/מגדל — תמיד תקף גם ללא שם
      if (tags.tourism === 'viewpoint') return true;
      if (tags.man_made === 'observation_tower') return true;
      if (tags.amenity === 'observation_platform') return true;
      // פסגה/גבעה/חוף/פארק — חייב שם
      const name = tags['name:he'] || tags.name || tags['name:en'] || '';
      return name.length > 1;
    });
  }

  // ─── Elevation ────────────────────────────────────────────────────
  async function getElevationsBatch(points) {
    if (!points.length) return [];
    const lats = points.map(p => p.lat).join(',');
    const lons = points.map(p => p.lon).join(',');
    const res = await fetch(`https://api.open-meteo.com/v1/elevation?latitude=${lats}&longitude=${lons}`);
    if (!res.ok) throw new Error('Elevation failed');
    const data = await res.json();
    return Array.isArray(data.elevation) ? data.elevation : [data.elevation];
  }

  // ─── Type helpers ─────────────────────────────────────────────────
  function spotTypeLabel(tags) {
    if (tags?.tourism === 'viewpoint')            return { label:'נקודת תצפית',    icon:'🔭', priority:10 };
    if (tags?.man_made === 'observation_tower')   return { label:'מגדל תצפית',     icon:'🗼', priority:9  };
    if (tags?.amenity === 'observation_platform') return { label:'פלטפורמת תצפית', icon:'🏗', priority:9  };
    if (tags?.natural === 'peak')                 return { label:'פסגה',           icon:'⛰️', priority:8  };
    if (tags?.natural === 'hill')                 return { label:'גבעה',           icon:'🏔️', priority:7  };
    if (tags?.natural === 'beach')                return { label:'חוף ים',         icon:'🏖️', priority:6  };
    if (tags?.leisure === 'park')                 return { label:'פארק',           icon:'🌳', priority:5  };
    return                                               { label:'נקודה',          icon:'📍', priority:4  };
  }

  function spotName(tags) {
    return tags?.['name:he'] || tags?.name || tags?.['name:en'] || 'נקודה ללא שם';
  }


  function spotThumb(spot) {
    const label = spot.typeInfo?.label || '';
    const tags = spot.tags || {};
    const name = spot.name || '';
    if (tags?.natural === 'beach' || /חוף|ים/.test(label + ' ' + name)) {
      return { src:'./assets/spots/spot-coast.png', alt:'חוף' };
    }
    if (tags?.natural === 'peak' || tags?.natural === 'hill' || /פסגה|גבעה|הר|תצפית|מגדל|פלטפורמה/.test(label + ' ' + name)) {
      return { src:'./assets/spots/spot-mountain.png', alt:'הר' };
    }
    if (tags?.leisure === 'park' || /יער|פארק/.test(label + ' ' + name)) {
      return { src:'./assets/spots/spot-forest.png', alt:'יער' };
    }
    if (/מדבר|מכתש|רמון/.test(name)) {
      return { src:'./assets/spots/spot-desert.png', alt:'מדבר' };
    }
    return { src:'./assets/spots/spot-mountain.png', alt:'נקודת תצפית' };
  }

  function recommendationTags(spot, index) {
    const tags = [];
    if (index < 3) tags.push('מומלץ היום');
    if ((spot.horizScore || 0) >= 0.75) tags.push('אופק פתוח');
    if ((spot.score || 0) >= 0.78) tags.push('צבעוניות גבוהה');
    if ((spot.score || 0) >= 0.62 && tags.length < 3) tags.push('מתאים לשקיעה');
    return tags.slice(0, 3);
  }

  // ─── Score ────────────────────────────────────────────────────────
  function scoreSpot(center, spot, elevRange, nextEvent) {
    const d = haversineKm(center.lat, center.lon, spot.lat, spot.lon);
    // אם יש מרחק כביש — השתמש בו לציון (מעניש נקודות עם עקיפות ארוכות)
    const effectiveKm = spot.roadMeters ? spot.roadMeters / 1000 : d;
    const x = effectiveKm / Math.max(0.001, center.radiusKm);
    const distScore = x < 0.1 ? 0.4 : x < 0.3 ? 0.7 : x < 0.8 ? 1.0 : Math.max(0, 1-(x-0.8)*2);
    const elevNorm  = elevRange.max > elevRange.min
      ? (spot.elev - elevRange.min) / (elevRange.max - elevRange.min) : 0.5;
    const typePriority = (spot.typeInfo?.priority || 5) / 10;

    // כיוון האופק לאירוע הבא
    const bearing = bearingDeg(center.lat, center.lon, spot.lat, spot.lon);
    const hScore  = horizonScore(bearing, nextEvent.dir);

    // משקלות: גובה 30%, כיוון אופק 30%, מרחק 25%, סוג 15%
    const score = Math.min(1, 0.30*elevNorm + 0.30*hScore + 0.25*distScore + 0.15*typePriority);
    return { d, score, horizScore: hScore, bearing };
  }

  // ─── Render list ──────────────────────────────────────────────────
  function renderList(scored) {
    const container = $('results');
    if (!container) return;
    container.innerHTML = '';
    window.__lastScored = scored;

    scored.forEach((spot, i) => {
      const score10 = +(spot.score * 10).toFixed(1);
      const ti = spot.typeInfo || { label:'נקודה' };
      const isSaved = savedSpots.some(s => s.lat === spot.lat && s.lon === spot.lon);
      const horizPct = Math.round((spot.horizScore || 0) * 100);
      const thumb = spotThumb(spot);
      const recos = recommendationTags(spot, i);

      const el = document.createElement('article');
      el.className = 'spot-result-card';
      el.id = 'list-item-' + i;
      el.style.cursor = 'pointer';
      el.innerHTML = `
        <div class="spot-result-card__thumb-wrap">
          <img class="spot-result-card__thumb" src="${thumb.src}" alt="${thumb.alt}">
        </div>
        <div class="spot-result-card__main">
          <div class="spot-result-card__head">
            <div>
              <div class="spot-result-card__title">#${i+1} ${spot.name}</div>
              <div class="spot-result-card__subtitle">${ti.label} · ⬆ ${Math.round(spot.elev)}m</div>
            </div>
            <div class="spot-result-card__score">${score10}</div>
          </div>

          <div class="spot-result-card__meta">
            <span class="spot-chip">${spot.roadMeters ? fmtRoadKm(spot.roadMeters) : spot.d.toFixed(1) + ' ק"מ'}</span>
            <span class="spot-chip">${spot.roadSeconds ? fmtDrive(spot.roadSeconds) : '~' + Math.round(spot.d / 50 * 60) + " דק'"}</span>
            <span class="spot-chip">אופק ${horizPct}%</span>
            ${recos.map(tag => `<span class="spot-chip spot-chip--accent">${tag}</span>`).join('')}
          </div>

          <div class="spot-result-card__actions">
            <a href="${mapsUrl(spot.lat,spot.lon)}" target="_blank" onclick="event.stopPropagation()" class="spot-action-btn spot-action-btn--primary">מפות</a>
            <a href="${wazeUrl(spot.lat,spot.lon)}" target="_blank" onclick="event.stopPropagation()" class="spot-action-btn">Waze</a>
            <button onclick="event.stopPropagation();window.toggleSpotFav(${i})" id="fav-btn-${i}" class="spot-icon-btn">${isSaved ? '★' : '☆'}</button>
            <button onclick="event.stopPropagation();window.shareSpot(${i})" class="spot-icon-btn">⤴</button>
          </div>
        </div>`;

      el.addEventListener('click', () => {
        const m = spotMarkers[i];
        if (m && map) {
          map.setView(m.getLatLng(), 15, { animate:true });
          m.openPopup();
          highlightListItem(i);
          $('spotMap')?.scrollIntoView({ behavior:'smooth', block:'start' });
        }
      });
      container.appendChild(el);
    });
  }

  // ─── Main ─────────────────────────────────────────────────────────
  async function findSpots() {
    const loc = window.__twilightLoc;
    if (!loc) { alert('בחר מיקום (GPS או חיפוש) ואז נסה שוב.'); return; }

    const radiusKm = Number($('radiusKm')?.value || 12);
    const topN     = Number($('topN')?.value || 8);
    const center   = { lat:loc.lat, lon:loc.lon, radiusKm };

    // זיהוי האירוע הבא
    const nextEvent = getNextEvent(loc.lat, loc.lon);

    // עדכון כותרת
    const subEl = document.querySelector('.spot-brand__sub');
    if (subEl) subEl.textContent = `נקודות תצפית ל${nextEvent.label} ${nextEvent.icon}`;

    $('resultsCard').style.display = 'block';
    initMap(loc.lat, loc.lon);
    clearMarkers();

    const summary = $('resultSummary');
    if (summary) summary.textContent = 'מחפש נקודות תצפית…';
    $('results').innerHTML = '';

    // סינון סוגים
    const typeChecks = [...document.querySelectorAll('.type-filter:checked')].map(el => el.value);

    let spots = [], usedOverpass = false;
    try {
      const elements = await fetchOverpassSpots(loc.lat, loc.lon, radiusKm * 1000, typeChecks);
      spots = elements.map(el => ({
        lat:el.lat, lon:el.lon, tags:el.tags||{},
        name:spotName(el.tags), typeInfo:spotTypeLabel(el.tags), fromGrid:false,
      }));
      usedOverpass = true;
      if (summary) summary.textContent = `נמצאו ${spots.length} נקודות. מחשב גבהים…`;
    } catch(e) {
      console.warn('Overpass failed:', e);
      if (summary) summary.textContent = 'Overpass לא זמין — עובר לגריד…';
    }

    if (!spots.length) {
      if (summary) summary.textContent = `לא נמצאו נקודות תצפית מאומתות ברדיוס ${radiusKm} ק"מ. נסה להגדיל את הרדיוס.`;
      $('resultsCard').style.display = 'none';
      return;
    }

    try {
      const batch = spots.slice(0, 100);
      const elevs = await getElevationsBatch(batch);
      spots = batch.map((s,i) => ({ ...s, elev:elevs[i]??0 }));
    } catch {
      spots = spots.map(s => ({ ...s, elev:0 }));
    }

    // סינון מחמיר: רק נקודות שבאמת בתוך הרדיוס (haversine מדויק)
    spots = spots.filter(s => haversineKm(center.lat, center.lon, s.lat, s.lon) <= radiusKm);

    if (!spots.length) {
      if (summary) summary.textContent = `לא נמצאו נקודות ברדיוס ${radiusKm} ק"מ לאחר סינון. נסה להגדיל.`;
      return;
    }

    // מרחק וזמן כביש — OSRM Table API (קריאה אחת לכל הנקודות)
    if (summary) summary.textContent = 'מחשב מרחקי כביש…';
    const roadData = await fetchRoadDistances(center, spots);
    if (roadData) {
      spots = spots
        .map((s, i) => ({
          ...s,
          roadMeters:  roadData[i]?.roadMeters  ?? null,
          roadSeconds: roadData[i]?.roadSeconds ?? null,
        }))
        .filter(s => s.roadMeters !== null && s.roadSeconds !== null);

      if (!spots.length) {
        if (summary) summary.textContent = 'לא נמצאו נקודות עם גישה בכביש. נסה רדיוס אחר.';
        return;
      }
    }

    const elevRange = {
      min: Math.min(...spots.map(s=>s.elev)),
      max: Math.max(...spots.map(s=>s.elev)),
    };

    const scored = spots
      .map(s => {
        const { d, score, horizScore, bearing } = scoreSpot(center, s, elevRange, nextEvent);
        return { ...s, d, score, horizScore, bearing, nextEvent };
      })
      .sort((a,b) => b.score - a.score)
      .slice(0, topN);

    if (!scored.length) {
      if (summary) summary.textContent = 'לא נמצאו תוצאות. נסה רדיוס גדול יותר.';
      return;
    }

    if (summary) summary.textContent = `${nextEvent.icon} ${scored.length} נקודות מאומתות ל${nextEvent.label} — לחץ על marker לפרטים`;

    addMarkersToMap(center, scored);
    renderList(scored);
    renderSavedSpots();
  }

  // ─── Wire UI ──────────────────────────────────────────────────────
  function wireUI() {
    const radiusKm = $('radiusKm'), radiusVal = $('radiusVal');
    if (radiusKm && radiusVal) {
      const sync = () => radiusVal.textContent = radiusKm.value;
      radiusKm.addEventListener('input', sync); sync();
    }
    const btnFind = $('btnFind');
    if (btnFind) {
      btnFind.addEventListener('click', async () => {
        btnFind.disabled = true; btnFind.textContent = 'מחפש…';
        try { await findSpots(); }
        catch(e) { console.error(e); alert('שגיאה: '+(e.message||e)); }
        finally { btnFind.disabled=false; btnFind.textContent='🔭 מצא נקודות'; }
      });
    }
    renderSavedSpots();
  }

  document.addEventListener('DOMContentLoaded', wireUI);
})();

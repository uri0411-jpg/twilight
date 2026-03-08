
(() => {
  // ── In-memory forecast cache (30 min TTL) ──────────────────────────
  const _cache = new Map();
  const CACHE_TTL = 30 * 60 * 1000;
  function _cacheKey(lat, lon) { return `${Math.round(lat*100)/100},${Math.round(lon*100)/100}`; }
  function _getCached(lat, lon) {
    const k = _cacheKey(lat, lon);
    const entry = _cache.get(k);
    if (!entry) return null;
    if (Date.now() - entry.ts > CACHE_TTL) { _cache.delete(k); return null; }
    return entry.data;
  }
  function _setCached(lat, lon, data) {
    _cache.set(_cacheKey(lat, lon), { data, ts: Date.now() });
  }

  const DAYS_HE = ['א׳','ב׳','ג׳','ד׳','ה׳','ו׳','ש׳'];

  function fmtTime(date) {
    return (!date || isNaN(date.getTime())) ? '--:--'
      : date.toLocaleTimeString('he-IL', { hour:'2-digit', minute:'2-digit' });
  }

  function weatherCodeText(code) {
    if (code === 0) return 'בהיר';
    if (code <= 2) return 'מעונן חלקית';
    if (code <= 3) return 'מעונן';
    if (code <= 49) return 'אובך / ערפל';
    if (code <= 67) return 'גשם';
    if (code <= 82) return 'ממטרים';
    return 'סוער';
  }

  function calcScore(cloud, cloudHigh, cloudMid, cloudLow, rain, humid, visKm, windMs, dust, aod, pm25, wcode) {
    const midCloudIdeal = 35 - Math.min(35, Math.abs((cloudMid ?? 25) - 35));
    const highBonus = (cloudHigh ?? 0) > 20 ? Math.min(1.5, (cloudHigh - 20) * 0.03) : 0;
    const lowPenalty = (cloudLow ?? 0) > 40 ? Math.min(1.5, (cloudLow - 40) * 0.03) : 0;
    const cloudScore = Math.max(0, Math.min(4, (midCloudIdeal / 35) * 4 + highBonus - lowPenalty));
    const aodBonus = (aod ?? 0) > 0.1 && (aod ?? 0) < 0.8 ? Math.min(0.8, ((aod ?? 0) - 0.1) * 1.1) : 0;
    const pm25Penalty = (pm25 ?? 0) > 50 ? Math.min(1.5, ((pm25 ?? 0) - 50) * 0.02) : 0;
    const visPenalty = (visKm ?? 20) < 5 ? Math.min(2, (5 - visKm) * 0.4) : 0;
    const windBonus = (windMs ?? 5) >= 5 && (windMs ?? 5) <= 15 ? 0.5 : 0;
    const humidPenalty = (humid ?? 60) > 90 ? 1.0 : 0;
    const rainPenalty = (rain ?? 0) > 80 ? 4.0 : (rain ?? 0) > 40 ? 2.0 : (rain ?? 0) > 15 ? 1.0 : 0;
    const wcodePenalty = wcode >= 95 ? 4.0 : wcode >= 80 ? 2.5 : wcode >= 61 ? 1.8 : wcode >= 45 ? 0.8 : 0;
    const raw = cloudScore + 2 + aodBonus + windBonus - pm25Penalty - visPenalty - humidPenalty - rainPenalty - wcodePenalty;
    return Math.max(1, Math.min(10, Math.round(raw * 10) / 10));
  }

  function qualityInfo(score) {
    if (score >= 8.2) return { label:'מצוין לצפייה', cls:'excellent', barCls:'bar-excellent' };
    if (score >= 6.8) return { label:'טוב מאוד לצפייה', cls:'good', barCls:'bar-good' };
    if (score >= 5.2) return { label:'סביר לצפייה', cls:'fair', barCls:'bar-fair' };
    return { label:'חלש יחסית', cls:'poor', barCls:'bar-poor' };
  }

  async function fetchForecast(lat, lon) {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=temperature_2m,cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high,precipitation_probability,relative_humidity_2m,visibility,wind_speed_10m,weathercode&daily=weathercode,temperature_2m_max,temperature_2m_min,sunset,sunrise,precipitation_probability_max,cloud_cover_mean&timezone=auto&forecast_days=7`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('שגיאה בנתוני מזג האוויר');
    return res.json();
  }

  async function fetchAirQuality(lat, lon) {
    try {
      const url = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}&hourly=aerosol_optical_depth,dust,pm2_5&timezone=auto&forecast_days=7`;
      const res = await fetch(url);
      if (!res.ok) return null;
      return res.json();
    } catch {
      return null;
    }
  }

  function findClosestHourIdx(eventDate, hourlyTimes) {
    const target = eventDate.getTime();
    let idx = 0, best = Infinity;
    hourlyTimes.forEach((t, i) => {
      const diff = Math.abs(new Date(t).getTime() - target);
      if (diff < best) { best = diff; idx = i; }
    });
    return idx;
  }

  function avgWindow(arr, center, fallback = 0) {
    if (!Array.isArray(arr) || !arr.length) return fallback;
    return arr[Math.max(0, Math.min(arr.length - 1, center))] ?? fallback;
  }

  function scoreForEvent(eventDate, fData, aqData, wcode) {
    const ci = findClosestHourIdx(eventDate, fData.hourly.time);
    const cloud     = avgWindow(fData.hourly.cloud_cover, ci, 40);
    const cloudHigh = avgWindow(fData.hourly.cloud_cover_high, ci, 30);
    const cloudMid  = avgWindow(fData.hourly.cloud_cover_mid, ci, 20);
    const cloudLow  = avgWindow(fData.hourly.cloud_cover_low, ci, 20);
    const rain      = avgWindow(fData.hourly.precipitation_probability, ci, 0);
    const humid     = avgWindow(fData.hourly.relative_humidity_2m, ci, 60);
    const visKm     = avgWindow(fData.hourly.visibility, ci, 18000) / 1000;
    const windMs    = avgWindow(fData.hourly.wind_speed_10m, ci, 8);
    const temp      = avgWindow(fData.hourly.temperature_2m, ci, 0);
    let dust = 0, aod = 0, pm25 = 0;
    if (aqData?.hourly?.time) {
      const aqci = findClosestHourIdx(eventDate, aqData.hourly.time);
      dust = avgWindow(aqData.hourly.dust, aqci, 0);
      aod  = avgWindow(aqData.hourly.aerosol_optical_depth, aqci, 0);
      pm25 = avgWindow(aqData.hourly.pm2_5, aqci, 0);
    }
    return {
      score: calcScore(cloud, cloudHigh, cloudMid, cloudLow, rain, humid, visKm, windMs, dust, aod, pm25, wcode),
      cloud, humid, visKm, windMs, dust, temp,
      weather: weatherCodeText(wcode),
    };
  }

  function buildWeekly(data, aqData, loc) {
    const today = new Date();
    const weekly = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i);
      const sun = window.SunCalc?.calc(loc.lat, loc.lon, d);
      const wcode = data.daily.weathercode[i] ?? 0;
      const sunset = sun?.sunset ? scoreForEvent(sun.sunset, data, aqData, wcode) : { score: 5 };
      weekly.push({
        name: i === 0 ? 'היום' : i === 1 ? 'מחר' : DAYS_HE[d.getDay()],
        date: `${d.getDate()}.${d.getMonth()+1}`,
        time: fmtTime(new Date(data.daily.sunset[i])),
        score: sunset.score,
        q: qualityInfo(sunset.score),
        max: Math.round(data.daily.temperature_2m_max?.[i] ?? 0),
        min: Math.round(data.daily.temperature_2m_min?.[i] ?? 0)
      });
    }
    return weekly;
  }

  function buildHourly(data, targetDate) {
    const startIdx = findClosestHourIdx(targetDate, data.hourly.time);
    const result = [];
    for (let i = startIdx - 2; i <= startIdx + 3; i++) {
      if (i < 0 || i >= data.hourly.time.length) continue;
      const t = new Date(data.hourly.time[i]);
      result.push({
        time: fmtTime(t),
        cloud: Math.round(data.hourly.cloud_cover?.[i] ?? 0),
        visKm: ((data.hourly.visibility?.[i] ?? 0) / 1000).toFixed(1),
        weather: weatherCodeText(data.hourly.weathercode?.[i] ?? 0),
        temp: Math.round(data.hourly.temperature_2m?.[i] ?? 0)
      });
    }
    return result;
  }

  function buildDetailCards(data, aqData, loc) {
    const today = new Date();
    const cards = [];
    for (let i = 0; i < 3; i++) {
      const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i);
      const cardId = 'd' + i;
      const wcode = data.daily.weathercode[i] ?? 0;
      const sun = window.SunCalc?.calc(loc.lat, loc.lon, d);
      const fallbackDate = new Date();
      const sunset  = scoreForEvent(sun?.sunset  ?? fallbackDate, data, aqData, wcode);
      const sunrise = scoreForEvent(sun?.sunrise ?? fallbackDate, data, aqData, wcode);
      const ssQ = qualityInfo(sunset.score);
      const srQ = qualityInfo(sunrise.score);

      cards.push(`
        <article class="forecast-day-card${i===0 ? ' forecast-day-card--today' : ''}">
          <div class="forecast-day-card__head">
            <div>
              <div class="forecast-day-card__name">${i===0 ? 'היום' : i===1 ? 'מחר' : DAYS_HE[d.getDay()]}</div>
              <div class="forecast-day-card__date">${d.toLocaleDateString('he-IL')}</div>
            </div>
            <div class="forecast-day-card__weather">${weatherCodeText(wcode)}</div>
          </div>

          <div class="forecast-events">
            <div class="forecast-event forecast-event--sunrise">
              <div class="forecast-event__time">${fmtTime(sun.sunrise)}</div>
              <div class="forecast-event__score quality-${srQ.cls}">${sunrise.score}/10</div>
              <div class="forecast-event__text">${srQ.label}</div>
              <button class="notif-day-btn" id="notif-sunrise-${i}" data-type="sunrise" data-day="${i}" onclick="window.toggleDayNotif(this)">התראה לזריחה</button>
            </div>

            <div class="forecast-event">
              <div class="forecast-event__label">שקיעה</div>
              <div class="forecast-event__time">${fmtTime(sun.sunset)}</div>
              <div class="forecast-event__score quality-${ssQ.cls}">${sunset.score}/10</div>
              <div class="forecast-event__text">${ssQ.label}</div>
              <button class="notif-day-btn" id="notif-sunset-${i}" data-type="sunset" data-day="${i}" onclick="window.toggleDayNotif(this)">התראה לשקיעה</button>
            </div>
          </div>

          <button class="accordion-btn" onclick="toggleAccordion('${cardId}')"><span>פרטי תנאים</span><span class="accordion-arrow">▼</span></button>
          <div class="weather-detail" id="detail-${cardId}">
            <div class="weather-grid">
              <div class="weather-item"><div class="weather-item-icon">☁️</div><div class="weather-item-text">עננות ${Math.round(sunset.cloud)}%</div></div>
              <div class="weather-item"><div class="weather-item-icon">👁</div><div class="weather-item-text">ראות ${sunset.visKm.toFixed(1)} ק"מ</div></div>
              <div class="weather-item"><div class="weather-item-icon">💧</div><div class="weather-item-text">לחות ${Math.round(sunset.humid)}%</div></div>
              <div class="weather-item"><div class="weather-item-icon">🌬</div><div class="weather-item-text">רוח ${sunset.windMs.toFixed(1)} מ'/ש</div></div>
            </div>
          </div>
        </article>
      `);
    }
    return cards.join('');
  }

  function toggleAccordion(id) {
    document.getElementById('detail-' + id)?.classList.toggle('open');
  }
  window.toggleAccordion = toggleAccordion;

  function render(data, aqData, loc) {
    const container = document.getElementById('mainContent');
    if (!container) return;

    const now = new Date();
    const currentIdx = findClosestHourIdx(now, data.hourly.time);
    const todaySun = window.SunCalc?.calc(loc.lat, loc.lon, now) || null;
    const sunsetTime  = new Date(data?.daily?.sunset?.[0]  ?? Date.now() + 3600000);
    const sunriseTime = new Date(data?.daily?.sunrise?.[0] ?? Date.now() - 3600000);
    const todayEval = todaySun ? scoreForEvent(todaySun.sunset, data, aqData, data.daily.weathercode[0] ?? 0) : { score:5, cloud:40, visKm:12, humid:60, windMs:5, temp:0, weather:'בהיר' };
    const sunriseEval = todaySun ? scoreForEvent(todaySun.sunrise, data, aqData, data.daily.weathercode[0] ?? 0) : { score:5 };
    const q = qualityInfo(todayEval.score);
    window.__twilightTodayScore = todayEval.score;  // for notifications.js
    const weekly = buildWeekly(data, aqData, loc);
    const hourly = buildHourly(data, sunsetTime);
    const currentTemp = Math.round(data.hourly.temperature_2m?.[currentIdx] ?? todayEval.temp ?? 0);
    const currentWeather = weatherCodeText(data.hourly.weathercode?.[currentIdx] ?? data.daily.weathercode?.[0] ?? 0);

    const html = `
      <section class="forecast-screen">
        <section class="forecast-summary-card">
          <div class="forecast-summary-card__top">
            <div>
              <div class="forecast-kicker">הערב הקרוב</div>
              <h2 class="forecast-summary-card__title">איכות שקיעה ${q.label}</h2>
            </div>
            <div class="forecast-summary-card__score" id="sunset-score">${todayEval.score}<span>/10</span></div>
          </div>

          <div class="forecast-main-row">
            <div class="forecast-main-time">
              <div class="forecast-main-time__label">שקיעה היום</div>
              <div class="forecast-main-time__value">${fmtTime(sunsetTime)}</div>
              <div class="forecast-main-time__sub">זריחה ${fmtTime(sunriseTime)}</div>
            </div>
            <div class="forecast-current-boxes">
              <div class="forecast-mini-box">
                <span class="forecast-mini-box__label">מזג אוויר</span>
                <strong>${currentWeather}</strong>
              </div>
              <div class="forecast-mini-box">
                <span class="forecast-mini-box__label">טמפרטורה</span>
                <strong>${currentTemp}°</strong>
              </div>
            </div>
          </div>

          <div class="forecast-stats-grid">
            <div class="forecast-stat"><span>עננות</span><strong>${Math.round(todayEval.cloud)}%</strong></div>
            <div class="forecast-stat"><span>ראות</span><strong>${todayEval.visKm.toFixed(1)} ק"מ</strong></div>
            <div class="forecast-stat"><span>לחות</span><strong>${Math.round(todayEval.humid)}%</strong></div>
            <div class="forecast-stat"><span>רוח</span><strong>${todayEval.windMs.toFixed(1)} מ'/ש</strong></div>
            <div class="forecast-stat"><span>ציון זריחה</span><strong>${sunriseEval.score}/10</strong></div>
            <div class="forecast-stat"><span>שמיים</span><strong>${todayEval.weather}</strong></div>
          </div>
        </section>

        <section class="forecast-panel">
          <div class="section-title">תחזית שבועית של צבעוניות</div>
          <div class="section-sub">גלול אופקית כדי לראות את איכות השקיעה בכל יום.</div>
          <div class="weekly-scroll">
            ${weekly.map(day => `
              <article class="weekly-day-card weekly-day-card--${day.q.cls}">
                <div class="weekly-day-card__name">${day.name}</div>
                <div class="weekly-day-card__date">${day.date}</div>
                <div class="weekly-day-card__score">${day.score}</div>
                <div class="weekly-day-card__time">${day.time}</div>
                <div class="weekly-day-card__temps">${day.max}° / ${day.min}°</div>
              </article>
            `).join('')}
          </div>
        </section>

        <section class="forecast-panel">
          <div class="section-title">חלון שעות עד השקיעה</div>
          <div class="section-sub">התנאים לשעות שסביב השקיעה היום.</div>
          <div class="hourly-scroll">
            ${hourly.map(item => `
              <article class="hourly-chip">
                <div class="hourly-chip__time">${item.time}</div>
                <div class="hourly-chip__temp">${item.temp}°</div>
                <div class="hourly-chip__meta">${item.weather}</div>
                <div class="hourly-chip__meta">עננות ${item.cloud}%</div>
                <div class="hourly-chip__meta">ראות ${item.visKm} ק"מ</div>
              </article>
            `).join('')}
          </div>
        </section>

        <section class="forecast-panel">
          <div class="section-title">פירוט ימים קרובים</div>
          <div class="section-sub">מבנה תחזית מסודר עם שקיעה, זריחה ותנאי שמיים.</div>
          <div class="forecast-days-stack">${buildDetailCards(data, aqData, loc)}</div>
        </section>
      </section>
    `;

    container.innerHTML = html;
    restoreNotifButtons();
  }

  async function loadForecast(loc) {
    const container = document.getElementById('mainContent');
    // Check memory cache first
    const cached = _getCached(loc.lat, loc.lon);
    if (cached) { render(cached.data, cached.aqData, loc); return; }
    if (container) container.innerHTML = '<div class="loading-state"><span>🌤️</span><p>טוען תחזית...</p></div>';
    try {
      const [data, aqData] = await Promise.all([fetchForecast(loc.lat, loc.lon), fetchAirQuality(loc.lat, loc.lon)]);
      _setCached(loc.lat, loc.lon, { data, aqData });
      render(data, aqData, loc);
    } catch (e) {
      console.error(e);
      if (container) container.innerHTML = `<div class="loading-state"><span>⚠️</span><p>שגיאה בטעינת התחזית. בדוק חיבור לאינטרנט.</p></div>`;
    }
  }

  window.toggleDayNotif = function(btn) {
    const type = btn.dataset.type;
    const dayIdx = parseInt(btn.dataset.day, 10);
    const activeKey = `notif_active_${type}_${dayIdx}`;
    const minKey = `notif_min_${type}_${dayIdx}`;
    if (btn.classList.contains('active')) {
      btn.classList.remove('active');
      btn.textContent = type === 'sunset' ? 'התראה לשקיעה' : 'התראה לזריחה';
      localStorage.removeItem(activeKey);
      return;
    }
    const proceed = () => {
      const minBefore = parseInt(localStorage.getItem(minKey)) || 30;
      activateNotif(btn, type, dayIdx, minBefore);
    };
    if (!('Notification' in window)) return;
    if (Notification.permission === 'granted') proceed();
    else if (Notification.permission !== 'denied') Notification.requestPermission().then(p => p === 'granted' && proceed());
  };

  function activateNotif(btn, type, dayIdx, minBefore) {
    const activeKey = `notif_active_${type}_${dayIdx}`;
    const minKey = `notif_min_${type}_${dayIdx}`;
    localStorage.setItem(activeKey, '1');
    localStorage.setItem(minKey, String(minBefore));
    btn.classList.add('active');
    btn.textContent = `✓ ${type === 'sunset' ? 'שקיעה' : 'זריחה'} — ${minBefore} דק׳ לפני`;
  }

  function restoreNotifButtons() {
    for (let i = 0; i < 3; i++) {
      ['sunset', 'sunrise'].forEach(type => {
        const btn = document.getElementById(`notif-${type}-${i}`);
        if (btn && localStorage.getItem(`notif_active_${type}_${i}`)) {
          const min = parseInt(localStorage.getItem(`notif_min_${type}_${i}`)) || 30;
          activateNotif(btn, type, i, min);
        }
      });
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    if (window.__twilightLoc) loadForecast(window.__twilightLoc);
  });
  window.addEventListener('twilight:loc', e => loadForecast(e.detail));
  window.Forecast = { load: loadForecast };
})();

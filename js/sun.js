// sun.js - חישוב אסטרונומי מדויק (אלגוריתם NOAA)
// מחשב: זריחה, שקיעה, golden hour, blue hour, civil/nautical/astronomical twilight
(() => {

  // ─── עזרים מתמטיים ────────────────────────────────────────────────
  const deg  = (r) => r * 180 / Math.PI;
  const rad  = (d) => d * Math.PI / 180;
  const mod  = (a, n) => ((a % n) + n) % n;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  // ─── NOAA Solar Calculator ─────────────────────────────────────────
  function julianDay(date) {
    return date.getTime() / 86400000 + 2440587.5;
  }

  function julianCentury(jd) {
    return (jd - 2451545.0) / 36525.0;
  }

  function geomMeanLongSun(t) {
    return mod(280.46646 + t * (36000.76983 + t * 0.0003032), 360);
  }

  function geomMeanAnomalySun(t) {
    return 357.52911 + t * (35999.05029 - 0.0001537 * t);
  }

  function eccentricityEarthOrbit(t) {
    return 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  }

  function sunEqOfCenter(t) {
    const m  = rad(geomMeanAnomalySun(t));
    return Math.sin(m) * (1.914602 - t * (0.004817 + 0.000014 * t))
      + Math.sin(2 * m) * (0.019993 - 0.000101 * t)
      + Math.sin(3 * m) * 0.000289;
  }

  function sunTrueLong(t) {
    return geomMeanLongSun(t) + sunEqOfCenter(t);
  }

  function sunApparentLong(t) {
    const o = sunTrueLong(t) - 0.00569 - 0.00478 * Math.sin(rad(125.04 - 1934.136 * t));
    return o;
  }

  function meanObliquityOfEcliptic(t) {
    return 23 + (26 + (21.448 - t * (46.8150 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  }

  function obliquityCorrected(t) {
    return meanObliquityOfEcliptic(t) + 0.00256 * Math.cos(rad(125.04 - 1934.136 * t));
  }

  function sunDeclination(t) {
    return deg(Math.asin(Math.sin(rad(obliquityCorrected(t))) * Math.sin(rad(sunApparentLong(t)))));
  }

  function equationOfTime(t) {
    const e   = eccentricityEarthOrbit(t);
    const eps = rad(obliquityCorrected(t));
    const l0  = rad(geomMeanLongSun(t));
    const m   = rad(geomMeanAnomalySun(t));
    const y   = Math.tan(eps / 2) ** 2;
    const eot = y * Math.sin(2 * l0)
      - 2 * e * Math.sin(m)
      + 4 * e * y * Math.sin(m) * Math.cos(2 * l0)
      - 0.5 * y * y * Math.sin(4 * l0)
      - 1.25 * e * e * Math.sin(2 * m);
    return deg(eot) * 4;          // דקות
  }

  // ─── חישוב זמן עבור זנית נתון ──────────────────────────────────────
  // zenith: 90.833 = sunrise/sunset, 96 = civil, 102 = nautical, 108 = astronomical
  function calcSunriseSetUTC(rise, jd, lat, lon, zenith) {
    const t    = julianCentury(jd);
    const decl = rad(sunDeclination(t));
    const latR = rad(lat);
    const cosH = (Math.cos(rad(zenith)) - Math.sin(latR) * Math.sin(decl))
                / (Math.cos(latR) * Math.cos(decl));

    if (cosH >  1) return null;   // השמש לא עולה
    if (cosH < -1) return null;   // השמש לא שוקעת

    // H = זווית שעה בעלות/שקיעה
    // זריחה: noon - H*4, שקיעה: noon + H*4
    const H    = deg(Math.acos(cosH));  // תמיד חיובי (0-180°)
    const noon = 720 - 4 * lon - equationOfTime(t);   // UTC minutes
    return rise ? noon - H * 4 : noon + H * 4;        // UTC minutes
  }

  function utcMinToDate(date, utcMin) {
    if (utcMin === null) return null;
    const d = new Date(date);
    d.setUTCHours(0, 0, 0, 0);
    d.setTime(d.getTime() + utcMin * 60000);
    return d;
  }

  // ─── API ראשי ───────────────────────────────────────────────────────
  /**
   * calc(lat, lon, date?) → אובייקט עם כל הזמנים
   * כל שדה הוא Date או null (אם אין זריחה/שקיעה)
   */
  function calc(lat, lon, date) {
    date = date || new Date();
    const jd = julianDay(date);

    const make = (rise, zenith) => utcMinToDate(date, calcSunriseSetUTC(rise, jd, lat, lon, zenith));

    const astronomicalDawn  = make(true,  108);
    const nauticalDawn      = make(true,  102);
    const civilDawn         = make(true,   96);
    const sunrise           = make(true,  90.833);
    const sunset            = make(false, 90.833);
    const civilDusk         = make(false,  96);
    const nauticalDusk      = make(false, 102);
    const astronomicalDusk  = make(false, 108);

    // Golden Hour: מזריחה עד +60 דקות / מ-60 דקות לפני שקיעה
    const goldenHourMorningEnd  = sunrise  ? new Date(sunrise.getTime()  + 60 * 60000) : null;
    const goldenHourEveningStart = sunset  ? new Date(sunset.getTime()   - 60 * 60000) : null;

    // Blue Hour: ~20 דקות לפני/אחרי civil twilight
    const blueHourMorningStart  = civilDawn ? new Date(civilDawn.getTime() - 20 * 60000) : null;
    const blueHourMorningEnd    = sunrise;
    const blueHourEveningStart  = sunset;
    const blueHourEveningEnd    = civilDusk ? new Date(civilDusk.getTime() + 20 * 60000) : null;

    // Solar Noon
    const t        = julianCentury(jd);
    const noonUTC  = 720 - 4 * lon - equationOfTime(t);
    const solarNoon = utcMinToDate(date, noonUTC);

    // Day length
    let dayLengthMin = null;
    if (sunrise && sunset) dayLengthMin = (sunset - sunrise) / 60000;

    return {
      astronomicalDawn,
      nauticalDawn,
      civilDawn,
      blueHourMorningStart,
      blueHourMorningEnd,
      sunrise,
      goldenHourMorningEnd,
      solarNoon,
      goldenHourEveningStart,
      sunset,
      blueHourEveningStart,
      blueHourEveningEnd,
      civilDusk,
      nauticalDusk,
      astronomicalDusk,
      dayLengthMin,
    };
  }

  // ─── פורמט תצוגה ────────────────────────────────────────────────────
  function fmt(date, timeZone) {
    if (!date) return "--:--";
    return date.toLocaleTimeString("he-IL", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
  }

  function fmtDuration(minutes) {
    if (minutes === null) return "--";
    const h = Math.floor(minutes / 60);
    const m = Math.round(minutes % 60);
    return `${h}:${String(m).padStart(2, "0")}`;
  }

  // ─── ציון איכות שקיעה (0–10) ────────────────────────────────────────
  // מבוסס על נתוני מזג אוויר מ-Open-Meteo (אם זמינים)
  // קורא כ-async מבחוץ
  async function fetchWeatherScore(lat, lon, date) {
    try {
      const d = (date || new Date()).toISOString().slice(0, 10);
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}`
        + `&daily=weathercode,cloud_cover_mean,precipitation_probability_max`
        + `&start_date=${d}&end_date=${d}&timezone=auto`;
      const res = await fetch(url);
      if (!res.ok) throw new Error("weather fetch failed");
      const data = await res.json();

      const cloud = data?.daily?.cloud_cover_mean?.[0] ?? 50;
      const rain  = data?.daily?.precipitation_probability_max?.[0] ?? 0;
      const wcode = data?.daily?.weathercode?.[0] ?? 0;

      // עננות חלקית (30-60%) → שקיעות הכי יפות
      const cloudScore = cloud < 10  ? 5          // שמיים נקיים — שקיעה רגילה
        : cloud < 35 ? 8             // עננות קלה — יפה
        : cloud < 65 ? 10            // עננות בינונית — מושלם לצבעים
        : cloud < 85 ? 6             // עננות כבדה — בינוני
        : 3;                         // מעונן לחלוטין

      const rainPenalty = rain > 70 ? 3 : rain > 40 ? 1.5 : 0;
      const wcodePenalty = wcode >= 80 ? 2 : wcode >= 60 ? 1 : 0;

      const raw = cloudScore - rainPenalty - wcodePenalty;
      return { score: Math.round(Math.max(1, Math.min(10, raw))), cloud, rain, wcode };
    } catch {
      return { score: null, cloud: null, rain: null, wcode: null };
    }
  }

  // ─── חיבור ל-index.html (מחליף את setSunTimesDemo) ─────────────────
  function updateSunUI(loc) {
    const data = calc(loc.lat, loc.lon);

    // זריחה ושקיעה — שדות קיימים
    const sunriseEl = document.getElementById("sunrise");
    const sunsetEl  = document.getElementById("sunset");
    if (sunriseEl) sunriseEl.textContent = fmt(data.sunrise);
    if (sunsetEl)  sunsetEl.textContent  = fmt(data.sunset);

    // כרטיס מורחב (אם קיים ב-DOM)
    const fields = {
      "sun-astro-dawn":    data.astronomicalDawn,
      "sun-blue-morning":  data.blueHourMorningStart,
      "sun-civil-dawn":    data.civilDawn,
      "sun-sunrise-full":  data.sunrise,
      "sun-golden-end":    data.goldenHourMorningEnd,
      "sun-solar-noon":    data.solarNoon,
      "sun-golden-start":  data.goldenHourEveningStart,
      "sun-sunset-full":   data.sunset,
      "sun-blue-evening":  data.blueHourEveningEnd,
      "sun-civil-dusk":    data.civilDusk,
    };

    for (const [id, val] of Object.entries(fields)) {
      const el = document.getElementById(id);
      if (el) el.textContent = fmt(val);
    }

    const dlEl = document.getElementById("sun-day-length");
    if (dlEl) dlEl.textContent = fmtDuration(data.dayLengthMin);

    // ציון איכות שקיעה (async)
    fetchWeatherScore(loc.lat, loc.lon).then(({ score, cloud, rain }) => {
      const scoreEl = document.getElementById("sunset-score");
      const scoreBar = document.getElementById("sunset-score-bar");
      const scoreMeta = document.getElementById("sunset-score-meta");

      if (scoreEl) scoreEl.textContent = score !== null ? score + "/10" : "--";
      if (scoreBar) {
        scoreBar.style.width = (score !== null ? score * 10 : 0) + "%";
        scoreBar.style.background = score >= 8
          ? "linear-gradient(90deg,#f4b14b,#ff7a5c)"
          : score >= 5
          ? "linear-gradient(90deg,#f4c97a,#f4b14b)"
          : "rgba(255,255,255,.3)";
      }
      if (scoreMeta && cloud !== null) {
        scoreMeta.textContent = `עננות ${cloud}% • גשם ${rain}%`;
      }
    });

    return data;
  }

  // ─── expose ────────────────────────────────────────────────────────
  window.SunCalc = { calc, fmt, fmtDuration, fetchWeatherScore, updateSunUI };

  // updateSunUI is available for standalone use if needed,
  // but forecast.js handles all DOM rendering — no auto-listener here.

})();

// app.js - shared utilities + PWA install + simple geocode
(() => {
  const $ = (id) => document.getElementById(id);

  // ---------- Splash screen
  window.addEventListener("load", () => {
    const splash = $("splash");
    if (!splash) return;
    setTimeout(() => {
      splash.classList.add("hidden");
      setTimeout(() => splash.remove(), 800);
    }, 1800);
  });

  // ---------- PWA install handling
  let deferredPrompt = null;

  function wireInstallButton() {
    const installBtn = $("installBtn");
    if (!installBtn) return;

    window.addEventListener("beforeinstallprompt", (e) => {
      e.preventDefault();
      deferredPrompt = e;
      installBtn.hidden = false;
    });

    installBtn.addEventListener("click", async () => {
      if (!deferredPrompt) {
        alert("כרגע ההתקנה לא זמינה. נסה שוב אחרי רענון או מהתפריט: Add to Home screen.");
        return;
      }
      deferredPrompt.prompt();
      await deferredPrompt.userChoice;
      deferredPrompt = null;
      installBtn.hidden = true;
    });

    window.addEventListener("appinstalled", () => {
      installBtn.hidden = true;
      deferredPrompt = null;
    });
  }

  async function registerSW() {
    if (!("serviceWorker" in navigator)) return { ok: false, reason: "no-sw" };
    try {
      await navigator.serviceWorker.register("./sw.js", { scope: "./" });
      await navigator.serviceWorker.ready;
      return { ok: true };
    } catch (e) {
      console.error("SW register failed", e);
      return { ok: false, reason: String(e) };
    }
  }

  function wireGlobalErrorToDebug() {
    const debugOut = $("debugOut");
    const debugCard = $("debugCard");
    if (!debugOut || !debugCard) return;

    const push = (msg) => {
      debugCard.style.display = "block";
      debugOut.textContent = (debugOut.textContent ? debugOut.textContent + "\n\n" : "") + msg;
    };

    window.addEventListener("error", (e) => push("ERROR: " + (e.message || e.error || e)));
    window.addEventListener("unhandledrejection", (e) => push("PROMISE: " + (e.reason?.message || e.reason || e)));
  }

  function fmtCoord(n) { return (Math.round(n * 10000) / 10000).toFixed(4); }

  async function getGPS() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) return reject(new Error("Geolocation לא זמין"));
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude, acc: pos.coords.accuracy }),
        (err) => reject(new Error(err.message || "שגיאת GPS")),
        { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
      );
    });
  }

  async function geocode(q) {
    const url = "https://nominatim.openstreetmap.org/search?format=json&limit=1&q=" + encodeURIComponent(q);
    const res = await fetch(url, { headers: { "Accept": "application/json" } });
    if (!res.ok) throw new Error("Geocode נכשל (" + res.status + ")");
    const data = await res.json();
    if (!data?.length) throw new Error("לא נמצאה תוצאה");
    return { lat: Number(data[0].lat), lon: Number(data[0].lon), name: data[0].display_name };
  }

  function setLocUI(loc) {
    const locInfo   = $("locInfo");
    const locCoords = $("locCoords");
    if (!locInfo) return;
    if (!loc) { locInfo.textContent = "לא נבחר מיקום"; return; }
    locInfo.textContent = loc.name || "מיקום";
    if (locCoords) locCoords.textContent = `${fmtCoord(loc.lat)}, ${fmtCoord(loc.lon)}${loc.acc ? " • ±" + Math.round(loc.acc) + "m" : ""}`;
  }

  function setSunTimesDemo(loc) {
    const sunrise = $("sunrise");
    const sunset = $("sunset");
    if (!sunrise || !sunset) return;
    if (!loc) { sunrise.textContent="--:--"; sunset.textContent="--:--"; return; }
    const now = new Date();
    const base = (loc.lat + loc.lon) % 1;
    const sr = new Date(now); sr.setHours(6, Math.floor(10 + base*40), 0, 0);
    const ss = new Date(now); ss.setHours(18, Math.floor(5 + base*40), 0, 0);
    sunrise.textContent = sr.toTimeString().slice(0,5);
    sunset.textContent = ss.toTimeString().slice(0,5);
  }

  const STORAGE_KEY = "twilight_loc_v2";
  function loadLoc() { try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "null"); } catch { return null; } }
  function saveLoc(loc) { localStorage.setItem(STORAGE_KEY, JSON.stringify(loc)); }

  async function initCommon() {
    wireInstallButton();
    await registerSW();

    let loc = loadLoc();
    setLocUI(loc);

    if (loc) {
      window.__twilightLoc = loc;
      window.dispatchEvent(new CustomEvent("twilight:loc", { detail: loc }));
    } else {
      autoGPS();
    }

    // רענון GPS שקט ברקע
    silentGPSRefresh();

    const btnGps = $("btnGps");
    if (btnGps) {
      btnGps.addEventListener("click", async () => {
        btnGps.disabled = true;
        btnGps.textContent = "טוען...";
        try {
          const g = await getGPS();
          loc = { lat: g.lat, lon: g.lon, acc: g.acc, name: "מיקום נוכחי" };
          saveLoc(loc);
          setLocUI(loc);
          window.__twilightLoc = loc;
          window.dispatchEvent(new CustomEvent("twilight:loc", { detail: loc }));
        } catch (e) { alert(e.message || String(e)); }
        finally { btnGps.disabled = false; btnGps.textContent = "GPS"; }
      });
    }

    const btnSearch  = $("btnSearch");
    const placeInput = $("placeInput");
    if (btnSearch && placeInput) {
      const origText = btnSearch.textContent;
      btnSearch.addEventListener("click", async () => {
        const q = (placeInput.value || "").trim();
        if (!q) return;
        btnSearch.disabled = true;
        btnSearch.textContent = "מחפש...";
        try {
          const g = await geocode(q);
          loc = { lat: g.lat, lon: g.lon, name: q };
          saveLoc(loc);
          setLocUI(loc);
          window.__twilightLoc = loc;
          window.dispatchEvent(new CustomEvent("twilight:loc", { detail: loc }));
        } catch (e) { alert(e.message || String(e)); }
        finally { btnSearch.disabled = false; btnSearch.textContent = origText; }
      });
    }

    window.__twilightLoc = loc;
  }

  async function autoGPS() {
    const el = $("mainContent");
    if (el) el.innerHTML = '<div class="loading-state"><span>📍</span><p>מאתר מיקום…</p></div>';
    try {
      const g = await getGPS();
      const loc = { lat: g.lat, lon: g.lon, acc: g.acc, name: "מיקום נוכחי" };
      saveLoc(loc);
      setLocUI(loc);
      window.__twilightLoc = loc;
      window.dispatchEvent(new CustomEvent("twilight:loc", { detail: loc }));
    } catch {
      if (el) el.innerHTML = '<div class="loading-state"><span>🌍</span><p>חפש עיר כדי להתחיל</p></div>';
    }
  }

  async function silentGPSRefresh() {
    try {
      const g = await getGPS();
      const loc = { lat: g.lat, lon: g.lon, acc: g.acc, name: "מיקום נוכחי" };
      saveLoc(loc);
      window.__twilightLoc = loc;
      window.dispatchEvent(new CustomEvent("twilight:loc", { detail: loc }));
    } catch { /* שקט */ }
  }

  // ── שיתוף האפליקציה ──────────────────────────────────────────────
  window.shareApp = async function() {
    const url = 'https://github.com/uri0411-jpg/twilight/releases/download/v1.0/default.apk';
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'דמדומים — תחזית שקיעות וזריחות',
          text: 'אפליקציה לתחזית צבעוניות שקיעות וזריחות 🌅',
          url
        });
      } catch {}
    } else {
      await navigator.clipboard.writeText(url).catch(() => {});
      const btn = document.getElementById('btnShareApp');
      if (btn) { btn.textContent = '✓ הועתק'; setTimeout(() => { btn.textContent = '📤 שתף'; }, 2000); }
    }
  };
  document.addEventListener("DOMContentLoaded", () => {
    wireGlobalErrorToDebug();
    initCommon();
  });
})();

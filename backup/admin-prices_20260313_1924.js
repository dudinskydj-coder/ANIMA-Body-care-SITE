(function(){
  "use strict";

  const state = {
    mode:"frauen",
    catalogApi:null,
    packageStoreTypeByMode:{ frauen:{}, herren:{} },
    configured:false,
    supabase:null,
    session:null,
    dirty:false,
    saving:false,
    loading:false,
    lastMessage:{ text:"Ожидание загрузки каталога...", tone:"warn" },
    remoteSnapshot:null
  };

  const ui = {
    statusPills:document.getElementById("statusPills"),
    statusNotice:document.getElementById("statusNotice"),
    authForm:document.getElementById("authForm"),
    authEmail:document.getElementById("authEmail"),
    authPassword:document.getElementById("authPassword"),
    loginButton:document.getElementById("loginButton"),
    logoutButton:document.getElementById("logoutButton"),
    saveButton:document.getElementById("saveButton"),
    exportButton:document.getElementById("exportButton"),
    reloadButton:document.getElementById("reloadButton"),
    saveMeta:document.getElementById("saveMeta"),
    modeTabs:document.getElementById("modeTabs"),
    zonesTable:document.getElementById("zonesTable"),
    packagesTable:document.getElementById("packagesTable"),
    promoTable:document.getElementById("promoTable")
  };

  function formatEuro(value){
    return new Intl.NumberFormat("de-DE", {
      style:"currency",
      currency:"EUR",
      maximumFractionDigits:0
    }).format(Number(value) || 0);
  }

  function modeLabel(mode){
    return mode === "herren" ? "Мужчины" : "Женщины";
  }

  function zoneLabel(zone){
    return ((zone && zone.label && (zone.label.ru || zone.label.de || zone.label.en)) || zone.id || "").trim();
  }

  function packageLabel(pkg){
    return ((pkg && pkg.label && (pkg.label.ru || pkg.label.de || pkg.label.en)) || pkg.id || "").trim();
  }

  function setMessage(text, tone = "warn"){
    state.lastMessage = { text, tone };
    renderStatus();
  }

  function pill(label, value, tone = ""){
    const toneAttr = tone ? ` data-tone="${tone}"` : "";
    return `<span class="pill"${toneAttr}><span>${label}:</span><strong>${value}</strong></span>`;
  }

  function renderStatus(){
    const pills = [];
    pills.push(pill("Каталог", state.catalogApi ? "готов" : (state.loading ? "загрузка" : "нет"), state.catalogApi ? "ok" : "warn"));
    pills.push(pill("Supabase", state.configured ? "подключён" : "не настроен", state.configured ? "ok" : "warn"));
    pills.push(pill("Сессия", state.session && state.session.user ? state.session.user.email || "вход выполнен" : "нет входа", state.session ? "ok" : "warn"));
    pills.push(pill("Изменения", state.dirty ? "не опубликованы" : "чисто", state.dirty ? "warn" : "ok"));
    pills.push(pill("Режим", modeLabel(state.mode)));
    ui.statusPills.innerHTML = pills.join("");

    ui.statusNotice.textContent = state.lastMessage.text;
    ui.statusNotice.dataset.tone = state.lastMessage.tone;

    ui.loginButton.disabled = !state.configured;
    ui.logoutButton.disabled = !state.session;
    ui.saveButton.disabled = !state.catalogApi || !state.configured || !state.session || state.saving;
    ui.exportButton.disabled = !state.catalogApi;
    ui.reloadButton.disabled = state.loading || state.saving;

    if(state.saving){
      ui.saveMeta.textContent = "Публикация цен в Supabase...";
    } else if(state.remoteSnapshot && state.remoteSnapshot.updatedAt){
      ui.saveMeta.textContent = `Последняя опубликованная версия: ${new Date(state.remoteSnapshot.updatedAt).toLocaleString("ru-RU")}`;
    } else if(state.catalogApi){
      ui.saveMeta.textContent = "Сейчас используется базовый каталог из Laser 4.html. После публикации здесь появится отметка времени.";
    } else {
      ui.saveMeta.textContent = "";
    }
  }

  function scanBalanced(source, openIndex){
    let depth = 0;
    let quote = null;
    let escaped = false;
    let lineComment = false;
    let blockComment = false;

    for(let index = openIndex; index < source.length; index += 1){
      const char = source[index];
      const next = source[index + 1] || "";

      if(lineComment){
        if(char === "\n") lineComment = false;
        continue;
      }
      if(blockComment){
        if(char === "*" && next === "/"){
          blockComment = false;
          index += 1;
        }
        continue;
      }
      if(quote){
        if(escaped){
          escaped = false;
          continue;
        }
        if(char === "\\"){
          escaped = true;
          continue;
        }
        if(char === quote){
          quote = null;
        }
        continue;
      }
      if(char === "/" && next === "/"){
        lineComment = true;
        index += 1;
        continue;
      }
      if(char === "/" && next === "*"){
        blockComment = true;
        index += 1;
        continue;
      }
      if(char === "'" || char === "\"" || char === "`"){
        quote = char;
        continue;
      }
      if(char === "{"){
        depth += 1;
        continue;
      }
      if(char === "}"){
        depth -= 1;
        if(depth === 0) return index;
      }
    }

    throw new Error("Failed to find balanced block end");
  }

  function extractConstBlock(source, declaration){
    const start = source.indexOf(declaration);
    if(start < 0) throw new Error(`Missing declaration: ${declaration}`);
    const openIndex = source.indexOf("{", start);
    if(openIndex < 0) throw new Error(`Missing object start for: ${declaration}`);
    const closeIndex = scanBalanced(source, openIndex);
    let end = closeIndex + 1;
    while(end < source.length && /\s/.test(source[end])) end += 1;
    if(source[end] === ";") end += 1;
    return source.slice(start, end);
  }

  function extractFunction(source, name){
    const marker = `function ${name}(`;
    const start = source.indexOf(marker);
    if(start < 0) throw new Error(`Missing function: ${name}`);
    const openIndex = source.indexOf("{", start);
    if(openIndex < 0) throw new Error(`Missing function body: ${name}`);
    const closeIndex = scanBalanced(source, openIndex);
    return source.slice(start, closeIndex + 1);
  }

  async function extractCatalogApi(){
    const response = await fetch("./Laser 4.html", { cache:"no-store" });
    if(!response.ok){
      throw new Error(`Не удалось прочитать Laser 4.html (${response.status})`);
    }
    const html = await response.text();
    const relevantSource = [
      extractConstBlock(html, "const plannerZonesByMode = {"),
      extractConstBlock(html, "const plannerPricingConfigByMode = {"),
      extractFunction(html, "plannerPricingConfig"),
      extractFunction(html, "plannerZonesMap"),
      extractFunction(html, "plannerBundlesForMode"),
      extractFunction(html, "plannerBundleById"),
      extractFunction(html, "plannerPackageResolvedPrice"),
      extractFunction(html, "plannerPackageOriginalPrice"),
      "return { plannerZonesByMode, plannerPricingConfigByMode, plannerZonesMap, plannerBundlesForMode, plannerBundleById, plannerPackageResolvedPrice, plannerPackageOriginalPrice };"
    ].join("\n\n");
    return new Function(relevantSource)();
  }

  function buildPackageStoreTypeByMode(api){
    const result = { frauen:{}, herren:{} };
    Object.entries(api.plannerPricingConfigByMode || {}).forEach(([mode, pricing]) => {
      const safePricing = pricing || {};
      const overrides = safePricing.packagePriceOverrides || {};
      (safePricing.packages || []).forEach((pkg) => {
        if(!pkg || !pkg.id) return;
        if(Object.prototype.hasOwnProperty.call(pkg, "packagePrice")){
          result[mode][pkg.id] = "fixed";
          return;
        }
        if(Object.prototype.hasOwnProperty.call(overrides, pkg.id)){
          result[mode][pkg.id] = "override";
          return;
        }
        result[mode][pkg.id] = "override";
      });
    });
    return result;
  }

  function currentZones(){
    return state.catalogApi && Array.isArray(state.catalogApi.plannerZonesByMode[state.mode])
      ? state.catalogApi.plannerZonesByMode[state.mode]
      : [];
  }

  function currentPackages(){
    return state.catalogApi ? state.catalogApi.plannerBundlesForMode(state.mode) : [];
  }

  function currentPricing(mode){
    return (state.catalogApi && state.catalogApi.plannerPricingConfigByMode[mode]) || { packagePriceOverrides:{}, packages:[] };
  }

  function packagePriceInfo(mode, pkg){
    const zonesById = state.catalogApi.plannerZonesMap(mode);
    const current = Number(state.catalogApi.plannerPackageResolvedPrice(mode, pkg, zonesById)) || 0;
    const original = Number(state.catalogApi.plannerPackageOriginalPrice(pkg, zonesById)) || current;
    return {
      current,
      original,
      savings:Math.max(0, original - current)
    };
  }

  function renderModeTabs(){
    const modes = ["frauen", "herren"];
    ui.modeTabs.innerHTML = modes.map((mode) => {
      const active = mode === state.mode ? " is-active" : "";
      return `<button type="button" class="${active.trim()}" data-mode="${mode}">${modeLabel(mode)}</button>`;
    }).join("");
    ui.modeTabs.querySelectorAll("button").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.mode === state.mode);
    });
  }

  function renderZonesTable(){
    const rows = currentZones().map((zone) => {
      return `
        <tr>
          <td>${zoneLabel(zone)}</td>
          <td><code>${zone.id}</code></td>
          <td>
            <input
              class="priceInput"
              type="number"
              min="0"
              step="1"
              data-zone-id="${zone.id}"
              value="${Number(zone.price) || 0}"
            />
          </td>
        </tr>
      `;
    }).join("");

    ui.zonesTable.innerHTML = `
      <table>
        <thead>
          <tr>
            <th>Зона</th>
            <th>ID</th>
            <th>Цена</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  }

  function renderPackagesTable(){
    const rows = currentPackages().map((pkg) => {
      const info = packagePriceInfo(state.mode, pkg);
      const storeType = state.packageStoreTypeByMode[state.mode][pkg.id] || "override";
      const sourceLabel = storeType === "fixed" ? "fixed" : "override";
      return `
        <tr>
          <td>${packageLabel(pkg)}</td>
          <td><code>${pkg.id}</code></td>
          <td>${sourceLabel}</td>
          <td class="money subtle">${formatEuro(info.original)}</td>
          <td>
            <input
              class="priceInput"
              type="number"
              min="0"
              step="1"
              data-package-id="${pkg.id}"
              value="${info.current}"
            />
          </td>
          <td class="money saving">${formatEuro(info.savings)}</td>
        </tr>
      `;
    }).join("");

    ui.packagesTable.innerHTML = `
      <table>
        <thead>
          <tr>
            <th>Комплект</th>
            <th>ID</th>
            <th>Источник</th>
            <th>Исходная сумма</th>
            <th>Текущая цена</th>
            <th>Экономия</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  }

  function renderPromoTable(){
    const promoPackages = currentPackages().filter((pkg) => {
      return (pkg.level || 0) >= 3 || !!pkg.promoNote || String(pkg.id || "").includes("promo");
    });

    if(!promoPackages.length){
      ui.promoTable.innerHTML = `<p class="cardHint">Для текущего режима промо-заметок нет.</p>`;
      return;
    }

    const rows = promoPackages.map((pkg) => {
      const note = window.AnimaPricingRemote.normalizePromoNote(pkg.promoNote) || { de:"", en:"", ru:"" };
      return `
        <tr>
          <td>
            <strong>${packageLabel(pkg)}</strong><br />
            <code>${pkg.id}</code>
          </td>
          <td>
            <div class="noteGrid">
              <label>
                DE
                <textarea data-note-package-id="${pkg.id}" data-note-lang="de">${note.de || ""}</textarea>
              </label>
              <label>
                EN
                <textarea data-note-package-id="${pkg.id}" data-note-lang="en">${note.en || ""}</textarea>
              </label>
              <label>
                RU
                <textarea data-note-package-id="${pkg.id}" data-note-lang="ru">${note.ru || ""}</textarea>
              </label>
            </div>
          </td>
        </tr>
      `;
    }).join("");

    ui.promoTable.innerHTML = `
      <table>
        <thead>
          <tr>
            <th>Комплект</th>
            <th>Тексты заметки</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  }

  function renderAll(){
    renderStatus();
    renderModeTabs();
    renderZonesTable();
    renderPackagesTable();
    renderPromoTable();
  }

  function markDirty(message = "Есть изменения, которые ещё не опубликованы."){
    state.dirty = true;
    setMessage(message, "warn");
  }

  function setZonePrice(zoneId, rawValue){
    const zone = currentZones().find((entry) => entry.id === zoneId);
    if(!zone) return;
    const price = Number(rawValue);
    if(!Number.isFinite(price) || price < 0) return;
    zone.price = price;
    markDirty();
  }

  function setPackagePrice(packageId, rawValue){
    const pkg = currentPackages().find((entry) => entry.id === packageId);
    if(!pkg) return;
    const price = Number(rawValue);
    if(!Number.isFinite(price) || price < 0) return;

    const storeType = state.packageStoreTypeByMode[state.mode][packageId] || "override";
    const pricing = currentPricing(state.mode);
    if(storeType === "fixed"){
      pkg.packagePrice = price;
    } else {
      pricing.packagePriceOverrides = pricing.packagePriceOverrides || {};
      pricing.packagePriceOverrides[packageId] = price;
    }

    markDirty();
  }

  function setPromoNote(packageId, lang, value){
    const pkg = currentPackages().find((entry) => entry.id === packageId);
    if(!pkg) return;
    const next = window.AnimaPricingRemote.normalizePromoNote(pkg.promoNote) || { de:"", en:"", ru:"" };
    next[lang] = value;
    const normalized = window.AnimaPricingRemote.normalizePromoNote(next);
    if(normalized){
      pkg.promoNote = normalized;
    } else {
      delete pkg.promoNote;
    }
    markDirty();
  }

  async function copyToClipboard(text){
    if(!text) return false;
    if(navigator.clipboard && window.isSecureContext){
      try{
        await navigator.clipboard.writeText(text);
        return true;
      } catch(_error){}
    }
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(textarea);
    return ok;
  }

  function buildSnapshot(){
    return window.AnimaPricingRemote.buildSnapshotFromPlanner(
      state.catalogApi.plannerZonesByMode,
      state.catalogApi.plannerPricingConfigByMode,
      {
        savedFrom:"admin-prices.html",
        userEmail:state.session && state.session.user ? state.session.user.email || "" : ""
      }
    );
  }

  async function handleExport(){
    if(!state.catalogApi) return;
    const snapshot = buildSnapshot();
    const content = JSON.stringify(snapshot, null, 2);
    const copied = await copyToClipboard(content);
    setMessage(
      copied
        ? "JSON со всеми текущими ценами скопирован в буфер обмена."
        : "Не удалось скопировать JSON в буфер обмена.",
      copied ? "ok" : "err"
    );
  }

  async function handleSave(){
    if(!state.catalogApi || !state.session) return;
    state.saving = true;
    renderStatus();
    try{
      const snapshot = buildSnapshot();
      const response = await window.AnimaPricingRemote.upsertPricingSnapshot(
        window.ANIMA_SUPABASE_CONFIG,
        snapshot,
        state.session.access_token
      );
      state.remoteSnapshot = {
        updatedAt:(response && response.updated_at) || new Date().toISOString(),
        data:snapshot
      };
      state.dirty = false;
      setMessage("Цены успешно опубликованы в Supabase.", "ok");
    } catch(error){
      setMessage(error instanceof Error ? error.message : "Не удалось сохранить цены.", "err");
    } finally {
      state.saving = false;
      renderStatus();
    }
  }

  async function handleLogin(event){
    event.preventDefault();
    if(!state.supabase){
      setMessage("Сначала заполни supabase-config.js или локальную runtime-конфигурацию.", "warn");
      return;
    }
    const email = ui.authEmail.value.trim();
    const password = ui.authPassword.value;
    if(!email || !password){
      setMessage("Введи email и пароль владельца.", "warn");
      return;
    }

    const { error } = await state.supabase.auth.signInWithPassword({ email, password });
    if(error){
      setMessage(error.message, "err");
      return;
    }

    ui.authPassword.value = "";
    setMessage("Вход выполнен. Теперь можно публиковать цены.", "ok");
  }

  async function handleLogout(){
    if(!state.supabase) return;
    const { error } = await state.supabase.auth.signOut();
    if(error){
      setMessage(error.message, "err");
      return;
    }
    setMessage("Сессия закрыта.", "ok");
  }

  async function loadCatalog(){
    state.loading = true;
    renderStatus();
    try{
      const api = await extractCatalogApi();
      state.packageStoreTypeByMode = buildPackageStoreTypeByMode(api);

      let remoteSnapshot = null;
      try{
        remoteSnapshot = await window.AnimaPricingRemote.fetchPricingSnapshot(window.ANIMA_SUPABASE_CONFIG);
      } catch(remoteError){
        setMessage(
          `Каталог загружен, но прочитать опубликованные цены не удалось: ${remoteError.message}`,
          "warn"
        );
      }

      if(remoteSnapshot){
        window.AnimaPricingRemote.applySnapshotToPlanner(
          remoteSnapshot,
          api.plannerZonesByMode,
          api.plannerPricingConfigByMode
        );
      }

      state.catalogApi = api;
      state.remoteSnapshot = remoteSnapshot;
      state.dirty = false;

      if(!remoteSnapshot){
        setMessage("Каталог считан из Laser 4.html. Можно редактировать и публиковать.", "ok");
      } else {
        setMessage("Каталог загружен и объединён с опубликованной версией из Supabase.", "ok");
      }
    } catch(error){
      state.catalogApi = null;
      setMessage(error instanceof Error ? error.message : "Не удалось загрузить каталог цен.", "err");
    } finally {
      state.loading = false;
      renderAll();
    }
  }

  function initSupabase(){
    state.configured = !!window.AnimaPricingRemote.isConfigured(window.ANIMA_SUPABASE_CONFIG);
    if(!state.configured){
      state.supabase = null;
      renderStatus();
      return;
    }
    if(!window.supabase || typeof window.supabase.createClient !== "function"){
      state.supabase = null;
      setMessage("Библиотека Supabase не загрузилась. Проверь интернет или CDN.", "warn");
      return;
    }
    const config = window.AnimaPricingRemote.getConfig(window.ANIMA_SUPABASE_CONFIG);
    state.supabase = window.supabase.createClient(config.url, config.anonKey);
    state.supabase.auth.getSession().then(({ data }) => {
      state.session = data && data.session ? data.session : null;
      renderStatus();
    });
    state.supabase.auth.onAuthStateChange((_event, session) => {
      state.session = session;
      renderStatus();
    });
  }

  function bindEvents(){
    ui.authForm.addEventListener("submit", handleLogin);
    ui.logoutButton.addEventListener("click", handleLogout);
    ui.saveButton.addEventListener("click", handleSave);
    ui.exportButton.addEventListener("click", handleExport);
    ui.reloadButton.addEventListener("click", loadCatalog);

    ui.modeTabs.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-mode]");
      if(!button) return;
      state.mode = button.dataset.mode === "herren" ? "herren" : "frauen";
      renderAll();
    });

    ui.zonesTable.addEventListener("change", (event) => {
      const input = event.target.closest("input[data-zone-id]");
      if(!input) return;
      setZonePrice(input.dataset.zoneId, input.value);
      renderAll();
    });

    ui.packagesTable.addEventListener("change", (event) => {
      const input = event.target.closest("input[data-package-id]");
      if(!input) return;
      setPackagePrice(input.dataset.packageId, input.value);
      renderAll();
    });

    ui.promoTable.addEventListener("change", (event) => {
      const area = event.target.closest("textarea[data-note-package-id]");
      if(!area) return;
      setPromoNote(area.dataset.notePackageId, area.dataset.noteLang, area.value);
      renderAll();
    });
  }

  async function bootstrap(){
    bindEvents();
    initSupabase();
    renderStatus();
    await loadCatalog();
  }

  bootstrap();
})();

(function(){
  "use strict";

  const DEFAULT_CONFIG = {
    url:"",
    anonKey:"",
    pricingTable:"pricing_configs",
    pricingKey:"laser_pricing_v1",
    readEnabled:true
  };

  function asPlainObject(value){
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  }

  function normalizeText(value){
    return typeof value === "string" ? value.trim() : "";
  }

  function looksLikePlaceholder(value){
    const text = normalizeText(value);
    if(!text) return true;
    return /YOUR_|REPLACE_|EXAMPLE|SUPABASE_PROJECT_URL|SUPABASE_ANON_KEY/i.test(text);
  }

  function readRuntimeConfig(){
    try{
      const raw = window.localStorage.getItem("anima_supabase_runtime_config");
      if(!raw) return {};
      return asPlainObject(JSON.parse(raw));
    } catch(_error){
      return {};
    }
  }

  function getConfig(input){
    const runtimeConfig = readRuntimeConfig();
    const merged = Object.assign(
      {},
      DEFAULT_CONFIG,
      asPlainObject(window.ANIMA_SUPABASE_CONFIG),
      runtimeConfig,
      asPlainObject(input)
    );
    return {
      url:normalizeText(merged.url),
      anonKey:normalizeText(merged.anonKey),
      pricingTable:normalizeText(merged.pricingTable) || DEFAULT_CONFIG.pricingTable,
      pricingKey:normalizeText(merged.pricingKey) || DEFAULT_CONFIG.pricingKey,
      readEnabled:merged.readEnabled !== false
    };
  }

  function isConfigured(input){
    const config = getConfig(input);
    return !!(
      config.url
      && config.anonKey
      && !looksLikePlaceholder(config.url)
      && !looksLikePlaceholder(config.anonKey)
    );
  }

  function safeNumber(value){
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function deepClone(value){
    if(typeof structuredClone === "function") return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }

  function normalizePromoNote(value){
    if(value === null || value === undefined) return null;
    if(typeof value === "string"){
      const text = normalizeText(value);
      return text ? { de:text, en:text, ru:text } : null;
    }
    const source = asPlainObject(value);
    const de = normalizeText(source.de);
    const en = normalizeText(source.en);
    const ru = normalizeText(source.ru);
    if(!de && !en && !ru) return null;
    return {
      de:de || ru || en,
      en:en || de || ru,
      ru:ru || de || en
    };
  }

  function findZoneById(zones, zoneId){
    return (zones || []).find((zone) => zone && zone.id === zoneId) || null;
  }

  function findPackageById(packages, packageId){
    return (packages || []).find((pkg) => pkg && pkg.id === packageId) || null;
  }

  function ensurePricingMode(pricingConfigByMode, mode){
    const base = asPlainObject(pricingConfigByMode);
    if(!base[mode]){
      base[mode] = { singles:{}, packagePriceOverrides:{}, packages:[] };
      pricingConfigByMode[mode] = base[mode];
    }
    if(!base[mode].packagePriceOverrides || typeof base[mode].packagePriceOverrides !== "object"){
      base[mode].packagePriceOverrides = {};
    }
    if(!Array.isArray(base[mode].packages)){
      base[mode].packages = [];
    }
    return base[mode];
  }

  function applyZonePrices(zones, nextPrices){
    let changed = false;
    Object.entries(asPlainObject(nextPrices)).forEach(([zoneId, rawPrice]) => {
      const zone = findZoneById(zones, zoneId);
      const price = safeNumber(rawPrice);
      if(!zone || price === null) return;
      if(Number(zone.price) === price) return;
      zone.price = price;
      changed = true;
    });
    return changed;
  }

  function applyPackageOverrides(pricing, nextOverrides){
    let changed = false;
    const overrideMap = pricing.packagePriceOverrides || {};
    Object.entries(asPlainObject(nextOverrides)).forEach(([packageId, rawPrice]) => {
      const price = safeNumber(rawPrice);
      if(price === null){
        if(Object.prototype.hasOwnProperty.call(overrideMap, packageId)){
          delete overrideMap[packageId];
          changed = true;
        }
        return;
      }
      if(Number(overrideMap[packageId]) === price) return;
      overrideMap[packageId] = price;
      changed = true;
    });
    pricing.packagePriceOverrides = overrideMap;
    return changed;
  }

  function applyPackageFixedPrices(pricing, nextFixedPrices){
    let changed = false;
    const packages = pricing.packages || [];
    Object.entries(asPlainObject(nextFixedPrices)).forEach(([packageId, rawPrice]) => {
      const pkg = findPackageById(packages, packageId);
      if(!pkg) return;
      const price = safeNumber(rawPrice);
      if(price === null){
        if(Object.prototype.hasOwnProperty.call(pkg, "packagePrice")){
          delete pkg.packagePrice;
          changed = true;
        }
        return;
      }
      if(Number(pkg.packagePrice) === price) return;
      pkg.packagePrice = price;
      changed = true;
    });
    return changed;
  }

  function applyPromoNotes(pricing, nextNotes){
    let changed = false;
    const packages = pricing.packages || [];
    Object.entries(asPlainObject(nextNotes)).forEach(([packageId, rawNote]) => {
      const pkg = findPackageById(packages, packageId);
      if(!pkg) return;
      const nextNote = normalizePromoNote(rawNote);
      const currentNote = normalizePromoNote(pkg.promoNote);
      const currentSerialized = JSON.stringify(currentNote);
      const nextSerialized = JSON.stringify(nextNote);
      if(currentSerialized === nextSerialized) return;
      if(nextNote){
        pkg.promoNote = nextNote;
      } else {
        delete pkg.promoNote;
      }
      changed = true;
    });
    return changed;
  }

  function applySnapshotToPlanner(snapshot, plannerZonesByMode, plannerPricingConfigByMode){
    const data = snapshot && typeof snapshot === "object" && snapshot.data
      ? snapshot.data
      : snapshot;
    if(!data || typeof data !== "object") return false;

    let changed = false;
    const modes = new Set([
      ...Object.keys(asPlainObject(plannerZonesByMode)),
      ...Object.keys(asPlainObject(plannerPricingConfigByMode)),
      ...Object.keys(asPlainObject(data.zonePrices)),
      ...Object.keys(asPlainObject(data.packagePriceOverrides)),
      ...Object.keys(asPlainObject(data.packageFixedPrices)),
      ...Object.keys(asPlainObject(data.packagePromoNotes))
    ]);

    modes.forEach((mode) => {
      const zones = Array.isArray(plannerZonesByMode && plannerZonesByMode[mode])
        ? plannerZonesByMode[mode]
        : [];
      const pricing = ensurePricingMode(plannerPricingConfigByMode, mode);
      changed = applyZonePrices(zones, asPlainObject(data.zonePrices && data.zonePrices[mode])) || changed;
      changed = applyPackageOverrides(pricing, asPlainObject(data.packagePriceOverrides && data.packagePriceOverrides[mode])) || changed;
      changed = applyPackageFixedPrices(pricing, asPlainObject(data.packageFixedPrices && data.packageFixedPrices[mode])) || changed;
      changed = applyPromoNotes(pricing, asPlainObject(data.packagePromoNotes && data.packagePromoNotes[mode])) || changed;
    });

    return changed;
  }

  function buildSnapshotFromPlanner(plannerZonesByMode, plannerPricingConfigByMode, meta = null){
    const snapshot = {
      version:1,
      savedAt:new Date().toISOString(),
      zonePrices:{},
      packagePriceOverrides:{},
      packageFixedPrices:{},
      packagePromoNotes:{}
    };

    Object.entries(asPlainObject(plannerZonesByMode)).forEach(([mode, zones]) => {
      if(!Array.isArray(zones)) return;
      snapshot.zonePrices[mode] = {};
      zones.forEach((zone) => {
        if(!zone || !zone.id) return;
        const price = safeNumber(zone.price);
        if(price === null) return;
        snapshot.zonePrices[mode][zone.id] = price;
      });
    });

    Object.entries(asPlainObject(plannerPricingConfigByMode)).forEach(([mode, pricing]) => {
      const safePricing = asPlainObject(pricing);
      const overrides = asPlainObject(safePricing.packagePriceOverrides);
      snapshot.packagePriceOverrides[mode] = {};
      Object.entries(overrides).forEach(([packageId, rawPrice]) => {
        const price = safeNumber(rawPrice);
        if(price === null) return;
        snapshot.packagePriceOverrides[mode][packageId] = price;
      });

      snapshot.packageFixedPrices[mode] = {};
      snapshot.packagePromoNotes[mode] = {};
      (Array.isArray(safePricing.packages) ? safePricing.packages : []).forEach((pkg) => {
        if(!pkg || !pkg.id) return;
        const fixedPrice = safeNumber(pkg.packagePrice);
        if(fixedPrice !== null){
          snapshot.packageFixedPrices[mode][pkg.id] = fixedPrice;
        }
        const note = normalizePromoNote(pkg.promoNote);
        if(note){
          snapshot.packagePromoNotes[mode][pkg.id] = note;
        }
      });
    });

    if(meta && typeof meta === "object"){
      snapshot.meta = deepClone(meta);
    }

    return snapshot;
  }

  async function fetchPricingSnapshot(input){
    const config = getConfig(input);
    if(!config.readEnabled || !isConfigured(config)) return null;

    const baseUrl = config.url.replace(/\/+$/, "");
    const url = new URL(`${baseUrl}/rest/v1/${encodeURIComponent(config.pricingTable)}`);
    url.searchParams.set("select", "key,data,updated_at");
    url.searchParams.set("key", `eq.${config.pricingKey}`);
    url.searchParams.set("limit", "1");

    const response = await fetch(url.toString(), {
      headers:{
        apikey:config.anonKey,
        Authorization:`Bearer ${config.anonKey}`,
        Accept:"application/json"
      }
    });

    if(!response.ok){
      throw new Error(`Supabase pricing fetch failed (${response.status})`);
    }

    const payload = await response.json();
    const row = Array.isArray(payload) ? payload[0] : payload;
    if(!row) return null;
    return {
      key:row.key || config.pricingKey,
      updatedAt:row.updated_at || null,
      data:row.data && typeof row.data === "object" ? row.data : row
    };
  }

  async function upsertPricingSnapshot(input, snapshot, accessToken){
    const config = getConfig(input);
    if(!isConfigured(config)){
      throw new Error("Supabase config is missing.");
    }
    if(!accessToken){
      throw new Error("Missing authenticated access token.");
    }

    const baseUrl = config.url.replace(/\/+$/, "");
    const url = new URL(`${baseUrl}/rest/v1/${encodeURIComponent(config.pricingTable)}`);
    const payload = [{
      key:config.pricingKey,
      data:snapshot,
      updated_at:new Date().toISOString()
    }];

    const response = await fetch(url.toString(), {
      method:"POST",
      headers:{
        apikey:config.anonKey,
        Authorization:`Bearer ${accessToken}`,
        "Content-Type":"application/json",
        Prefer:"resolution=merge-duplicates,return=representation"
      },
      body:JSON.stringify(payload)
    });

    if(!response.ok){
      const errorText = await response.text().catch(() => "");
      throw new Error(
        `Supabase pricing save failed (${response.status})${errorText ? `: ${errorText}` : ""}`
      );
    }

    const result = await response.json().catch(() => []);
    return Array.isArray(result) ? (result[0] || null) : result;
  }

  window.AnimaPricingRemote = {
    DEFAULT_CONFIG,
    deepClone,
    getConfig,
    isConfigured,
    normalizePromoNote,
    applySnapshotToPlanner,
    buildSnapshotFromPlanner,
    fetchPricingSnapshot,
    upsertPricingSnapshot
  };
})();

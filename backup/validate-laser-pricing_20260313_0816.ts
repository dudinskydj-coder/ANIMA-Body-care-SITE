const html = await Deno.readTextFile(new URL("./Laser 4.html", import.meta.url));

function scanBalanced(source: string, openIndex: number): number {
  let depth = 0;
  let quote: "'" | '"' | "`" | null = null;
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
    if(char === "'" || char === '"' || char === "`"){
      quote = char as "'" | '"' | "`";
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

function extractConstBlock(source: string, declaration: string): string {
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

function extractFunction(source: string, name: string): string {
  const marker = `function ${name}(`;
  const start = source.indexOf(marker);
  if(start < 0) throw new Error(`Missing function: ${name}`);
  const openIndex = source.indexOf("{", start);
  if(openIndex < 0) throw new Error(`Missing function body: ${name}`);
  const closeIndex = scanBalanced(source, openIndex);
  return source.slice(start, closeIndex + 1);
}

const relevantSource = [
  "const PLANNER_PACKAGE_DEBUG = false;",
  "let plannerLastPackageDebugSnapshot = null;",
  "const window = { __ANIMA_PLANNER_PACKAGE_DEBUG__: false };",
  "function currentLang(){ return 'de'; }",
  "function activeLaserMode(){ return 'frauen'; }",
  extractConstBlock(html, "const plannerZonesByMode = {"),
  extractConstBlock(html, "const plannerPricingConfigByMode = {"),
  extractFunction(html, "plannerLabel"),
  extractFunction(html, "plannerPricingConfig"),
  extractFunction(html, "plannerZonesMap"),
  extractFunction(html, "plannerBundlesForMode"),
  extractConstBlock(html, "const plannerZoneDisplayOrderByMode = {"),
  extractFunction(html, "plannerZoneDisplayRank"),
  extractFunction(html, "plannerBundleDisplayRank"),
  extractFunction(html, "plannerDisplayRankForZoneIds"),
  extractFunction(html, "plannerBundleById"),
  extractFunction(html, "plannerPackageResolvedPrice"),
  extractFunction(html, "plannerPackageOriginalPrice"),
  extractFunction(html, "plannerPackageIsTodoPrice"),
  extractFunction(html, "plannerPackageHasSavings"),
  extractFunction(html, "plannerHasAxillaAddonDiscountPackage"),
  extractFunction(html, "plannerPackageTreeNodeForZone"),
  extractFunction(html, "plannerPackageTreeNode"),
  extractFunction(html, "plannerPackageDebugLog"),
  extractFunction(html, "plannerSummarySnapshot"),
  extractFunction(html, "plannerSelectedBundles"),
  extractFunction(html, "plannerActiveBundleIds"),
  extractFunction(html, "plannerBundleCompleteInSet"),
  extractFunction(html, "plannerBundleStillComplete"),
  extractFunction(html, "plannerOrderItems"),
  extractFunction(html, "plannerCompositeLabel"),
  extractFunction(html, "plannerCloneDisplayNode"),
  extractFunction(html, "plannerSortDisplayNodes"),
  extractFunction(html, "plannerDisplayNodesForItem"),
  extractFunction(html, "plannerFindDisplayPackageNode"),
  extractFunction(html, "plannerMergeSupplementaryNodes"),
  extractFunction(html, "plannerCloneOrderItemNode"),
  extractFunction(html, "plannerFindOrderPackageNode"),
  extractFunction(html, "plannerUpgradeSupplementaryPackageItem"),
  extractFunction(html, "plannerMergeSupplementaryOrderItems"),
  extractFunction(html, "plannerCompositeLabelFromNodes"),
  extractFunction(html, "plannerDisplayItems"),
  "return { plannerZonesByMode, plannerPricingConfigByMode, plannerZonesMap, plannerBundlesForMode, plannerBundleById, plannerPackageResolvedPrice, plannerPackageOriginalPrice, plannerSummarySnapshot, plannerOrderItems };"
].join("\n\n");

const api = new Function(relevantSource)() as {
  plannerZonesByMode: Record<string, Array<{ id:string; price:number }>>;
  plannerPricingConfigByMode: Record<string, { packages:Array<{ id:string; zoneIds:string[] }> }>;
  plannerZonesMap: (mode: string) => Map<string, { id:string; price:number }>;
  plannerBundlesForMode: (mode: string) => Array<{ id:string; zoneIds:string[] }>;
  plannerBundleById: (mode: string, id: string) => { id:string; zoneIds:string[] } | null;
  plannerPackageResolvedPrice: (mode: string, bundle: { id:string; zoneIds:string[] }, zonesById: Map<string, { id:string; price:number }>) => number | null;
  plannerPackageOriginalPrice: (bundle: { id:string; zoneIds:string[] }, zonesById: Map<string, { id:string; price:number }>) => number;
  plannerSummarySnapshot: (mode: string, selectedSet: Set<string>) => {
    total:number;
    originalTotal:number;
    items:Array<{ id:string; type:string; price:number; originalPrice:number; zoneIds:string[]; children?:OrderNode[] }>;
  };
  plannerOrderItems: (mode: string, selectedSet: Set<string>) => Array<OrderNode>;
};

type Issue = {
  mode:string;
  selected:string[];
  problem:string;
};

type OrderNode = {
  id:string;
  type:string;
  price:number;
  originalPrice:number;
  zoneIds:string[];
  children?:OrderNode[];
};

const issues: Issue[] = [];

function compareNumber(a: number, b: number): boolean {
  return Math.abs(a - b) < 1e-9;
}

function collectLeafZoneCoverage(nodes: OrderNode[], coverage = new Map<string, number>()) {
  for(const node of nodes){
    const children = Array.isArray(node.children) ? node.children.filter(Boolean) : [];
    if(children.length){
      collectLeafZoneCoverage(children, coverage);
      continue;
    }
    for(const zoneId of node.zoneIds || []){
      coverage.set(zoneId, (coverage.get(zoneId) || 0) + 1);
    }
  }
  return coverage;
}

function treeContainsId(nodes: OrderNode[], targetId: string): boolean {
  for(const node of nodes){
    if(node.id === targetId) return true;
    if(Array.isArray(node.children) && treeContainsId(node.children, targetId)) return true;
  }
  return false;
}

function hasTopLevelSingle(nodes: OrderNode[], zoneId: string): boolean {
  return nodes.some((node) => node.type === "single" && node.id === zoneId);
}

function validateSelection(mode: string, selectedZoneIds: string[]) {
  const selected = [...new Set(selectedZoneIds)];
  const selectedSet = new Set(selected);
  const snapshot = api.plannerSummarySnapshot(mode, selectedSet);
  const orderItems = api.plannerOrderItems(mode, selectedSet);
  const orderTotal = orderItems.reduce((sum, item) => sum + (Number(item.price) || 0), 0);
  const snapshotTotal = snapshot.items.reduce((sum, item) => sum + (Number(item.price) || 0), 0);
  const selectedKey = selected.slice().sort();

  if(!compareNumber(orderTotal, snapshot.total)){
    issues.push({ mode, selected:selectedKey, problem:`order total mismatch ${orderTotal} != ${snapshot.total}` });
  }
  if(!compareNumber(snapshotTotal, snapshot.total)){
    issues.push({ mode, selected:selectedKey, problem:`snapshot total mismatch ${snapshotTotal} != ${snapshot.total}` });
  }
  if(snapshot.originalTotal < snapshot.total){
    issues.push({ mode, selected:selectedKey, problem:`originalTotal ${snapshot.originalTotal} < total ${snapshot.total}` });
  }

  const coverage = collectLeafZoneCoverage(orderItems);
  for(const item of orderItems){
    if(!Number.isFinite(item.price) || item.price < 0){
      issues.push({ mode, selected:selectedKey, problem:`non-finite or negative price on ${item.id}: ${item.price}` });
    }
  }
  for(const zoneId of selected){
    const count = coverage.get(zoneId) || 0;
    if(count !== 1){
      issues.push({ mode, selected:selectedKey, problem:`zone coverage for ${zoneId} is ${count}, expected 1` });
    }
  }
  for(const zoneId of coverage.keys()){
    if(!selectedSet.has(zoneId)){
      issues.push({ mode, selected:selectedKey, problem:`unexpected covered zone ${zoneId}` });
    }
  }

  if(mode === "frauen"){
    const topLevelIds = new Set(orderItems.map((item) => item.id));
    if(selectedSet.has("upperarms") && selectedSet.has("underarms") && selectedSet.has("hands")){
      if(!treeContainsId(orderItems, "smart_arms_complete_with_hands")){
        issues.push({ mode, selected:selectedKey, problem:"missing smart_arms_complete_with_hands upgrade" });
      }
      if(hasTopLevelSingle(orderItems, "hands")){
        issues.push({ mode, selected:selectedKey, problem:"hands still rendered as separate item after arms upgrade" });
      }
    }
    if(selectedSet.has("obersch") && selectedSet.has("untersch") && selectedSet.has("feet")){
      if(!treeContainsId(orderItems, "smart_legs_complete_with_feet")){
        issues.push({ mode, selected:selectedKey, problem:"missing smart_legs_complete_with_feet upgrade" });
      }
      if(hasTopLevelSingle(orderItems, "feet")){
        issues.push({ mode, selected:selectedKey, problem:"feet still rendered as separate item after legs upgrade" });
      }
    }
    const promoZones = ["bikini", "intim", "axilla", "obersch", "untersch"];
    if(promoZones.every((zoneId) => selectedSet.has(zoneId)) && selectedSet.size === promoZones.length){
      if(!topLevelIds.has("promo_intim_axilla_legs_bundle")){
        issues.push({ mode, selected:selectedKey, problem:"missing promo_intim_axilla_legs_bundle on exact promo selection" });
      }
    }
  }
}

function* combinations<T>(items: T[], size: number, start = 0, prefix: T[] = []): Generator<T[]> {
  if(prefix.length === size){
    yield prefix.slice();
    return;
  }
  for(let index = start; index <= items.length - (size - prefix.length); index += 1){
    prefix.push(items[index]);
    yield* combinations(items, size, index + 1, prefix);
    prefix.pop();
  }
}

function runModeChecks(mode: string) {
  const zones = (api.plannerZonesByMode[mode] || []).map((zone) => zone.id);
  const bundles = api.plannerBundlesForMode(mode);
  const zonesById = api.plannerZonesMap(mode);

  for(const bundle of bundles){
    const resolved = api.plannerPackageResolvedPrice(mode, bundle, zonesById);
    const original = api.plannerPackageOriginalPrice(bundle, zonesById);
    if(!Number.isFinite(resolved)){
      issues.push({ mode, selected:[bundle.id], problem:`bundle ${bundle.id} has non-finite resolved price` });
      continue;
    }
    if(resolved! > original){
      issues.push({ mode, selected:[bundle.id], problem:`bundle ${bundle.id} resolved price ${resolved} > original ${original}` });
    }
  }

  for(let size = 0; size <= Math.min(7, zones.length); size += 1){
    for(const combo of combinations(zones, size)){
      validateSelection(mode, combo as string[]);
    }
  }

  const bundleIds = bundles.map((bundle) => bundle.id);
  for(let size = 1; size <= Math.min(4, bundleIds.length); size += 1){
    for(const combo of combinations(bundleIds, size)){
      const zoneUnion = new Set<string>();
      combo.forEach((bundleId) => {
        const bundle = api.plannerBundleById(mode, String(bundleId));
        (bundle?.zoneIds || []).forEach((zoneId) => zoneUnion.add(zoneId));
      });
      validateSelection(mode, [...zoneUnion]);
    }
  }

  validateSelection(mode, zones);
  for(const zoneId of zones){
    validateSelection(mode, zones.filter((entry) => entry !== zoneId));
  }
}

if(Deno.args[0] === "--inspect"){
  const mode = Deno.args[1] || "frauen";
  const selected = String(Deno.args[2] || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  const snapshot = api.plannerSummarySnapshot(mode, new Set(selected));
  const items = api.plannerOrderItems(mode, new Set(selected));
  console.log(JSON.stringify({ mode, selected, snapshot, items }, null, 2));
  Deno.exit(0);
}

runModeChecks("frauen");
runModeChecks("herren");

if(!issues.length){
  console.log("OK: no pricing/interaction issues found in the checked combinations.");
  Deno.exit(0);
}

console.log(`Found ${issues.length} issue(s):`);
issues.slice(0, 100).forEach((issue, index) => {
  console.log(`${index + 1}. [${issue.mode}] ${issue.problem} :: ${issue.selected.join(", ")}`);
});
if(issues.length > 100){
  console.log(`... ${issues.length - 100} more`);
}
Deno.exit(1);

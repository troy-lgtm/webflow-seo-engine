/**
 * Lane archetypes — 10 distinct freight lane archetypes that control intro text,
 * FAQ rotation, and section emphasis per page. Priority ladder resolves collisions
 * so every lane receives exactly one archetype.
 */
import { stableHash } from "@/lib/hash";
import { haversine, lookupCity, cityName } from "@/lib/geo";
import { ROAD_MULTIPLIER } from "@/lib/estimate-config";

// ---------------------------------------------------------------------------
// City classification sets (lowercase city names without state)
// ---------------------------------------------------------------------------
const METRO_CITIES = new Set([
  "los angeles", "chicago", "dallas", "atlanta", "new york", "miami",
  "phoenix", "houston", "seattle", "denver", "san francisco", "las vegas",
  "portland", "salt lake city", "nashville", "charlotte", "orlando", "tampa",
  "indianapolis", "kansas city"
]);

const PORT_CITIES = new Set([
  "los angeles", "houston", "miami", "seattle", "new york", "san francisco"
]);

const AGRICULTURE_CITIES = new Set([
  "kansas city", "indianapolis", "dallas", "denver"
]);

const ENERGY_CITIES = new Set([
  "houston", "dallas", "denver", "salt lake city"
]);

const ECOMMERCE_HUBS = new Set([
  "los angeles", "chicago", "dallas", "atlanta", "new york", "indianapolis"
]);

// ---------------------------------------------------------------------------
// Segment copy labels
// ---------------------------------------------------------------------------
const SEGMENT_LABELS = {
  smb: "small and mid-size shipping teams",
  enterprise: "enterprise logistics organizations",
  midmarket: "growing logistics operations"
};

// ---------------------------------------------------------------------------
// City classifier
// ---------------------------------------------------------------------------
export function classifyCity(fullCityName) {
  const name = cityName(fullCityName);
  return {
    isMetro: METRO_CITIES.has(name),
    isPort: PORT_CITIES.has(name),
    isAgriculture: AGRICULTURE_CITIES.has(name),
    isEnergy: ENERGY_CITIES.has(name),
    isEcommerce: ECOMMERCE_HUBS.has(name)
  };
}

// ---------------------------------------------------------------------------
// Region helpers for archetype matching
// ---------------------------------------------------------------------------
const WEST_PACIFIC = new Set(["West Coast", "Pacific Northwest"]);
const EAST_COAST = new Set(["Northeast", "Southeast"]);
const SUNBELT_REGIONS = new Set(["Southeast", "South Central", "Southwest"]);
const MIDWEST_REGION = "Midwest";

// ---------------------------------------------------------------------------
// 10 Archetypes
// ---------------------------------------------------------------------------
const ARCHETYPES = [
  // ---- 1. Short-Haul Metro ----
  {
    id: "short_haul_metro",
    priority: 1,
    label: "Short-Haul Metro",
    match: (ctx) => ctx.distance < 300 && ctx.oClass.isMetro && ctx.dClass.isMetro,
    sectionEmphasis: { transit: "high", cost: "medium", capacity: "low", customs: "low" },
    introTemplate: (origin, dest, mode, segLabel) =>
      `${mode} freight between ${origin} and ${dest} covers one of the shortest metro-to-metro corridors in the network. For ${segLabel}, that means same-day and next-day options are realistic, last-mile scheduling is tighter, and per-shipment costs stay competitive. This page breaks down transit windows, carrier density, and booking strategies tailored to short-haul ${mode} shippers on the ${origin} to ${dest} lane.`,
    faqPool: [
      { q: "How fast is {mode} transit from {origin} to {dest}?", a: "Short-haul metro lanes like {origin} to {dest} typically deliver within 1 business day for {mode}, with same-day options available for expedited shipments." },
      { q: "Are same-day {mode} pickups available from {origin}?", a: "Yes. Because {origin} and {dest} are both major metros, most carriers offer same-day pickup windows for {mode} freight on this corridor." },
      { q: "What is the average {mode} cost from {origin} to {dest}?", a: "Short-haul {mode} rates on the {origin} to {dest} lane are among the lowest per-mile in the network due to the short distance and high carrier density." },
      { q: "How does carrier availability compare on the {origin} to {dest} {mode} lane?", a: "Both {origin} and {dest} are metro hubs with deep carrier pools, so capacity is consistent year-round for {mode} shipments." },
      { q: "Can I schedule last-mile delivery windows for {mode} freight arriving in {dest}?", a: "Absolutely. Metro destinations like {dest} support appointment-based delivery scheduling for {mode} freight, including liftgate and inside delivery." },
      { q: "Is {mode} or FTL better for short-haul freight between {origin} and {dest}?", a: "For partial loads, {mode} is typically more cost-effective on short-haul metro lanes. Full truckload makes sense when you fill a trailer consistently." },
      { q: "What equipment types run {mode} between {origin} and {dest}?", a: "Dry van and reefer are the most common equipment types on this short-haul metro lane, with flatbed available for oversized shipments." },
      { q: "How do I reduce {mode} shipping costs on the {origin} to {dest} lane?", a: "Consolidate shipments to fill capacity, book during off-peak windows, and leverage the high carrier density on this metro corridor for competitive {mode} rates." }
    ],
    faqVariants: [
      { q: "What pickup windows are standard for {mode} freight leaving {origin}?", a: "Most carriers offer morning and afternoon pickup windows in {origin} for {mode} shipments heading to {dest}, with expedited cutoffs as late as 3 PM." },
      { q: "Does weather impact {mode} transit between {origin} and {dest}?", a: "Short-haul metro lanes are less weather-sensitive, but winter storms or extreme heat can add a half-day buffer to {mode} deliveries." },
      { q: "Can I track {mode} shipments in real time on this lane?", a: "Yes. Most carriers on the {origin} to {dest} {mode} corridor provide GPS-based tracking with scan events at pickup, in-transit, and delivery." },
      { q: "What is the minimum shipment size for {mode} from {origin} to {dest}?", a: "Most {mode} carriers accept single-pallet shipments on metro corridors. There is no practical minimum beyond carrier-specific pallet requirements." },
      { q: "Are weekend {mode} deliveries available between {origin} and {dest}?", a: "Select carriers offer Saturday delivery on high-volume metro lanes. Contact for weekend availability on the {origin} to {dest} corridor." },
      { q: "How far in advance should I book {mode} freight from {origin} to {dest}?", a: "Same-day booking is often possible on this short-haul lane, but 24-48 hours of lead time ensures the best rate and carrier selection." }
    ]
  },

  // ---- 2. Port to Inland ----
  {
    id: "port_to_inland",
    priority: 2,
    label: "Port to Inland",
    match: (ctx) => (ctx.oClass.isPort && !ctx.dClass.isPort) || (!ctx.oClass.isPort && ctx.dClass.isPort),
    sectionEmphasis: { transit: "medium", cost: "medium", capacity: "high", customs: "high" },
    introTemplate: (origin, dest, mode, segLabel) =>
      `The ${origin} to ${dest} lane connects a major port gateway with an inland distribution point, making container drayage, intermodal coordination, and customs clearance central to every shipment. For ${segLabel}, understanding dwell times, chassis availability, and terminal fees on this corridor is critical. This guide covers ${mode} options, drayage strategies, and cost-saving approaches for the ${origin} to ${dest} port-to-inland lane.`,
    faqPool: [
      { q: "How does port congestion at {origin} affect {mode} transit to {dest}?", a: "Port dwell times at {origin} directly impact drayage schedules. WARP monitors terminal wait times and adjusts {mode} pickup windows to minimize delays on the {origin} to {dest} lane." },
      { q: "What intermodal options exist for {mode} freight from {origin} to {dest}?", a: "Container-on-chassis drayage to a nearby rail ramp is common for long-haul segments. For shorter runs, direct {mode} trucking from {origin} to {dest} is often faster." },
      { q: "Are there customs clearance delays on the {origin} to {dest} {mode} lane?", a: "If your freight originates as an ocean import, customs clearance at {origin} can add 1-3 days. Pre-clearing with a customs broker before vessel arrival reduces this window." },
      { q: "What chassis and equipment are available for {mode} drayage from {origin}?", a: "Standard 20-ft and 40-ft chassis are available at {origin} port terminals. {mode} carriers coordinate chassis pools to ensure availability for drayage to {dest}." },
      { q: "How do demurrage and detention fees work on the {origin} to {dest} lane?", a: "Demurrage accrues when containers sit at the port terminal past free time. Detention applies after the container leaves the terminal. Faster {mode} drayage to {dest} minimizes both charges." },
      { q: "Can I consolidate import containers for {mode} shipping to {dest}?", a: "Yes. Deconsolidation at a warehouse near {origin} followed by {mode} forwarding to {dest} is a common strategy for multi-SKU import shipments." },
      { q: "What is the typical {mode} drayage cost from {origin} port to {dest}?", a: "Port drayage rates vary by distance, chassis type, and terminal fees. The {origin} to {dest} {mode} lane benefits from high carrier density at the port." },
      { q: "How do I avoid container storage fees when shipping {mode} from {origin} to {dest}?", a: "Schedule {mode} drayage pickup within the terminal free-time window and confirm warehouse receiving availability at {dest} before dispatching." }
    ],
    faqVariants: [
      { q: "What documents are needed for {mode} freight leaving {origin} port?", a: "Bill of lading, customs release, and delivery order are standard. For hazmat or bonded freight, additional documentation applies to {mode} shipments to {dest}." },
      { q: "Can I transload containers at {origin} for {mode} delivery to {dest}?", a: "Transloading from ocean containers to domestic trailers at {origin} warehouses is widely available and can reduce {mode} costs on the run to {dest}." },
      { q: "How does seasonal volume affect {mode} rates from {origin} to {dest}?", a: "Peak import seasons at {origin} tighten drayage capacity and push {mode} rates higher. Booking ahead of peak mitigates cost spikes on the lane to {dest}." },
      { q: "What are the weight limits for {mode} containers from {origin} to {dest}?", a: "Standard road weight limits apply once the container leaves the terminal. Overweight containers may require permits or transloading before {mode} transport to {dest}." },
      { q: "Is bonded trucking available for {mode} shipments from {origin} to {dest}?", a: "Yes. Bonded carriers can move in-bond freight under customs control from {origin} to an inland examination station near {dest}." },
      { q: "How do I coordinate {mode} drayage with ocean vessel schedules at {origin}?", a: "Use vessel tracking to align {mode} drayage appointments at {origin} with expected container availability, reducing dwell time before heading to {dest}." },
      { q: "What happens if my {mode} container is held for customs exam at {origin}?", a: "Customs exams at {origin} can add 3-5 days. Factor this buffer into your {mode} transit plan to {dest} and notify receiving parties." },
      { q: "Are there inland port options for {mode} freight destined for {dest}?", a: "Some corridors offer inland port facilities that handle customs clearance closer to {dest}, potentially streamlining {mode} transit from {origin}." }
    ]
  },

  // ---- 3. Energy Corridor ----
  {
    id: "energy_corridor",
    priority: 3,
    label: "Energy Corridor",
    match: (ctx) => ctx.oClass.isEnergy || ctx.dClass.isEnergy,
    sectionEmphasis: { transit: "medium", cost: "high", capacity: "high", customs: "low" },
    introTemplate: (origin, dest, mode, segLabel) =>
      `Shipping ${mode} freight between ${origin} and ${dest} means navigating an energy-sector corridor where oversized loads, specialized equipment, and regulatory compliance shape every move. For ${segLabel}, permit requirements, escort protocols, and heavy-haul carrier access on this lane are non-negotiable considerations. This page covers ${mode} rate factors, equipment options, and compliance checkpoints for the ${origin} to ${dest} energy corridor.`,
    faqPool: [
      { q: "What specialized equipment is available for {mode} energy freight from {origin} to {dest}?", a: "Step-deck, double-drop, and RGN trailers are commonly used on energy corridors. {mode} carriers on the {origin} to {dest} lane maintain fleets rated for heavy and oversized loads." },
      { q: "Do I need permits for {mode} oversized shipments from {origin} to {dest}?", a: "Yes. Overweight and over-dimension loads require state permits for each jurisdiction between {origin} and {dest}. Lead times for permits vary by state." },
      { q: "How do oil and gas market cycles affect {mode} rates on the {origin} to {dest} lane?", a: "Active drilling seasons tighten flatbed and specialized capacity, pushing {mode} rates higher. Monitor rig counts and project schedules when planning shipments from {origin} to {dest}." },
      { q: "Are escort vehicles required for {mode} freight between {origin} and {dest}?", a: "Loads exceeding state width or height thresholds on the {origin} to {dest} corridor require pilot cars. Requirements vary by state and are determined during the permitting process." },
      { q: "What compliance certifications should {mode} carriers have on this energy lane?", a: "Look for TWIC cards, hazmat endorsements, and OSHA compliance certifications for carriers running {mode} freight between {origin} and {dest}." },
      { q: "Can I ship pipe, steel, or heavy equipment via {mode} from {origin} to {dest}?", a: "Absolutely. Flatbed and lowboy trailers on the {origin} to {dest} lane handle pipe bundles, structural steel, and drilling equipment regularly." },
      { q: "How does weather impact {mode} energy freight between {origin} and {dest}?", a: "Extreme heat, winter storms, and high winds can delay oversized {mode} loads due to permit travel restrictions. Build buffer days into the {origin} to {dest} schedule." },
      { q: "What is the typical lead time for booking {mode} energy freight from {origin} to {dest}?", a: "Specialized and oversized {mode} loads require 5-10 business days for permitting and carrier coordination. Standard heavy-haul bookings need 3-5 days advance notice." }
    ],
    faqVariants: [
      { q: "Are there weight restrictions on {mode} routes between {origin} and {dest}?", a: "Bridge weight limits and seasonal road restrictions apply on certain segments. Carriers pre-route {mode} loads from {origin} to {dest} to avoid restricted structures." },
      { q: "Can I consolidate energy equipment shipments via {mode} from {origin} to {dest}?", a: "Partial truckload consolidation works for smaller energy components. Oversized items typically require dedicated {mode} trailers on this corridor." },
      { q: "How do I track oversized {mode} loads between {origin} and {dest}?", a: "GPS tracking with geofence alerts is standard for energy corridor shipments. Escort vehicles also provide real-time position updates on {mode} loads." },
      { q: "What insurance coverage is recommended for {mode} energy freight on this lane?", a: "Cargo insurance with coverage limits matching the declared value of energy equipment is essential. Verify carrier liability for specialized {mode} loads between {origin} and {dest}." },
      { q: "Are hazmat {mode} shipments available from {origin} to {dest}?", a: "Yes. Hazmat-endorsed carriers operate on the {origin} to {dest} lane with proper placarding, containment, and emergency response plans for {mode} hazmat freight." },
      { q: "How do project timelines affect {mode} capacity on the {origin} to {dest} corridor?", a: "Large energy projects draw flatbed and heavy-haul capacity away from spot markets. Booking {mode} capacity early in project planning secures better rates." }
    ]
  },

  // ---- 4. Agriculture Lane ----
  {
    id: "agriculture_lane",
    priority: 4,
    label: "Agriculture Lane",
    match: (ctx) => ctx.oClass.isAgriculture || ctx.dClass.isAgriculture,
    sectionEmphasis: { transit: "high", cost: "medium", capacity: "high", customs: "low" },
    introTemplate: (origin, dest, mode, segLabel) =>
      `The ${origin} to ${dest} corridor is an active agriculture lane where seasonal harvest volumes, temperature-controlled freight, and time-sensitive delivery windows define the shipping rhythm. For ${segLabel}, aligning ${mode} capacity with planting and harvest cycles, managing reefer availability, and locking in rates before peak season are all priorities. This page outlines ${mode} strategies for produce, grain, and perishable freight between ${origin} and ${dest}.`,
    faqPool: [
      { q: "When is peak season for {mode} agriculture freight from {origin} to {dest}?", a: "Peak agricultural shipping on the {origin} to {dest} lane typically runs from late June through October, depending on crop cycles and regional harvest timing." },
      { q: "Are temperature-controlled {mode} trailers available from {origin} to {dest}?", a: "Yes. Reefer trailers with continuous temperature monitoring are available for {mode} shipments of produce, dairy, and other perishables on this agriculture corridor." },
      { q: "How do I lock in {mode} rates before harvest season on the {origin} to {dest} lane?", a: "Contract rates agreed 30-60 days before peak harvest provide rate stability. Spot {mode} rates on this lane can spike 15-25% during peak season." },
      { q: "What FSMA compliance requirements apply to {mode} food freight from {origin} to {dest}?", a: "The Sanitary Transportation Rule under FSMA requires temperature records, vehicle cleanliness, and proper handling procedures for {mode} food shipments between {origin} and {dest}." },
      { q: "Can I ship grain and bulk commodities via {mode} from {origin} to {dest}?", a: "Hopper trailers and bulk containers are available for grain shipments. For smaller volumes, {mode} palletized loads of bagged product are common on the {origin} to {dest} lane." },
      { q: "How does harvest timing affect {mode} capacity between {origin} and {dest}?", a: "Harvest draws reefer and dry van capacity into agricultural regions, tightening the {mode} market. Book early and confirm capacity commitments before harvest peaks." },
      { q: "What happens if {mode} produce freight is delayed between {origin} and {dest}?", a: "Perishable freight is time-critical. Carriers on this lane prioritize {mode} produce loads with dedicated dispatch and escalation protocols to minimize spoilage risk." },
      { q: "Are there weight exemptions for {mode} agricultural loads from {origin} to {dest}?", a: "Some states grant seasonal weight exemptions for agricultural commodities during harvest. Check state DOT rules for the {origin} to {dest} corridor." }
    ],
    faqVariants: [
      { q: "What temperature ranges do reefer {mode} trailers maintain on the {origin} to {dest} lane?", a: "Standard reefer trailers maintain -20F to 65F with continuous monitoring. Multi-temp trailers are available for mixed-temperature {mode} loads." },
      { q: "Can I combine produce and dry goods in a single {mode} shipment from {origin} to {dest}?", a: "Multi-temp trailers allow zone-separated loads. Alternatively, partition walls can separate reefer and dry sections within a single {mode} trailer." },
      { q: "How do I handle rejected {mode} produce loads at {dest}?", a: "Establish clear quality specs and temperature tolerance windows in your {mode} contract. WARP facilitates carrier accountability and claims processes for rejected loads." },
      { q: "What packaging standards apply to {mode} agricultural freight from {origin} to {dest}?", a: "Palletized produce should be stacked and secured to prevent shifting. Use waxed cartons or vented bins for temperature-sensitive {mode} shipments." },
      { q: "Is organic certification tracking available for {mode} freight from {origin} to {dest}?", a: "Carriers can maintain organic handling documentation for {mode} loads. Ensure trailers are cleaned and inspected per NOP requirements before loading at {origin}." },
      { q: "How do I plan {mode} freight around unpredictable harvest dates?", a: "Use rolling 2-week capacity reservations and adjust based on field reports. Flexible {mode} booking on the {origin} to {dest} lane accommodates harvest variability." },
      { q: "What refrigeration fuel surcharges apply to {mode} reefer freight on this lane?", a: "Reefer fuel surcharges are typically 5-10% above dry van {mode} rates. Lock in surcharge caps in your contract for the {origin} to {dest} corridor." }
    ]
  },

  // ---- 5. E-Commerce Corridor ----
  {
    id: "ecommerce_corridor",
    priority: 5,
    label: "E-Commerce Corridor",
    match: (ctx) => ctx.oClass.isEcommerce && ctx.dClass.isEcommerce,
    sectionEmphasis: { transit: "high", cost: "high", capacity: "medium", customs: "low" },
    introTemplate: (origin, dest, mode, segLabel) =>
      `The ${origin} to ${dest} lane is a high-velocity e-commerce corridor where parcel consolidation, fulfillment speed, and reverse logistics define competitive advantage. For ${segLabel}, optimizing ${mode} transit times between fulfillment centers, managing returns flow, and controlling last-mile handoff costs on this corridor are daily priorities. This guide covers ${mode} strategies for e-commerce freight moving between ${origin} and ${dest}.`,
    faqPool: [
      { q: "How does e-commerce volume affect {mode} rates from {origin} to {dest}?", a: "High parcel density on e-commerce corridors like {origin} to {dest} supports competitive {mode} rates. Volume commitments unlock additional tier discounts." },
      { q: "Can I consolidate parcel shipments into {mode} loads from {origin} to {dest}?", a: "Yes. Parcel consolidation into {mode} trailers reduces per-unit costs by 20-40% compared to small-parcel carriers on high-volume corridors." },
      { q: "What {mode} options support 2-day delivery from {origin} to {dest}?", a: "Expedited {mode} services with direct routing and priority dispatch can achieve 2-day delivery between {origin} and {dest} fulfillment hubs." },
      { q: "How do I handle e-commerce returns via {mode} from {dest} back to {origin}?", a: "Reverse logistics consolidation at {dest} with scheduled {mode} return loads to {origin} keeps costs predictable and reduces per-unit return shipping expense." },
      { q: "Are fulfillment center dock appointments available for {mode} from {origin} to {dest}?", a: "Most fulfillment centers on this corridor offer appointment-based receiving. Coordinate {mode} delivery windows with FC schedules to avoid detention fees." },
      { q: "What peak season surcharges apply to {mode} e-commerce freight on this lane?", a: "Holiday peaks from October through December can add 10-20% surcharges on {mode} rates. Locking in contract rates before Q4 mitigates this on the {origin} to {dest} corridor." },
      { q: "Can I track individual SKU pallets within a {mode} shipment from {origin} to {dest}?", a: "Pallet-level tracking with barcode or RFID integration is available for {mode} e-commerce loads, enabling SKU-level visibility across the {origin} to {dest} lane." },
      { q: "How do I balance speed and cost for {mode} e-commerce freight between {origin} and {dest}?", a: "Use standard {mode} for replenishment loads and reserve expedited for high-velocity SKUs. Splitting shipment tiers by urgency optimizes total freight spend." }
    ],
    faqVariants: [
      { q: "What packaging requirements apply to {mode} e-commerce pallets from {origin} to {dest}?", a: "Standard GMA pallets with stretch wrap and corner boards are preferred. Individual carton labeling supports scan-based receiving at {dest} fulfillment centers." },
      { q: "Can I use zone-skip strategies with {mode} from {origin} to {dest}?", a: "Consolidating e-commerce parcels into {mode} zone-skip loads from {origin} bypasses multiple carrier zones, reducing final-mile costs into the {dest} metro area." },
      { q: "How does inventory positioning affect {mode} shipping strategy on this lane?", a: "Pre-positioning inventory at {dest} via scheduled {mode} replenishment loads reduces order-to-delivery time and cuts expedited shipping spend." },
      { q: "What volume thresholds trigger better {mode} rates on the {origin} to {dest} corridor?", a: "Most carriers offer tiered discounts starting at 10+ pallets per week. Higher commitments unlock dedicated {mode} lanes with guaranteed capacity." },
      { q: "Are multi-stop {mode} deliveries available between {origin} and {dest} fulfillment centers?", a: "Yes. Multi-stop {mode} routes serving multiple FCs on the {origin} to {dest} corridor are available for coordinated inventory distribution." },
      { q: "How do promotional spikes affect {mode} capacity on the {origin} to {dest} lane?", a: "Flash sales and Prime-style events create short-term capacity crunches. Notify your {mode} provider 2-3 weeks ahead of major promotions for the {origin} to {dest} lane." }
    ]
  },

  // ---- 6. Coastal to Coastal ----
  {
    id: "coastal_to_coastal",
    priority: 6,
    label: "Coastal to Coastal",
    match: (ctx) => {
      const oWest = WEST_PACIFIC.has(ctx.oRegion);
      const dWest = WEST_PACIFIC.has(ctx.dRegion);
      const oEast = EAST_COAST.has(ctx.oRegion);
      const dEast = EAST_COAST.has(ctx.dRegion);
      return (oWest && dEast) || (oEast && dWest);
    },
    sectionEmphasis: { transit: "high", cost: "high", capacity: "medium", customs: "low" },
    introTemplate: (origin, dest, mode, segLabel) =>
      `Shipping ${mode} freight from ${origin} to ${dest} spans a cross-country corridor that crosses multiple time zones and climate regions. For ${segLabel}, planning multimodal options, managing extended transit windows, and building contingency into coast-to-coast schedules are essential. This page details ${mode} transit benchmarks, intermodal alternatives, and routing strategies for the ${origin} to ${dest} lane.`,
    faqPool: [
      { q: "What is the typical {mode} transit time from {origin} to {dest}?", a: "Coast-to-coast {mode} transit between {origin} and {dest} typically ranges from 4 to 7 business days depending on routing, weather, and carrier network." },
      { q: "Is intermodal {mode} a viable option from {origin} to {dest}?", a: "Yes. Rail-truck intermodal can reduce costs by 15-30% versus over-the-road {mode} on the {origin} to {dest} lane, with a 1-2 day transit trade-off." },
      { q: "How do time zone differences affect {mode} delivery scheduling between {origin} and {dest}?", a: "A 3-hour time difference between {origin} and {dest} impacts pickup and delivery appointment windows. Coordinate cutoff times across time zones to avoid missed appointments." },
      { q: "What weather risks apply to cross-country {mode} freight from {origin} to {dest}?", a: "Mountain passes, Great Plains storms, and seasonal weather patterns can delay {mode} transit. Build 1-2 buffer days into coast-to-coast schedules." },
      { q: "Can I split a coast-to-coast {mode} shipment into regional legs?", a: "Yes. Breaking the {origin} to {dest} run into relay segments with cross-dock transfers can improve driver availability and sometimes reduce {mode} costs." },
      { q: "How does fuel cost impact {mode} rates on the {origin} to {dest} lane?", a: "Cross-country lanes are fuel-sensitive. {mode} fuel surcharges on the {origin} to {dest} corridor fluctuate with diesel prices and add 15-25% to base rates." },
      { q: "What capacity challenges exist for {mode} freight between {origin} and {dest}?", a: "Long-haul lanes compete for driver hours-of-service. Team drivers or relay networks improve {mode} capacity and transit consistency on the {origin} to {dest} run." },
      { q: "Are expedited coast-to-coast {mode} options available from {origin} to {dest}?", a: "Team-driver expedited {mode} can cut transit to 3-4 days between {origin} and {dest}. Premium pricing applies, but it eliminates overnight stops." }
    ],
    faqVariants: [
      { q: "What routing options exist for {mode} freight from {origin} to {dest}?", a: "Southern, central, and northern corridors each have different transit and weather profiles. Carrier routing on the {origin} to {dest} {mode} lane depends on season and load type." },
      { q: "How do I compare {mode} versus air freight for the {origin} to {dest} lane?", a: "Air freight is 3-5x the cost of {mode} but delivers in 1-2 days. For time-sensitive shipments, evaluate the urgency premium against {mode} transit on this corridor." },
      { q: "Can I get guaranteed delivery dates for {mode} freight from {origin} to {dest}?", a: "Select carriers offer guaranteed {mode} service with refund provisions on the {origin} to {dest} corridor. Premium rates apply for guaranteed coast-to-coast delivery." },
      { q: "What tracking visibility is available for cross-country {mode} loads?", a: "Real-time GPS tracking with geofence milestone alerts at origin, midpoint, and destination provides full visibility on {mode} loads between {origin} and {dest}." },
      { q: "How do I handle driver HOS compliance on a {mode} load from {origin} to {dest}?", a: "Solo drivers require rest stops that add transit time. Team drivers or relay carriers maintain continuous movement on {mode} loads across the {origin} to {dest} corridor." },
      { q: "What are the main cost drivers for {mode} freight between {origin} and {dest}?", a: "Distance, fuel surcharges, driver availability, and seasonal demand are the primary cost factors for {mode} freight on the {origin} to {dest} lane." }
    ]
  },

  // ---- 7. Long-Haul Hub to Hub ----
  {
    id: "long_haul_hub_to_hub",
    priority: 7,
    label: "Long-Haul Hub to Hub",
    match: (ctx) => ctx.distance > 1000,
    sectionEmphasis: { transit: "medium", cost: "high", capacity: "high", customs: "low" },
    introTemplate: (origin, dest, mode, segLabel) =>
      `The ${origin} to ${dest} lane covers a long-haul corridor where hub-to-hub optimization, rate stability, and scheduled run frequency drive operational efficiency. For ${segLabel}, anchoring ${mode} freight on consistent hub-pair schedules reduces cost volatility and improves carrier commitment. This guide covers ${mode} rate benchmarks, capacity strategies, and hub network advantages for the ${origin} to ${dest} lane.`,
    faqPool: [
      { q: "What {mode} rate stability can I expect on the {origin} to {dest} hub-to-hub lane?", a: "Long-haul hub lanes like {origin} to {dest} support contracted {mode} rates with less volatility than spot markets due to consistent volume and carrier commitment." },
      { q: "How often do {mode} carriers run scheduled loads from {origin} to {dest}?", a: "High-volume hub pairs like {origin} to {dest} often have daily or multiple-times-per-week {mode} scheduled runs, improving transit predictability." },
      { q: "What transit time should I plan for {mode} freight from {origin} to {dest}?", a: "Long-haul {mode} transit between {origin} and {dest} varies by distance and mode but generally falls within 3-6 business days on established hub corridors." },
      { q: "Can I negotiate dedicated {mode} lanes from {origin} to {dest}?", a: "Yes. Consistent weekly volume on the {origin} to {dest} corridor supports dedicated {mode} lane agreements with guaranteed capacity and fixed pricing." },
      { q: "How do cross-dock facilities improve {mode} efficiency between {origin} and {dest}?", a: "Hub cross-docks near {origin} and {dest} enable freight consolidation, driver relay handoffs, and load optimization that reduce per-mile {mode} costs." },
      { q: "What volume commitments unlock better {mode} rates on this long-haul lane?", a: "Most carriers offer tier-based discounts starting at 5+ loads per week on the {origin} to {dest} corridor. Annual commitments unlock additional {mode} rate reductions." },
      { q: "Is backhaul pricing available for {mode} freight from {dest} to {origin}?", a: "Backhaul opportunities on the return leg from {dest} to {origin} often reduce round-trip {mode} costs by 10-20% when paired with outbound volume." },
      { q: "How do I maintain {mode} service consistency on a 1000+ mile lane like {origin} to {dest}?", a: "Use carrier scorecards tracking on-time percentage, claims ratio, and communication quality to maintain {mode} service standards on long-haul hub lanes." }
    ],
    faqVariants: [
      { q: "Can I use drop-trailer programs for {mode} freight from {origin} to {dest}?", a: "Drop-trailer programs eliminate live-loading wait times and improve {mode} efficiency on high-volume hub lanes like {origin} to {dest}." },
      { q: "What relay carrier options exist for {mode} loads from {origin} to {dest}?", a: "Multi-segment relay networks with driver handoffs at hub terminals keep {mode} loads moving continuously on long-haul lanes without HOS interruptions." },
      { q: "How do fuel surcharges affect long-haul {mode} rates on this corridor?", a: "Fuel surcharges on 1000+ mile {mode} lanes like {origin} to {dest} are a significant cost component. Negotiate surcharge caps or index-based formulas in your contract." },
      { q: "What carrier performance metrics matter most on the {origin} to {dest} {mode} lane?", a: "On-time pickup, on-time delivery, claims frequency, and tender acceptance rate are the key {mode} performance indicators for long-haul hub-to-hub lanes." },
      { q: "Can I pool shipments with other shippers on the {origin} to {dest} {mode} corridor?", a: "Freight pooling combines loads from multiple shippers on the same {mode} trailer, reducing per-shipper costs on high-volume corridors." },
      { q: "How do holiday closures impact {mode} scheduling between {origin} and {dest}?", a: "Build extra lead time around major holidays when carrier capacity tightens and terminal hours change on {mode} hub-to-hub lanes like {origin} to {dest}." },
      { q: "What contingency plans should I have for {mode} disruptions on this lane?", a: "Maintain relationships with 2-3 backup {mode} carriers and identify alternative routing through secondary hubs for the {origin} to {dest} corridor." }
    ]
  },

  // ---- 8. Midwest Manufacturing ----
  {
    id: "midwest_manufacturing",
    priority: 8,
    label: "Midwest Manufacturing",
    match: (ctx) => ctx.oRegion === MIDWEST_REGION || ctx.dRegion === MIDWEST_REGION,
    sectionEmphasis: { transit: "high", cost: "medium", capacity: "medium", customs: "low" },
    introTemplate: (origin, dest, mode, segLabel) =>
      `The ${origin} to ${dest} lane serves a Midwest manufacturing corridor where just-in-time delivery, production schedule alignment, and heavy freight capabilities are essential. For ${segLabel}, coordinating ${mode} pickups with plant output schedules, handling high-density manufactured goods, and maintaining tight delivery windows on this corridor keep production lines running. This page covers ${mode} options, equipment requirements, and scheduling strategies between ${origin} and ${dest}.`,
    faqPool: [
      { q: "How do I align {mode} pickups from {origin} with production schedules at {dest}?", a: "Work with your {mode} carrier to set standing pickup appointments at {origin} that match production output cadence and receiving windows at {dest}." },
      { q: "What equipment handles heavy manufactured goods via {mode} from {origin} to {dest}?", a: "Flatbed, step-deck, and reinforced dry van trailers handle high-density manufactured freight. Confirm axle weight ratings for {mode} loads between {origin} and {dest}." },
      { q: "Are just-in-time {mode} delivery windows available on the {origin} to {dest} lane?", a: "Yes. JIT carriers on manufacturing corridors like {origin} to {dest} offer narrow delivery windows with penalty clauses for late {mode} arrivals." },
      { q: "How does automotive parts shipping work via {mode} from {origin} to {dest}?", a: "Automotive JIT requires rack-return programs, sequence loading, and tight {mode} delivery windows. Carriers on the {origin} to {dest} lane support OEM supply chain requirements." },
      { q: "What {mode} cost factors are unique to manufacturing freight on this lane?", a: "Heavier average weights, specialized packaging, and tight schedule adherence drive {mode} costs on manufacturing corridors like {origin} to {dest}." },
      { q: "Can I set up recurring {mode} shipments between {origin} and {dest} manufacturing facilities?", a: "Standing {mode} orders with fixed schedules are standard on manufacturing lanes. Weekly and daily cadences are supported for the {origin} to {dest} corridor." },
      { q: "How does plant downtime scheduling affect {mode} capacity from {origin} to {dest}?", a: "Scheduled plant shutdowns create capacity surpluses or voids. Coordinate {mode} volume ramps with maintenance windows at {origin} and {dest} facilities." },
      { q: "What quality controls apply to {mode} manufacturing freight on this corridor?", a: "Load securement, clean trailer inspections, and damage-free delivery metrics are standard {mode} quality requirements for manufactured goods between {origin} and {dest}." }
    ],
    faqVariants: [
      { q: "Can I ship raw materials inbound and finished goods outbound via {mode} on this lane?", a: "Yes. Many carriers offer bidirectional {mode} service between {origin} and {dest}, handling inbound materials and outbound finished goods on complementary schedules." },
      { q: "What loading dock requirements apply to {mode} manufacturing freight at {origin}?", a: "Standard dock-height trailers require 48-inch docks. Ground-level loading for flatbed {mode} freight may need forklift or crane access at {origin}." },
      { q: "How do I reduce detention charges for {mode} loads at manufacturing plants?", a: "Pre-stage loads for quick turn and coordinate dock appointments to minimize {mode} trailer dwell time at {origin} and {dest} manufacturing facilities." },
      { q: "Are blanket wrap or white glove {mode} services available on this lane?", a: "Specialty carriers offer blanket wrap and white glove {mode} handling for high-value or damage-sensitive manufactured goods between {origin} and {dest}." },
      { q: "What inventory buffering strategies work with {mode} transit on the {origin} to {dest} lane?", a: "Safety stock calculations should account for {mode} transit variability. A 1-2 day buffer for manufacturing inputs reduces stockout risk on this corridor." },
      { q: "How does seasonal demand affect {mode} manufacturing freight between {origin} and {dest}?", a: "Q4 production ramps for retail and automotive model-year changes can tighten {mode} capacity on Midwest manufacturing lanes." }
    ]
  },

  // ---- 9. Sunbelt Growth ----
  {
    id: "sunbelt_growth",
    priority: 9,
    label: "Sunbelt Growth",
    match: (ctx) => SUNBELT_REGIONS.has(ctx.oRegion) && SUNBELT_REGIONS.has(ctx.dRegion),
    sectionEmphasis: { transit: "medium", cost: "medium", capacity: "medium", customs: "low" },
    introTemplate: (origin, dest, mode, segLabel) =>
      `The ${origin} to ${dest} lane runs through the Sunbelt growth corridor, where rapid population increases, new distribution center construction, and expanding retail footprints are reshaping freight demand. For ${segLabel}, tapping into ${mode} capacity on emerging lanes, positioning ahead of market expansion, and building carrier relationships in fast-growing metros like ${origin} and ${dest} create a first-mover advantage. This page covers ${mode} trends, capacity forecasts, and distribution strategies for the ${origin} to ${dest} Sunbelt corridor.`,
    faqPool: [
      { q: "How is population growth affecting {mode} freight demand between {origin} and {dest}?", a: "Sunbelt population growth is driving double-digit increases in consumer goods freight on corridors like {origin} to {dest}. {mode} capacity is expanding to match." },
      { q: "Are new distribution centers opening near {origin} or {dest}?", a: "Both {origin} and {dest} are attracting warehouse and distribution center investment. New facilities increase {mode} volume and improve carrier density on this lane." },
      { q: "What {mode} rate trends should I expect on the {origin} to {dest} Sunbelt corridor?", a: "Growing demand on Sunbelt lanes pushes {mode} rates upward, but new carrier entrants and capacity investment are moderating increases on the {origin} to {dest} corridor." },
      { q: "How does construction activity affect {mode} freight between {origin} and {dest}?", a: "Building materials, fixtures, and equipment shipments add significant {mode} volume to Sunbelt growth lanes like {origin} to {dest}, especially in spring and summer." },
      { q: "Can I establish a {mode} presence on the {origin} to {dest} lane before competitors?", a: "Early volume commitments on emerging Sunbelt corridors lock in favorable {mode} rates and guarantee capacity before demand peaks on the {origin} to {dest} lane." },
      { q: "What retail expansion opportunities drive {mode} freight on this Sunbelt lane?", a: "National and regional retailers are opening stores across the Sunbelt. Replenishment {mode} freight from {origin} to {dest} supports new store openings and market expansion." },
      { q: "How does summer heat affect {mode} transit between {origin} and {dest}?", a: "Extreme Sunbelt heat requires reefer for perishables and can affect driver hours. {mode} carriers on the {origin} to {dest} lane adjust schedules for early-morning and overnight runs." },
      { q: "What infrastructure improvements are planned for {mode} corridors between {origin} and {dest}?", a: "Highway expansion, intermodal terminal construction, and last-mile road improvements on Sunbelt corridors are improving {mode} transit reliability between {origin} and {dest}." }
    ],
    faqVariants: [
      { q: "How does the housing boom affect {mode} freight demand on this lane?", a: "Residential construction drives appliance, fixture, and building supply {mode} shipments between {origin} and {dest} at rates that track housing permits." },
      { q: "Are there labor market impacts on {mode} carrier availability between {origin} and {dest}?", a: "Driver recruitment in growing Sunbelt metros is competitive. Carriers serving {origin} to {dest} are investing in driver programs to maintain {mode} capacity." },
      { q: "What e-commerce growth trends affect {mode} on the {origin} to {dest} corridor?", a: "Sunbelt e-commerce fulfillment expansion adds last-mile and middle-mile {mode} demand. New fulfillment centers near {origin} and {dest} are increasing freight velocity." },
      { q: "Can I use {origin} or {dest} as a regional distribution hub?", a: "Both cities are viable Sunbelt distribution hubs. {mode} service from {origin} or {dest} reaches surrounding growth markets within 1-2 day transit windows." },
      { q: "How do hurricane and storm seasons affect {mode} freight on this Sunbelt lane?", a: "Gulf and Atlantic hurricane seasons from June to November can disrupt {mode} service between {origin} and {dest}. Pre-position inventory and identify backup routes." },
      { q: "What sustainability initiatives affect {mode} freight on the {origin} to {dest} corridor?", a: "New emissions regulations and shipper sustainability goals are encouraging intermodal and consolidated {mode} strategies on Sunbelt lanes." },
      { q: "How is industrial relocation from other regions affecting {mode} demand on this lane?", a: "Manufacturing and distribution relocations into the Sunbelt are adding inbound and outbound {mode} volume on the {origin} to {dest} corridor." }
    ]
  },

  // ---- 10. Retail Distribution (fallback) ----
  {
    id: "retail_distribution",
    priority: 10,
    label: "Retail Distribution",
    match: () => true,
    sectionEmphasis: { transit: "medium", cost: "medium", capacity: "medium", customs: "low" },
    introTemplate: (origin, dest, mode, segLabel) =>
      `The ${origin} to ${dest} lane supports retail distribution freight where store replenishment cycles, seasonal demand peaks, and regional hub connectivity shape every shipment decision. For ${segLabel}, optimizing ${mode} frequency to match sell-through rates, pre-positioning inventory ahead of promotional windows, and managing multi-stop delivery schedules across the ${origin} to ${dest} corridor keep shelves stocked and costs controlled. This page covers ${mode} strategies for retail freight between ${origin} and ${dest}.`,
    faqPool: [
      { q: "How do I align {mode} replenishment schedules from {origin} to {dest} retail locations?", a: "Match {mode} shipment cadence from {origin} to {dest} with store sell-through data and safety stock thresholds to optimize inventory turns." },
      { q: "What seasonal peaks affect {mode} retail freight on the {origin} to {dest} lane?", a: "Back-to-school, holiday, and spring reset seasons create {mode} volume spikes on retail corridors like {origin} to {dest}. Book capacity 4-6 weeks ahead of peaks." },
      { q: "Can I use regional distribution centers to optimize {mode} freight from {origin} to {dest}?", a: "Yes. Routing {mode} freight through regional DCs between {origin} and {dest} reduces per-store delivery costs and supports tighter replenishment windows." },
      { q: "What multi-stop delivery options exist for {mode} retail freight from {origin} to {dest}?", a: "Multi-stop {mode} routes serving clusters of retail locations between {origin} and {dest} lower per-stop costs and consolidate delivery appointments." },
      { q: "How do promotional events affect {mode} capacity on the {origin} to {dest} lane?", a: "Major promotions create short-term {mode} demand spikes. Provide promotional calendars to carriers 3-4 weeks ahead to secure capacity on the {origin} to {dest} lane." },
      { q: "What packaging and labeling standards apply to {mode} retail freight?", a: "Retail compliance labeling, floor-ready pallets, and ASN integration are common requirements for {mode} shipments from {origin} destined for retail receiving docks at {dest}." },
      { q: "How do chargebacks impact {mode} retail freight costs on this corridor?", a: "Late deliveries, incorrect labeling, and damaged goods trigger retail chargebacks. Carrier selection and {mode} service-level commitments on the {origin} to {dest} lane minimize chargeback risk." },
      { q: "Can I track {mode} retail freight at the PO level from {origin} to {dest}?", a: "PO-level tracking with EDI 856 ASN integration provides visibility from {mode} pickup at {origin} through receiving at {dest} retail locations." }
    ],
    faqVariants: [
      { q: "What vendor compliance programs affect {mode} shipping from {origin} to {dest}?", a: "Major retailers impose routing guides, delivery windows, and documentation requirements. Ensure {mode} carriers on the {origin} to {dest} lane meet your retail partners' compliance standards." },
      { q: "How do I reduce retail {mode} freight costs between {origin} and {dest}?", a: "Consolidate store orders into full pallets, optimize delivery routes, and negotiate volume-based {mode} rates for the {origin} to {dest} corridor." },
      { q: "Are pool distribution options available for {mode} freight from {origin} to {dest}?", a: "Pool distribution through a hub near {dest} consolidates {mode} loads from multiple origins and splits them for final delivery to individual retail stores." },
      { q: "What happens if a {mode} retail shipment misses the delivery window at {dest}?", a: "Missed delivery appointments at {dest} retail locations typically result in chargebacks and rescheduling delays. Prioritize on-time {mode} carriers for this corridor." },
      { q: "How do I manage {mode} freight for new store openings near {dest}?", a: "New store opening freight requires coordinated {mode} delivery of fixtures, initial inventory, and signage. Plan dedicated loads from {origin} with tight scheduling." },
      { q: "Can I combine retail and e-commerce {mode} shipments from {origin} to {dest}?", a: "Omnichannel fulfillment allows combining store replenishment and e-commerce orders on consolidated {mode} loads for the {origin} to {dest} corridor." },
      { q: "What seasonal inventory pre-positioning strategies work for {mode} on this lane?", a: "Ship seasonal inventory from {origin} to {dest} regional warehouses 6-8 weeks before demand peaks to avoid capacity crunches and rate spikes on the {mode} lane." },
      { q: "How does shrinkage affect {mode} retail freight planning between {origin} and {dest}?", a: "Account for in-transit shrinkage with sealed trailers, tamper-evident seals, and carrier accountability standards for {mode} shipments from {origin} to {dest}." }
    ]
  }
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Assign the highest-priority matching archetype to a lane.
 * @param {string} origin — full city name, e.g. "Chicago, IL"
 * @param {string} dest — full city name
 * @param {number} distance — straight-line miles (haversine)
 * @param {string} oRegion — origin region from cities.json
 * @param {string} dRegion — destination region from cities.json
 * @returns {object} — the matched archetype object
 */
export function assignArchetype(origin, dest, distance, oRegion, dRegion) {
  const oClass = classifyCity(origin);
  const dClass = classifyCity(dest);
  const ctx = { distance, oClass, dClass, oRegion, dRegion };

  for (const archetype of ARCHETYPES) {
    if (archetype.match(ctx)) return archetype;
  }
  // Fallback is guaranteed by retail_distribution (always true), but just in case:
  return ARCHETYPES[ARCHETYPES.length - 1];
}

/**
 * Select and hydrate 5 FAQ items for a given archetype.
 *
 * When faqWeights are provided (from learning_state.faq_weights), uses
 * weighted deterministic selection so higher-performing FAQ questions
 * are more likely to be selected. Without weights, falls back to the
 * original modular offset rotation.
 *
 * @param {object} archetype — archetype object from ARCHETYPES
 * @param {string} origin — display city name
 * @param {string} dest — display city name
 * @param {string} mode — LTL | FTL | Cargo Van / Box Truck
 * @param {string} segment — smb | enterprise | midmarket
 * @param {number} pageIndex — page ordinal (used to rotate FAQ selection)
 * @param {object} [faqWeights] — optional map of faq_id → { weight } from learning state
 * @returns {Array<{q: string, a: string}>} — 5 hydrated FAQ items
 */
export function getArchetypeFaq(archetype, origin, dest, mode, segment, pageIndex, faqWeights) {
  const faqCount = 5;
  const pool = archetype.faqPool || [];
  const variants = archetype.faqVariants || [];
  const segLabel = SEGMENT_LABELS[segment] || SEGMENT_LABELS.smb;

  // Determine which pool to use based on rotation exhaustion.
  // Each page picks 5; once pageIndex * 5 exceeds pool length, rotate to variants.
  const poolExhausted = pageIndex * faqCount >= pool.length * 2;
  const sourcePool = poolExhausted && variants.length > 0 ? variants : pool;

  const len = sourcePool.length;
  if (len === 0) return [];

  // Build a deterministic hash from the lane + archetype + pageIndex
  const hashKey = `${archetype.id}|${origin}|${dest}|${mode}|${pageIndex}`;
  const hash = stableHash(hashKey);

  let selected;

  // If FAQ weights exist with at least one entry, use weighted selection
  const hasWeights = faqWeights && Object.keys(faqWeights).length > 0;
  if (hasWeights) {
    // Build weighted pool: each item gets its learned weight (or 1.0 default)
    const weightedPool = sourcePool.map((item, i) => {
      const faqId = item.id || `faq_${archetype.id}_${i}`;
      const w = faqWeights[faqId]?.weight ?? faqWeights[faqId] ?? 1.0;
      // Ensure weight is a number
      const weight = typeof w === "number" ? w : (typeof w === "object" && w.weight ? w.weight : 1.0);
      return { item, weight: Math.max(0.01, weight), faqId };
    });

    // Sort by weight descending, then use seeded hash for deterministic offset
    weightedPool.sort((a, b) => b.weight - a.weight);
    const startOffset = hash % len;
    selected = [];
    for (let i = 0; i < Math.min(faqCount, len); i++) {
      selected.push(weightedPool[(startOffset + i) % len].item);
    }
  } else {
    // Original modular offset rotation (no learning)
    selected = [];
    const startOffset = hash % len;
    for (let i = 0; i < Math.min(faqCount, len); i++) {
      selected.push(sourcePool[(startOffset + i) % len]);
    }
  }

  // Hydrate placeholders
  return selected.map((item) => ({
    q: hydrate(item.q, origin, dest, mode, segLabel),
    a: hydrate(item.a, origin, dest, mode, segLabel)
  }));
}

/**
 * Generate the archetype-specific intro paragraph.
 * @param {object} archetype — archetype object
 * @param {string} origin — display city name
 * @param {string} dest — display city name
 * @param {string} mode — LTL | FTL | Cargo Van / Box Truck
 * @param {string} segment — smb | enterprise | midmarket
 * @returns {string} — hydrated intro text
 */
export function getArchetypeIntro(archetype, origin, dest, mode, segment) {
  const segLabel = SEGMENT_LABELS[segment] || SEGMENT_LABELS.smb;
  return archetype.introTemplate(origin, dest, mode, segLabel);
}

/**
 * Return the section emphasis map for a given archetype.
 * @param {object} archetype
 * @returns {{ transit: string, cost: string, capacity: string, customs: string }}
 */
export function getSectionEmphasis(archetype) {
  return archetype.sectionEmphasis;
}

/**
 * Analyze archetype distribution across a set of pages.
 * Flags any archetype that accounts for more than 25% of total pages.
 *
 * @param {Array<{archetype: {id: string}}>} pages — array of page objects
 *   each expected to have an `archetype` property with an `id` field
 * @returns {{ counts: Object<string, number>, warnings: string[], total: number }}
 */
export function analyzeDistribution(pages) {
  const counts = {};
  const total = pages.length;

  for (const page of pages) {
    const id = page.archetype?.id || "unknown";
    counts[id] = (counts[id] || 0) + 1;
  }

  const warnings = [];
  const threshold = total * 0.25;
  for (const [id, count] of Object.entries(counts)) {
    if (count > threshold) {
      const pct = ((count / total) * 100).toFixed(1);
      warnings.push(
        `Archetype "${id}" accounts for ${pct}% of pages (${count}/${total}). Consider diversifying lane selection to improve content variety.`
      );
    }
  }

  return { counts, warnings, total };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Replace {origin}, {dest}, {mode}, {segment} placeholders in a string.
 */
function hydrate(template, origin, dest, mode, segLabel) {
  return template
    .replace(/\{origin\}/g, origin)
    .replace(/\{dest\}/g, dest)
    .replace(/\{mode\}/g, mode)
    .replace(/\{segment\}/g, segLabel);
}

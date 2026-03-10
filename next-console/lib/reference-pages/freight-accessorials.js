/**
 * Freight Accessorials Guide — Reference Authority Page
 * Explains common accessorial charges with tables and definitions.
 */

export function getAccessorialsContent() {
  return {
    slug: "freight-accessorials",
    title: "Freight Accessorials Guide: Common Surcharges Explained | WARP",
    meta_description: "Learn about freight accessorial charges including liftgate, inside delivery, residential pickup, and limited access fees. Understand what adds to your shipping cost.",
    h1: "Freight Accessorials Guide",
    intro: "Accessorial charges are fees beyond the standard linehaul rate for additional services during pickup or delivery. Understanding accessorials helps you budget accurately and avoid surprise charges on your freight invoices.",
    sections: [
      {
        heading: "What Are Freight Accessorials?",
        content: "Accessorials are supplemental services that carriers provide beyond standard dock-to-dock transportation. They cover special handling, equipment, or location requirements. Accessorials are quoted separately from the base linehaul rate and can add 10-40% to your total shipping cost depending on the services required.",
      },
      {
        heading: "Common Accessorial Charges",
        content: "| Accessorial | Typical Cost | Description |\n|-------------|-------------|-------------|\n| Liftgate Pickup | $50-150 | Hydraulic lift to load from ground level |\n| Liftgate Delivery | $50-150 | Hydraulic lift to unload at ground level |\n| Inside Pickup | $75-200 | Carrier enters building beyond dock |\n| Inside Delivery | $75-200 | Carrier delivers past the dock area |\n| Residential Pickup | $75-150 | Pickup from a residential address |\n| Residential Delivery | $75-150 | Delivery to a residential address |\n| Limited Access | $75-175 | Schools, churches, construction sites |\n| Appointment Delivery | $25-75 | Scheduled time window delivery |\n| Notify Before Delivery | $10-25 | Phone call before arrival |\n| Sort & Segregate | $25-50 | Separate mixed pallets |\n| Redelivery | $100-250 | Second delivery attempt |\n| Storage | $25-75/day | Warehouse storage beyond free time |\n| Hazmat | $50-250 | Hazardous materials handling |",
      },
      {
        heading: "How to Minimize Accessorial Charges",
        content: "Ship from and to locations with standard loading docks. Use pallets and shrink wrap to avoid sort-and-segregate fees. Provide accurate addresses to prevent limited-access surcharges. Schedule deliveries during business hours. Ensure someone is available at delivery to avoid redelivery fees. Declare all accessorials upfront when quoting to avoid billing adjustments.",
      },
    ],
    faq: [
      { q: "What is the most common accessorial charge?", a: "Liftgate service is the most frequently applied accessorial, typically ranging from $50-150 per occurrence. It is required whenever the pickup or delivery location lacks a standard loading dock." },
      { q: "Can I negotiate accessorial rates?", a: "Yes. High-volume shippers can often negotiate reduced accessorial rates as part of their carrier agreements. Consolidating accessorial needs across shipments also provides leverage." },
      { q: "Are accessorials included in freight quotes?", a: "Standard quotes typically include only the base linehaul rate. Accessorials must be specified during the quoting process to get an all-in price. WARP includes common accessorials in its instant quotes when specified." },
      { q: "What is a limited access location?", a: "Limited access locations include schools, churches, military bases, construction sites, prisons, farms, and any location that restricts carrier access or requires special scheduling." },
      { q: "How are residential surcharges determined?", a: "Carriers use address databases to flag residential addresses. If a business operates from a residential address, you may need to provide documentation to avoid the surcharge." },
    ],
    internal_link_categories: ["lane_pages_ltl", "freight_class", "freight_cost_breakdown"],
  };
}

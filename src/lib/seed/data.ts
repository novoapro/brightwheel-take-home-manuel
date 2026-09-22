import type { Center, PolicyInput } from "../types";

/**
 * Seed data for Little Acorns Early Learning Center.
 *
 * Adapted (not copied) from the public City of Albuquerque 2019 Family Handbook
 * into a fictional independent SMB — see analysis/02-seed-source-and-policy-map.md.
 * Operational policies are kept faithful; income-graduated fees are replaced with
 * invented flat published tuition, and a concrete 2026 closure calendar + weekly
 * menu are fabricated so the deterministic showcases (Veterans Day, snow, fever,
 * late pickup, lunch) are answerable from typed payloads.
 *
 * All data is fictional. No real personal data.
 */

export const CENTER: Center = {
  id: "little-acorns",
  name: "Little Acorns Early Learning Center",
  city: "Albuquerque",
  state: "NM",
  phone: "(505) 555-0182",
  timezone: "America/Denver",
  hours_general: "Monday–Friday, 7:00 AM – 6:00 PM",
  age_groups: [
    { group: "Infant", range: "6 weeks – 12 months" },
    { group: "Toddler", range: "1 – 2 years" },
    { group: "Preschool", range: "3 – 4 years" },
    { group: "Pre-K", range: "4 – 5 years" },
  ],
  persona_notes:
    "Warm, plain-spoken, and reassuring — a caring front-desk lead who knows every family by name. Never a cold IVR or a scripted chatbot.",
  // Brand layer (analysis/10 §4). The green + acorn now come from tenant config,
  // so re-theming Little Acorns live in the control center is a one-click
  // white-label moment — "watch this become another center."
  display_name: "Little Acorns Front Desk",
  brand_color: "#4f7a5b", // the center's sage green — now tenant-owned, not hardcoded
  welcome_message:
    "Hi! I can help with **hours, tuition, sick-day policy, meals, and tours** — with answers straight from our center. What can I help you with?",
};

export const POLICIES: PolicyInput[] = [
  // ─────────────────────────── HOURS & CLOSURES ───────────────────────────
  {
    id: "hours.regular",
    intent: "hours",
    title: "Hours of Operation",
    body_md:
      "We're open **Monday through Friday, 7:00 AM to 6:00 PM**. We're closed on weekends and on the holidays listed in our closure calendar. Drop-off and pickup can happen any time within those hours.",
    structured: {
      days: {
        mon: "07:00-18:00",
        tue: "07:00-18:00",
        wed: "07:00-18:00",
        thu: "07:00-18:00",
        fri: "07:00-18:00",
      },
      closed: ["sat", "sun"],
    },
    keywords: ["hours", "open", "close", "time", "weekend", "schedule", "drop off", "pickup"],
    source: "Family Handbook p.3",
  },
  {
    id: "hours.holidays.2026",
    intent: "hours",
    title: "2026 Holiday & Closure Calendar",
    body_md:
      "Little Acorns is closed on the following dates in 2026. We give as much notice as possible for staff-development days.",
    structured: {
      year: 2026,
      closures: [
        { date: "2026-01-01", name: "New Year's Day", type: "holiday" },
        { date: "2026-01-19", name: "Martin Luther King Jr. Day", type: "holiday" },
        { date: "2026-02-16", name: "Presidents' Day", type: "holiday" },
        { date: "2026-05-25", name: "Memorial Day", type: "holiday" },
        { date: "2026-06-19", name: "Juneteenth", type: "holiday" },
        { date: "2026-07-03", name: "Independence Day (observed)", type: "holiday" },
        { date: "2026-09-07", name: "Labor Day", type: "holiday" },
        { date: "2026-10-09", name: "Staff Development Day", type: "staff_development" },
        { date: "2026-11-11", name: "Veterans Day", type: "holiday" },
        { date: "2026-11-26", name: "Thanksgiving Day", type: "holiday" },
        { date: "2026-11-27", name: "Day after Thanksgiving", type: "holiday" },
        { date: "2026-12-24", name: "Winter Break", type: "break" },
        { date: "2026-12-25", name: "Christmas Day", type: "holiday" },
        { date: "2026-12-31", name: "Winter Break", type: "break" },
        { date: "2027-01-01", name: "New Year's Day", type: "holiday" },
      ],
    },
    keywords: ["holiday", "closed", "closure", "veterans day", "thanksgiving", "christmas", "winter break", "calendar", "2026"],
    effective_from: "2026-01-01",
    effective_to: "2027-01-01",
    source: "Family Handbook p.4",
  },
  {
    id: "hours.snow_weather",
    intent: "hours",
    title: "Snow & Severe Weather",
    body_md:
      "In snow or severe weather we follow the local public schools. If they announce a **2-hour delay**, we open at **10:00 AM** and breakfast is not served that morning. If they call an **early dismissal** or a **full closure**, Little Acorns closes too. We post any change on our family app first thing in the morning.",
    structured: {
      policy: "follows_local_public_schools",
      delay: { trigger: "2-hour delay", open: "10:00", breakfast_served: false },
      early_dismissal: { action: "center_closes" },
      closure: { action: "center_closed" },
    },
    keywords: ["snow", "weather", "delay", "closed", "storm", "ice", "closure", "early dismissal"],
    source: "Family Handbook p.5",
  },
  {
    id: "hours.late_pickup",
    intent: "hours",
    title: "Late Pickup",
    body_md:
      "Pickup is by 6:00 PM. A late pickup is **$15 per occurrence**, added to your next bill. After **3 late pickups** we'll ask to sit down together for a short parent conference. If a child is still here 30 minutes after close and we can't reach anyone on the contact list, we're required to call the authorities — so please keep your emergency contacts current.",
    structured: {
      late_fee_usd: 15,
      per: "occurrence",
      late_strikes_before_conference: 3,
      unreachable_after_minutes: 30,
    },
    keywords: ["late", "pickup", "fee", "$15", "conference", "after hours", "6pm"],
    source: "Family Handbook p.6",
  },
  {
    id: "hours.attendance",
    intent: "hours",
    title: "Attendance & Absences",
    body_md:
      "A full-time day is about **6.5 hours**, five days a week. Please let us know each day your child will be absent. If we go **two consecutive weeks with no contact and no attendance**, the spot may be released to a family on our waitlist.",
    structured: {
      full_time_hours_per_day: 6.5,
      days_per_week: 5,
      notify_if_absent: "daily",
      absence_disenroll_weeks: 2,
    },
    keywords: ["attendance", "absent", "absence", "full time", "notify", "sick day", "disenroll"],
    source: "Family Handbook p.7",
  },

  // ─────────────────────────────── TUITION ───────────────────────────────
  {
    id: "tuition.rates",
    intent: "tuition",
    title: "Tuition Rates",
    body_md:
      "Monthly tuition depends on your child's age group:\n\n- **Infant** (6 wks–12 mo): $1,650/mo\n- **Toddler** (1–2 yr): $1,450/mo\n- **Preschool** (3–4 yr): $1,250/mo\n- **Pre-K** (4–5 yr): $1,150/mo\n\nRates cover meals, snacks, and all classroom activities.",
    structured: {
      currency: "USD",
      period: "monthly",
      rates: [
        { group: "infant", monthly: 1650 },
        { group: "toddler", monthly: 1450 },
        { group: "preschool", monthly: 1250 },
        { group: "prek", monthly: 1150 },
      ],
      includes: ["meals", "snacks", "classroom activities"],
    },
    keywords: ["tuition", "cost", "price", "rate", "monthly", "fee", "how much", "infant", "toddler", "preschool", "prek"],
    source: "Family Handbook p.9",
  },
  {
    id: "tuition.payment",
    intent: "tuition",
    title: "Payment & Billing",
    body_md:
      "Tuition is billed **weekly, in advance**, and is paid online through the family app. Tuition is **non-refundable and not pro-rated** for absences, holidays, or vacation days. Any late-pickup fees are added to your next bill.",
    structured: {
      due: "weekly_in_advance",
      refundable: false,
      prorated: false,
      methods: ["online"],
      late_pickup_fee_added_to_bill: true,
    },
    keywords: ["payment", "billing", "pay", "refund", "invoice", "prorate", "advance", "online"],
    source: "Family Handbook p.10",
  },

  // ──────────────────────── HEALTH & SICK-CHILD (sensitive) ────────────────────────
  {
    id: "health.illness_exclusion",
    intent: "health",
    title: "When to Keep Your Child Home",
    body_md:
      "Please keep your child home if they have any of the following. A fever means a temperature of **100.4°F or higher** — or any fever in the **last 24 hours**.\n\n- Fever (100.4°F+), now or within the last 24 hours\n- Vomiting or diarrhea within the last 24 hours\n- Continuous coughing during nap\n- Pink eye or thick, cloudy nasal discharge\n- On antibiotics for less than 24 hours\n- A contagious illness (ringworm, chicken pox, etc.) or an undiagnosed rash\n\nIf you're unsure whether your child's specific symptoms mean they should stay home, let us know and a staff member will help you decide.",
    structured: {
      fever_f: 100.4,
      exclude: [
        "fever (100.4F+) now or within last 24h",
        "vomiting or diarrhea within last 24h",
        "continuous coughing during nap",
        "pink eye",
        "thick or cloudy nasal discharge",
        "on antibiotics less than 24h",
        "contagious illness (ringworm, chicken pox)",
        "undiagnosed rash",
      ],
    },
    keywords: ["sick", "fever", "100.4", "keep home", "stay home", "vomit", "diarrhea", "pink eye", "cough", "rash", "illness"],
    sensitivity: "sensitive",
    source: "Family Handbook p.12",
  },
  {
    id: "health.return_to_care",
    intent: "health",
    title: "Returning After an Illness",
    body_md:
      "A child may return once they've been **fever-free for 24 hours without fever-reducing medicine**, and **24 hours clear of vomiting or diarrhea**. If your child was on antibiotics, they should have had them for at least 24 hours first. We may ask for a doctor's note, and after any hospitalization or ER visit we'll need a **medical release** before your child returns.",
    structured: {
      fever_free_hours: 24,
      vomit_diarrhea_free_hours: 24,
      antibiotics_hours: 24,
      doctor_note: "may be required",
      hospital_return: "medical_release_required",
    },
    keywords: ["return", "come back", "fever free", "24 hours", "doctor note", "medical release", "after sick", "hospital"],
    sensitivity: "sensitive",
    source: "Family Handbook p.13",
  },
  {
    id: "health.contagious",
    intent: "health",
    title: "Contagious Illness Reporting",
    body_md:
      "If your child is diagnosed with a contagious illness, please tell us right away so we can notify other families and clean thoroughly. Some illnesses are **reportable to the state health department**, which we handle on our end.",
    structured: {
      must_inform_center: true,
      reportable_to_state: true,
    },
    keywords: ["contagious", "report", "outbreak", "notify", "communicable", "health department"],
    sensitivity: "sensitive",
    source: "Family Handbook p.13",
  },
  {
    id: "health.medication",
    intent: "health",
    title: "Medication",
    body_md:
      "We can give medication only with a **signed written permission form** listing the child's name, the medication, the dosage, and the time. It must be in its **original container**. We can't give cough drops (a choking risk). Common OTC items like Tylenol, sunscreen, and diaper cream are allowed with permission on file.",
    structured: {
      requires_written_permission: true,
      requires: ["child name", "medication", "dosage", "time"],
      original_container: true,
      no_cough_drops: true,
      otc_allowed: ["Tylenol", "sunscreen", "diaper cream"],
    },
    keywords: ["medication", "medicine", "tylenol", "permission", "dosage", "cough drops", "sunscreen", "administer"],
    sensitivity: "sensitive",
    source: "Family Handbook p.14",
  },
  {
    id: "health.immunizations",
    intent: "health",
    title: "Immunizations",
    body_md:
      "New Mexico requires an up-to-date immunization record on file before a child can attend. State law allows **medical and religious exemptions** with the proper paperwork.",
    structured: {
      up_to_date_required: true,
      exemptions: ["medical", "religious"],
      state: "NM",
    },
    keywords: ["immunization", "vaccine", "shots", "exemption", "records", "required"],
    sensitivity: "sensitive",
    source: "Family Handbook p.15",
  },

  // ───────────────────────────── MEALS & FOOD ─────────────────────────────
  {
    id: "meals.provided",
    intent: "meals",
    title: "Meals & Snacks",
    body_md:
      "We provide **breakfast, lunch, and an afternoon snack** every day, served **family-style** so children learn to serve themselves and try new foods. Breakfast is at 8:00, lunch at 11:30, and snack at 2:30. Our menu rotates weekly — so if you ever forget to pack something, don't worry, your child will eat well.",
    structured: {
      included: true,
      family_style: true,
      times: { breakfast: "08:00", lunch: "11:30", snack: "14:30" },
      menu_rotates_weekly: true,
      sample_menu: {
        mon: "Whole-grain pancakes; turkey & cheese roll-ups, carrots; apple slices",
        tue: "Oatmeal & berries; bean & cheese burrito, corn; yogurt",
        wed: "Scrambled eggs & toast; chicken pasta, green beans; crackers & cheese",
        thu: "Yogurt & granola; veggie quesadilla, cucumbers; banana",
        fri: "Whole-grain waffles; mac & cheese, peas; graham crackers",
      },
    },
    keywords: ["meals", "food", "lunch", "breakfast", "snack", "menu", "forgot lunch", "family style", "eat"],
    source: "Family Handbook p.17",
  },
  {
    id: "meals.outside_food",
    intent: "meals",
    title: "Outside Food",
    body_md:
      "Because meals are provided and we keep classrooms **peanut-limited**, we ask that outside food stay home. The exception is a store-bought item with a nutrition label that a teacher has approved (for a birthday, say) — please label it with your child's name and the date.",
    structured: {
      outside_food: "restricted",
      exception: "store-bought with nutrition label, teacher-approved",
      peanut_limited: true,
      label_required: ["name", "date"],
    },
    keywords: ["outside food", "bring food", "birthday", "treats", "peanut", "snack from home", "label"],
    source: "Family Handbook p.18",
  },
  {
    id: "meals.allergies",
    intent: "meals",
    title: "Food Allergies",
    body_md:
      "For any food allergy we need a **Nutrition/Allergy Form signed by your child's doctor** on file. Our kitchen prepares medical special meals (not lifestyle preferences). If you're working out the specifics for your child's allergy, a staff member will walk you through it.",
    structured: {
      allergy_form_required: true,
      form: "Nutrition/Allergy Form signed by doctor",
      special_meals: "medical only, not lifestyle",
    },
    keywords: ["allergy", "allergic", "allergies", "special meal", "dietary", "form", "nut", "dairy"],
    source: "Family Handbook p.18",
  },
  {
    id: "meals.infants",
    intent: "meals",
    title: "Infant Feeding",
    body_md:
      "For our infants we provide **iron-fortified formula**. If you send breast milk, please have it **labeled and dated**, and we'll follow your feeding schedule.",
    structured: {
      formula_provided: true,
      formula_type: "iron-fortified",
      breast_milk: "labeled and dated",
    },
    keywords: ["infant", "baby", "formula", "breast milk", "bottle", "feeding"],
    source: "Family Handbook p.19",
  },

  // ─────────────────────────── TOURS & ENROLLMENT ───────────────────────────
  {
    id: "tours.scheduling",
    intent: "tours",
    title: "Scheduling a Tour",
    body_md:
      "We'd love to show you around! You can **request a tour right here** — just share your name, the best way to reach you, and a couple of times that work. Enrollment usually goes: an inquiry and tour, then paperwork, then a short orientation before your child's first day.",
    structured: {
      steps: ["inquiry_and_tour", "paperwork", "orientation"],
      request_channels: ["phone", "in-app tour request"],
      info_needed: ["contact", "preferred_time"],
    },
    keywords: ["tour", "visit", "see the center", "schedule", "come by", "look around", "interested"],
    source: "Family Handbook p.2",
  },
  {
    id: "enroll.requirements",
    intent: "tours",
    title: "Enrollment Requirements",
    body_md:
      "To enroll we'll need a few documents: your child's **birth certificate**, up-to-date **immunization records**, **emergency contacts**, and a **photo ID** for anyone authorized to pick up. We'll hand you a simple checklist at your tour.",
    structured: {
      required_docs: [
        "birth certificate",
        "immunization records",
        "emergency contacts",
        "photo ID",
      ],
    },
    keywords: ["enroll", "enrollment", "documents", "paperwork", "birth certificate", "requirements", "sign up", "register"],
    source: "Family Handbook p.2",
  },
  {
    id: "enroll.age_eligibility",
    intent: "tours",
    title: "Age Groups & Eligibility",
    body_md:
      "We serve children from **6 weeks to 5 years** across four groups: Infant (6 wks–12 mo), Toddler (1–2 yr), Preschool (3–4 yr), and Pre-K (4–5 yr). For our Pre-K group a child should be **4 by September 1**.",
    structured: {
      cutoff_date: "Sept 1",
      bands: {
        infant: "6 weeks-12 months",
        toddler: "1-2 years",
        preschool: "3-4 years",
        prek: "4-5 years",
      },
    },
    keywords: ["age", "eligible", "how old", "group", "classroom", "cutoff", "prek", "infant", "toddler"],
    source: "Family Handbook p.2",
  },
  {
    id: "visits.open_door",
    intent: "tours",
    title: "Open-Door Visits",
    body_md:
      "Enrolled families are welcome to visit any time during the day — just **sign in** at the front desk. Most parents pop in for a 10-minute classroom visit. Our door is genuinely open.",
    structured: {
      visits_welcome: true,
      sign_in_required: true,
      typical_visit_minutes: 10,
    },
    keywords: ["visit", "drop in", "open door", "sign in", "see my child", "come in", "anytime"],
    source: "Family Handbook p.3",
  },
];

require("dotenv").config();
const express = require("express");
const fetch = require("node-fetch");
const cors = require("cors");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.GOOGLE_MAPS_API_KEY;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ── Config ─────────────────────────────────────────────────────────────────
app.get("/api/config", (req, res) => {
  if (!API_KEY || API_KEY === "YOUR_GOOGLE_MAPS_API_KEY_HERE")
    return res.status(500).json({ error: "Google Maps API key not configured in .env" });
  res.json({ apiKey: API_KEY });
});

// ── Nearby Laundry Search (Places API New v1) ──────────────────────────────
app.get("/api/nearby", async (req, res) => {
  const { lat, lng, radius = 500 } = req.query;
  if (!lat || !lng) return res.status(400).json({ error: "lat and lng are required" });
  if (!API_KEY || API_KEY === "YOUR_GOOGLE_MAPS_API_KEY_HERE")
    return res.status(500).json({ error: "Google Maps API key not configured" });

  const FIELD_MASK =
    "places.id,places.displayName,places.formattedAddress,places.location," +
    "places.rating,places.userRatingCount,places.currentOpeningHours," +
    "places.regularOpeningHours,places.photos,places.nationalPhoneNumber," +
    "places.websiteUri,places.priceLevel,places.businessStatus";

  const allResults = new Map();

  try {
    // 1) Nearby Search by place type
    const nearbyBody = {
      includedTypes: ["laundry", "dry_cleaning_laundry"],
      maxResultCount: 20,
      locationRestriction: {
        circle: {
          center: { latitude: parseFloat(lat), longitude: parseFloat(lng) },
          radius: parseFloat(radius),
        },
      },
    };

    const nearbyRes = await fetch("https://places.googleapis.com/v1/places:searchNearby", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": API_KEY,
        "X-Goog-FieldMask": FIELD_MASK,
      },
      body: JSON.stringify(nearbyBody),
    });
    const nearbyData = await nearbyRes.json();
    console.log("🔍 Nearby search status:", nearbyRes.status);
    if (nearbyData.error) console.error("Nearby error:", JSON.stringify(nearbyData.error));
    if (nearbyData.places)
      nearbyData.places.forEach((p) => !allResults.has(p.id) && allResults.set(p.id, p));

    // 2) Text Search for broader + Khmer results
    const textQueries = ["laundry shop", "laundromat", "dry cleaning", "បោកអ៊ុត", "បោកខោអាវ"];
    for (const q of textQueries) {
      const textBody = {
        textQuery: q,
        locationBias: {
          circle: {
            center: { latitude: parseFloat(lat), longitude: parseFloat(lng) },
            radius: parseFloat(radius),
          },
        },
        maxResultCount: 20,
      };

      const textRes = await fetch("https://places.googleapis.com/v1/places:searchText", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": API_KEY,
          "X-Goog-FieldMask": FIELD_MASK,
        },
        body: JSON.stringify(textBody),
      });
      const textData = await textRes.json();
      if (textData.error)
        console.error(`Text search error for "${q}":`, JSON.stringify(textData.error));
      if (textData.places)
        textData.places.forEach((p) => !allResults.has(p.id) && allResults.set(p.id, p));
    }

    const results = Array.from(allResults.values())
      .map(normalizePlace)
      .sort((a, b) => {
        const dA = getDistance(lat, lng, a.geometry.location.lat, a.geometry.location.lng);
        const dB = getDistance(lat, lng, b.geometry.location.lat, b.geometry.location.lng);
        return dA - dB;
      });

    console.log(`✅ Returning ${results.length} laundry results`);
    res.json({ results, count: results.length });
  } catch (err) {
    console.error("Nearby search error:", err);
    res.status(500).json({ error: "Failed to fetch nearby places: " + err.message });
  }
});

// ── Place Details (Places API New v1) ──────────────────────────────────────
app.get("/api/place/:placeId", async (req, res) => {
  let { placeId } = req.params;
  if (!API_KEY || API_KEY === "YOUR_GOOGLE_MAPS_API_KEY_HERE")
    return res.status(500).json({ error: "Google Maps API key not configured" });

  const resourceName = placeId.startsWith("places/") ? placeId : `places/${placeId}`;

  try {
    const url = `https://places.googleapis.com/v1/${resourceName}`;
    const response = await fetch(url, {
      headers: {
        "X-Goog-Api-Key": API_KEY,
        "X-Goog-FieldMask":
          "id,displayName,formattedAddress,nationalPhoneNumber,regularOpeningHours," +
          "currentOpeningHours,rating,userRatingCount,photos,websiteUri,location," +
          "reviews,priceLevel,businessStatus",
      },
    });
    const p = await response.json();
    if (p.error) {
      console.error("Place details error:", JSON.stringify(p.error));
      return res.status(400).json({ error: p.error.message });
    }

    const priceLevels = {
      PRICE_LEVEL_FREE: 0,
      PRICE_LEVEL_INEXPENSIVE: 1,
      PRICE_LEVEL_MODERATE: 2,
      PRICE_LEVEL_EXPENSIVE: 3,
      PRICE_LEVEL_VERY_EXPENSIVE: 4,
    };

    const oh = p.currentOpeningHours || p.regularOpeningHours;
    const result = {
      place_id: p.id,
      name: p.displayName?.text || "Unknown",
      formatted_address: p.formattedAddress || "",
      formatted_phone_number: p.nationalPhoneNumber || null,
      website: p.websiteUri || null,
      rating: p.rating || null,
      user_ratings_total: p.userRatingCount || 0,
      price_level: priceLevels[p.priceLevel] ?? null,
      geometry: { location: { lat: p.location?.latitude, lng: p.location?.longitude } },
      opening_hours: oh
        ? { open_now: oh.openNow ?? null, weekday_text: oh.weekdayDescriptions || [] }
        : null,
      photos: (p.photos || [])
        .slice(0, 6)
        .map((ph) => ({ photo_reference: ph.name, new_api: true })),
      reviews: (p.reviews || []).slice(0, 5).map((r) => ({
        author_name: r.authorAttribution?.displayName || "Anonymous",
        rating: r.rating || 0,
        text: r.text?.text || "",
      })),
    };

    res.json({ result });
  } catch (err) {
    console.error("Place details error:", err);
    res.status(500).json({ error: "Failed to fetch place details" });
  }
});

// ── Reverse Geocode ─────────────────────────────────────────────────────────
app.get("/api/geocode", async (req, res) => {
  const { lat, lng } = req.query;
  if (!lat || !lng) return res.status(400).json({ error: "lat and lng required" });
  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${API_KEY}`;
    const response = await fetch(url);
    const data = await response.json();
    const result = data.results && data.results[0];
    res.json({
      address: result ? result.formatted_address : "Unknown location",
      components: result ? result.address_components : [],
    });
  } catch (err) {
    res.status(500).json({ error: "Geocoding failed" });
  }
});

// ── Photo (Places API New v1) ───────────────────────────────────────────────
app.get("/api/photo", async (req, res) => {
  const { ref, maxwidth = 600 } = req.query;
  if (!ref) return res.status(400).json({ error: "ref required" });

  try {
    // ref = "places/ChIJ.../photos/AXC..."
    const url = `https://places.googleapis.com/v1/${ref}/media?maxWidthPx=${maxwidth}&key=${API_KEY}&skipHttpRedirect=true`;
    const response = await fetch(url);
    const json = await response.json();

    if (json.photoUri) {
      const imgRes = await fetch(json.photoUri);
      const buffer = await imgRes.buffer();
      res.set("Content-Type", imgRes.headers.get("content-type") || "image/jpeg");
      res.set("Cache-Control", "public, max-age=86400");
      return res.send(buffer);
    }
    res.status(404).json({ error: "No photo URI returned" });
  } catch (err) {
    console.error("Photo error:", err);
    res.status(500).json({ error: "Failed to fetch photo" });
  }
});

// ── Helpers ─────────────────────────────────────────────────────────────────
function normalizePlace(p) {
  const oh = p.currentOpeningHours || p.regularOpeningHours;
  const priceLevels = {
    PRICE_LEVEL_FREE: 0,
    PRICE_LEVEL_INEXPENSIVE: 1,
    PRICE_LEVEL_MODERATE: 2,
    PRICE_LEVEL_EXPENSIVE: 3,
    PRICE_LEVEL_VERY_EXPENSIVE: 4,
  };
  return {
    place_id: p.id,
    name: p.displayName?.text || p.displayName || "Unknown",
    vicinity: p.formattedAddress || "",
    geometry: {
      location: { lat: p.location?.latitude, lng: p.location?.longitude },
    },
    rating: p.rating || null,
    user_ratings_total: p.userRatingCount || 0,
    opening_hours: oh
      ? { open_now: oh.openNow ?? null, weekday_text: oh.weekdayDescriptions || [] }
      : null,
    photos: (p.photos || [])
      .slice(0, 3)
      .map((ph) => ({ photo_reference: ph.name, new_api: true })),
    business_status: p.businessStatus || "OPERATIONAL",
    price_level: priceLevels[p.priceLevel] ?? null,
  };
}

function getDistance(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

app.listen(PORT, () => {
  console.log(`\n🧺 Laundry Finder running at http://localhost:${PORT}`);
  console.log(
    `🔑 API Key: ${
      API_KEY && API_KEY !== "YOUR_GOOGLE_MAPS_API_KEY_HERE" ? "✅ Loaded" : "❌ Missing – edit .env file"
    }\n`
  );
});

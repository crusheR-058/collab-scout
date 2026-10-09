// Qloo's heatmap returns map cells as coordinates with no place name. Name each
// cell from an offline city list instead of letting the model guess one.
import cities from "all-the-cities";

const MIN_POPULATION = 100_000;
const KM_PER_DEGREE = 111;

const large = cities
  .filter((city) => city.population >= MIN_POPULATION)
  .map((city) => ({
    name: city.name,
    country: city.country,
    longitude: city.loc.coordinates[0],
    latitude: city.loc.coordinates[1],
  }));

// Flat-earth distance is accurate enough to pick a nearest city.
const distanceKm = (city, latitude, longitude) =>
  Math.hypot(
    (city.latitude - latitude) * KM_PER_DEGREE,
    (city.longitude - longitude) * KM_PER_DEGREE * Math.cos((latitude * Math.PI) / 180),
  );

export const nearestCity = (latitude, longitude) => {
  let best;
  let bestKm = Infinity;
  for (const city of large) {
    const km = distanceKm(city, latitude, longitude);
    if (km < bestKm) {
      best = city;
      bestKm = km;
    }
  }
  return { name: best.name, country: best.country, distance_km: Math.round(bestKm) };
};

export const nameHeatmapCells = (envelope) => {
  if (!Array.isArray(envelope.results)) return envelope;
  return {
    ...envelope,
    results: envelope.results.map((cell) =>
      cell.location?.latitude === undefined
        ? cell
        : { ...cell, nearest_city: nearestCity(cell.location.latitude, cell.location.longitude) },
    ),
  };
};

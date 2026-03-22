"use strict";
/**
 * Generates locations_state.json — replaces zips_state.json.
 * Each entry is a Gelbe Seiten location slug (city or city+district).
 * Major cities use district-level slugs for better coverage (50 results each).
 *
 * Usage:
 *   node generateLocations.js
 */

const fs   = require("fs");
const path = require("path");

const STATE_FILE = path.join(__dirname, "locations_state.json");

const LOCATIONS = [
  // ── BERLIN (12 Bezirke) ──────────────────────────────────────────────────
  { city: "Berlin", slug: "berlin bezirk mitte" },
  { city: "Berlin", slug: "berlin bezirk friedrichshain-kreuzberg" },
  { city: "Berlin", slug: "berlin bezirk pankow" },
  { city: "Berlin", slug: "berlin bezirk charlottenburg-wilmersdorf" },
  { city: "Berlin", slug: "berlin bezirk spandau" },
  { city: "Berlin", slug: "berlin bezirk steglitz-zehlendorf" },
  { city: "Berlin", slug: "berlin bezirk tempelhof-schöneberg" },
  { city: "Berlin", slug: "berlin bezirk neukölln" },
  { city: "Berlin", slug: "berlin bezirk treptow-köpenick" },
  { city: "Berlin", slug: "berlin bezirk marzahn-hellersdorf" },
  { city: "Berlin", slug: "berlin bezirk lichtenberg" },
  { city: "Berlin", slug: "berlin bezirk reinickendorf" },

  // ── HAMBURG (7 Bezirke) ──────────────────────────────────────────────────
  { city: "Hamburg", slug: "hamburg bezirk hamburg-mitte" },
  { city: "Hamburg", slug: "hamburg bezirk altona" },
  { city: "Hamburg", slug: "hamburg bezirk eimsbüttel" },
  { city: "Hamburg", slug: "hamburg bezirk hamburg-nord" },
  { city: "Hamburg", slug: "hamburg bezirk wandsbek" },
  { city: "Hamburg", slug: "hamburg bezirk bergedorf" },
  { city: "Hamburg", slug: "hamburg bezirk harburg" },

  // ── MÜNCHEN ──────────────────────────────────────────────────────────────
  { city: "München", slug: "münchen" },

  // ── KÖLN ─────────────────────────────────────────────────────────────────
  { city: "Köln", slug: "köln" },
  { city: "Köln", slug: "köln innenstadt" },

  // ── FRANKFURT ────────────────────────────────────────────────────────────
  { city: "Frankfurt", slug: "frankfurt am main" },

  // ── STUTTGART ────────────────────────────────────────────────────────────
  { city: "Stuttgart", slug: "stuttgart" },

  // ── DÜSSELDORF ───────────────────────────────────────────────────────────
  { city: "Düsseldorf", slug: "düsseldorf" },

  // ── DORTMUND ─────────────────────────────────────────────────────────────
  { city: "Dortmund", slug: "dortmund" },

  // ── ESSEN ────────────────────────────────────────────────────────────────
  { city: "Essen", slug: "essen" },

  // ── LEIPZIG ──────────────────────────────────────────────────────────────
  { city: "Leipzig", slug: "leipzig" },

  // ── BREMEN ───────────────────────────────────────────────────────────────
  { city: "Bremen", slug: "bremen" },

  // ── DRESDEN ──────────────────────────────────────────────────────────────
  { city: "Dresden", slug: "dresden" },

  // ── HANNOVER ─────────────────────────────────────────────────────────────
  { city: "Hannover", slug: "hannover" },

  // ── NÜRNBERG ─────────────────────────────────────────────────────────────
  { city: "Nürnberg", slug: "nürnberg" },

  // ── BONN ─────────────────────────────────────────────────────────────────
  { city: "Bonn", slug: "bonn" },

  // ── MÜNSTER ──────────────────────────────────────────────────────────────
  { city: "Münster", slug: "münster" },

  // ── KARLSRUHE ────────────────────────────────────────────────────────────
  { city: "Karlsruhe", slug: "karlsruhe" },

  // ── WIESBADEN ────────────────────────────────────────────────────────────
  { city: "Wiesbaden", slug: "wiesbaden" },

  // ── AUGSBURG ─────────────────────────────────────────────────────────────
  { city: "Augsburg", slug: "augsburg" },

  // ── AACHEN ───────────────────────────────────────────────────────────────
  { city: "Aachen", slug: "aachen" },

  // ── CHEMNITZ ─────────────────────────────────────────────────────────────
  { city: "Chemnitz", slug: "chemnitz" },

  // ── KIEL ─────────────────────────────────────────────────────────────────
  { city: "Kiel", slug: "kiel" },

  // ── HALLE ────────────────────────────────────────────────────────────────
  { city: "Halle", slug: "halle (saale)" },

  // ── MAGDEBURG ────────────────────────────────────────────────────────────
  { city: "Magdeburg", slug: "magdeburg" },

  // ── FREIBURG ─────────────────────────────────────────────────────────────
  { city: "Freiburg", slug: "freiburg im breisgau" },

  // ── KREFELD ──────────────────────────────────────────────────────────────
  { city: "Krefeld", slug: "krefeld" },

  // ── LÜBECK ───────────────────────────────────────────────────────────────
  { city: "Lübeck", slug: "lübeck" },

  // ── OBERHAUSEN ───────────────────────────────────────────────────────────
  { city: "Oberhausen", slug: "oberhausen" },

  // ── ERFURT ───────────────────────────────────────────────────────────────
  { city: "Erfurt", slug: "erfurt" },

  // ── ROSTOCK ──────────────────────────────────────────────────────────────
  { city: "Rostock", slug: "rostock" },

  // ── MAINZ ────────────────────────────────────────────────────────────────
  { city: "Mainz", slug: "mainz" },

  // ── KASSEL ───────────────────────────────────────────────────────────────
  { city: "Kassel", slug: "kassel" },

  // ── HAGEN ────────────────────────────────────────────────────────────────
  { city: "Hagen", slug: "hagen" },

  // ── SAARBRÜCKEN ──────────────────────────────────────────────────────────
  { city: "Saarbrücken", slug: "saarbrücken" },

  // ── MÖNCHENGLADBACH ──────────────────────────────────────────────────────
  { city: "Mönchengladbach", slug: "mönchengladbach" },

  // ── BRAUNSCHWEIG ─────────────────────────────────────────────────────────
  { city: "Braunschweig", slug: "braunschweig" },

  // ── KOBLENZ ──────────────────────────────────────────────────────────────
  { city: "Koblenz", slug: "koblenz" },

  // ── TRIER ────────────────────────────────────────────────────────────────
  { city: "Trier", slug: "trier" },

  // ── HEIDELBERG ───────────────────────────────────────────────────────────
  { city: "Heidelberg", slug: "heidelberg" },

  // ── REGENSBURG ───────────────────────────────────────────────────────────
  { city: "Regensburg", slug: "regensburg" },

  // ── INGOLSTADT ───────────────────────────────────────────────────────────
  { city: "Ingolstadt", slug: "ingolstadt" },

  // ── ULM ──────────────────────────────────────────────────────────────────
  { city: "Ulm", slug: "ulm" },

  // ── WÜRZBURG ─────────────────────────────────────────────────────────────
  { city: "Würzburg", slug: "würzburg" },

  // ── WOLFSBURG ────────────────────────────────────────────────────────────
  { city: "Wolfsburg", slug: "wolfsburg" },

  // ── MANNHEIM ─────────────────────────────────────────────────────────────
  { city: "Mannheim", slug: "mannheim" },

  // ── DARMSTADT ────────────────────────────────────────────────────────────
  { city: "Darmstadt", slug: "darmstadt" },

  // ── POTSDAM ──────────────────────────────────────────────────────────────
  { city: "Potsdam", slug: "potsdam" },

  // ── BOCHUM ───────────────────────────────────────────────────────────────
  { city: "Bochum", slug: "bochum" },

  // ── WUPPERTAL ────────────────────────────────────────────────────────────
  { city: "Wuppertal", slug: "wuppertal" },

  // ── BIELEFELD ────────────────────────────────────────────────────────────
  { city: "Bielefeld", slug: "bielefeld" },

  // ── GELSENKIRCHEN ────────────────────────────────────────────────────────
  { city: "Gelsenkirchen", slug: "gelsenkirchen" },

  // ── MÜLHEIM AN DER RUHR ──────────────────────────────────────────────────
  { city: "Mülheim", slug: "mülheim an der ruhr" },

  // ── PADERBORN ────────────────────────────────────────────────────────────
  { city: "Paderborn", slug: "paderborn" },

  // ── DUISBURG ─────────────────────────────────────────────────────────────
  { city: "Duisburg", slug: "duisburg" },

  // ── HILDESHEIM ───────────────────────────────────────────────────────────
  { city: "Hildesheim", slug: "hildesheim" },

  // ── OSNABRÜCK ────────────────────────────────────────────────────────────
  { city: "Osnabrück", slug: "osnabrück" },

  // ── SOLINGEN ─────────────────────────────────────────────────────────────
  { city: "Solingen", slug: "solingen" },

  // ── LUDWIGSHAFEN ─────────────────────────────────────────────────────────
  { city: "Ludwigshafen", slug: "ludwigshafen am rhein" },

  // ── OLDENBURG ────────────────────────────────────────────────────────────
  { city: "Oldenburg", slug: "oldenburg" },

  // ── NEUSS ────────────────────────────────────────────────────────────────
  { city: "Neuss", slug: "neuss" },

  // ── FÜRTH ────────────────────────────────────────────────────────────────
  { city: "Fürth", slug: "fürth" },

  // ── ERLANGEN ─────────────────────────────────────────────────────────────
  { city: "Erlangen", slug: "erlangen" },

  // ── BAYREUTH ─────────────────────────────────────────────────────────────
  { city: "Bayreuth", slug: "bayreuth" },

  // ── SIEGEN ───────────────────────────────────────────────────────────────
  { city: "Siegen", slug: "siegen" },

  // ── COTTBUS ──────────────────────────────────────────────────────────────
  { city: "Cottbus", slug: "cottbus" },

  // ── SCHWERIN ─────────────────────────────────────────────────────────────
  { city: "Schwerin", slug: "schwerin" },

  // ── GÖTTINGEN ────────────────────────────────────────────────────────────
  { city: "Göttingen", slug: "göttingen" },

  // ── RECKLINGHAUSEN ───────────────────────────────────────────────────────
  { city: "Recklinghausen", slug: "recklinghausen" },

  // ── BOTTROP ──────────────────────────────────────────────────────────────
  { city: "Bottrop", slug: "bottrop" },

  // ── BREMERHAVEN ──────────────────────────────────────────────────────────
  { city: "Bremerhaven", slug: "bremerhaven" },

  // ── HEILBRONN ────────────────────────────────────────────────────────────
  { city: "Heilbronn", slug: "heilbronn" },

  // ── PFORZHEIM ────────────────────────────────────────────────────────────
  { city: "Pforzheim", slug: "pforzheim" },

  // ── OFFENBACH ────────────────────────────────────────────────────────────
  { city: "Offenbach", slug: "offenbach am main" },

  // ── REMSCHEID ────────────────────────────────────────────────────────────
  { city: "Remscheid", slug: "remscheid" },
];

function main() {
  // Preserve existing scraped state if file exists
  let existing = {};
  if (fs.existsSync(STATE_FILE)) {
    try {
      const prev = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
      for (const e of prev) {
        if (e.scraped) existing[e.slug] = true;
      }
      console.log(`Preserving ${Object.keys(existing).length} already-scraped entries`);
    } catch {}
  }

  const state = LOCATIONS.map(loc => ({
    city:    loc.city,
    slug:    loc.slug,
    scraped: existing[loc.slug] || false,
  }));

  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));

  const total   = state.length;
  const done    = state.filter(l => l.scraped).length;
  const pending = total - done;

  console.log(`\n✓ locations_state.json generated`);
  console.log(`  Total locations : ${total}`);
  console.log(`  Already scraped : ${done}`);
  console.log(`  Pending         : ${pending}`);
  console.log(`  Est. leads      : ${pending * 30}–${pending * 50} (30–50 per location)\n`);
}

main();

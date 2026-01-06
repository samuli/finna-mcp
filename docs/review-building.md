# Building-filtterin ongelma - Tarkat kyselyt ja tulokset

## Kysely 1: Building-filtteri filters.include-parametrissa (EI TOIMI)

**Kysely:**
```javascript
search_records({
  fields_preset: "full",
  filters: {
    include: {
      format: ["0/Book/"],
      building: ["0/SATAKIRJASTOT/"]
    }
  },
  limit: 50,
  lng: "fi",
  sort: "newest"
})
```

**Tulos:**
```
search_records: 0 hits 0 returned
```

**Odotus:** Pitäisi palauttaa tuhansia kirjoja Satakirjastoista.

---

## Kysely 2: Sama ilman building-filteriä (TOIMII)

**Kysely:**
```javascript
search_records({
  fields_preset: "full",
  filters: {
    include: {
      format: ["0/Book/"]
    }
  },
  limit: 50,
  lng: "fi",
  lookfor: "2026",
  sort: "newest"
})
```

**Tulos:**
```
search_records: 8776 hits 50 returned
```

**Johtopäätös:** Ilman building-filteriä tuloksia löytyy. Building-filtteri tappaa haun.

---

## Kysely 3: Vuosi 2026 + Satakirjastot building-filtterillä (EI TOIMI)

**Kysely:**
```javascript
search_records({
  fields_preset: "full",
  filters: {
    include: {
      format: ["0/Book/"],
      building: ["0/SATAKIRJASTOT/"]
    }
  },
  limit: 50,
  lng: "fi",
  lookfor: "2026",
  sort: "year_newest"
})
```

**Tulos:**
```
search_records: 0 hits 0 returned
```

**Odotus:** Pitäisi palauttaa 2026 julkaistuja kirjoja Satakirjastoista (jos niitä on).

---

## Kysely 4: Sama haku facetFilters-parametrilla (TOIMII!)

**Kysely:**
```javascript
search_records({
  facetFilters: ["building:\"0/SATAKIRJASTOT/\""],
  fields_preset: "media",
  filters: {
    include: {
      format: ["0/Book/"]
    }
  },
  limit: 20,
  lng: "fi",
  lookfor: "2025",
  sort: "newest"
})
```

**Tulos:**
```
search_records: 74018 hits 20 returned
```

**Johtopäätös:** facetFilters-parametri TOIMII building-rajaukseen, mutta filters.include.building EI TOIMI.

---

## Kysely 5: Pelkkä building-filtteri ilman muita filttereitä (EI TOIMI)

**Kysely:**
```javascript
search_records({
  fields_preset: "full",
  filters: {
    include: {
      building: ["0/SATAKIRJASTOT/"]
    }
  },
  limit: 50,
  lng: "fi",
  sort: "newest"
})
```

**Tulos:**
```
search_records: 0 hits 0 returned
```

**Odotus:** Pitäisi palauttaa kaikkea Satakirjastoista (kirjoja, äänilevyjä, videoita, jne.)

---

## Yhteenveto

### Mikä EI toimi:
```javascript
filters: {
  include: {
    building: ["0/SATAKIRJASTOT/"]
  }
}
```
→ Palauttaa aina 0 tulosta

### Mikä TOIMII (väliaikainen kiertotie):
```javascript
facetFilters: ["building:\"0/SATAKIRJASTOT/\""]
```
→ Palauttaa tuloksia oikein

### Vertailupiste (format-filtteri toimii):
```javascript
filters: {
  include: {
    format: ["0/Book/"]
  }
}
```
→ Toimii täydellisesti

---

## Diagnoosi

**Ongelma:** `filters.include.building` ei rajaa tuloksia lainkaan. Se näyttää joko:
1. Aiheuttavan virheen taustalla (joka palauttaa 0 tulosta)
2. Ohittavan filtterin kokonaan mutta sitten jostain syystä palauttavan 0 tulosta

**Kiertotapa:** Käyttäjät voivat käyttää `facetFilters`-parametria:
```javascript
facetFilters: ["building:\"0/ORGANISAATIO/\""]
```

**Pitkän aikavälin korjaus:** Korjaa `filters.include.building` toimimaan samalla logiikalla kuin `filters.include.format`.

---

## Testausohje korjauksen jälkeen

```javascript
// Testi 1: Pelkkä building-filtteri
const result1 = await search_records({
  filters: {
    include: {
      building: ["0/SATAKIRJASTOT/"]
    }
  },
  limit: 1
});
console.assert(result1.resultCount > 0, "Building-filtteri ei tuota tuloksia!");

// Testi 2: Building + format yhdessä
const result2 = await search_records({
  filters: {
    include: {
      format: ["0/Book/"],
      building: ["0/Helmet/"]
    }
  },
  limit: 1
});
console.assert(result2.resultCount > 0, "Building + format -yhdistelmä ei toimi!");

// Testi 3: Vertaa että samat tulokset facetFilters vs filters.include
const withFacetFilter = await search_records({
  facetFilters: ["building:\"0/Helmet/\""],
  limit: 0
});

const withIncludeFilter = await search_records({
  filters: {
    include: {
      building: ["0/Helmet/"]
    }
  },
  limit: 0
});

console.assert(
  withFacetFilter.resultCount === withIncludeFilter.resultCount,
  "facetFilters ja filters.include.building antavat eri tulokset!"
);
```


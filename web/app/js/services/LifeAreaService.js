/**
 * LifeAreaService.js — Promesas y versículos por área de vida.
 * En GitHub Pages usa el catálogo local. En el contenedor, el API
 * puede enriquecer los textos si está disponible.
 */

import { config } from "../config.js";
import { LIFE_AREAS, detectLifeArea, toPanelAreas } from "../data/lifeAreasCatalog.js";

function isGitHubPages() {
  return (
    typeof window !== "undefined" &&
    /github\.io$/i.test(window.location?.hostname || "")
  );
}

export class LifeAreaService {
  #cache = null;

  async loadAll() {
    if (this.#cache) return this.#cache;
    this.#cache = toPanelAreas(LIFE_AREAS);

    if (isGitHubPages() && !config.lifeAreasApiUrl) return this.#cache;

    try {
      const url = new URL(config.lifeAreasApiUrl || "/api/life-areas", window.location.origin);
      const response = await fetch(url.toString(), {
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
      if (!response.ok) return this.#cache;

      const data = await response.json();
      if (Array.isArray(data?.areas) && data.areas.length) {
        this.#cache = data.areas;
      }
    } catch (error) {
      console.warn("[LifeAreaService]", error);
    }
    return this.#cache;
  }

  async matchQuestion(question) {
    const q = String(question ?? "").trim();
    if (!q) return null;

    const areas = this.#cache || toPanelAreas(LIFE_AREAS);
    const local = detectLifeArea(q);
    if (local) return areas.find((a) => a.id === local.id) || local;

    if (isGitHubPages() && !config.lifeAreasApiUrl) return null;

    try {
      const url = new URL(config.lifeAreasApiUrl || "/api/life-areas", window.location.origin);
      url.searchParams.set("q", q);
      const response = await fetch(url.toString(), {
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
      if (!response.ok) return null;
      const data = await response.json();
      return data?.match ?? null;
    } catch {
      return null;
    }
  }
}

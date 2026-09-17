/**
 * LifeAreaService.js — Promesas y versículos por área de vida (TLA).
 */

import { config } from "../config.js";

export class LifeAreaService {
  #cache = null;

  async loadAll() {
    if (this.#cache) return this.#cache;

    try {
      const url = new URL(config.lifeAreasApiUrl, window.location.origin);
      const response = await fetch(url.toString(), {
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const data = await response.json();
      this.#cache = Array.isArray(data?.areas) ? data.areas : [];
      return this.#cache;
    } catch (error) {
      console.warn("[LifeAreaService]", error);
      return [];
    }
  }

  async matchQuestion(question) {
    const q = String(question ?? "").trim();
    if (!q) return null;

    try {
      const url = new URL(config.lifeAreasApiUrl, window.location.origin);
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

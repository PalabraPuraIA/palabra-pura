/**
 * main.js — Punto de entrada.
 *
 * Su único trabajo: crear los módulos y conectarlos entre sí.
 * Toda la lógica concreta vive en su propio módulo.
 */

import { config } from "./config.js";
import { qs } from "./utils/dom.js";
import {
  applyBibleVersionEverywhere,
  setPreferredBibleVersion,
} from "./utils/bibleVersion.js";

import { ChatService } from "./services/ChatService.js?v=rate-life-1";
import { ArticleService } from "./services/ArticleService.js";
import { ChatView } from "./ui/ChatView.js?v=rate-life-1";
import { Composer } from "./ui/Composer.js";
import { ExampleChips } from "./ui/ExampleChips.js";
import { ConnectModal } from "./ui/ConnectModal.js";
import { VideoPlayer } from "./ui/VideoPlayer.js";
import { ArticlesPanel } from "./ui/ArticlesPanel.js";
import { LifeAreasPanel } from "./ui/LifeAreasPanel.js?v=rate-life-1";
import { LifeAreaService } from "./services/LifeAreaService.js?v=rate-life-1";
import { AnalyticsService } from "./services/AnalyticsService.js?v=rate-life-1";

class App {
  #service = new ChatService();
  #articles = new ArticleService();
  #analytics = new AnalyticsService();
  #view;
  #player;
  #articlesPanel;
  #lifeAreasPanel;
  #lifeAreas = new LifeAreaService();
  #chips;
  #busy = false;

  init() {
    this.#view = new ChatView(qs("[data-messages]"));
    this.#player = new VideoPlayer(qs("[data-player]"));
    this.#player.clear();
    this.#articlesPanel = new ArticlesPanel(qs("[data-articles]"));
    this.#articlesPanel.clear();
    this.#lifeAreasPanel = new LifeAreasPanel(qs("[data-life]"), (question) =>
      this.#handleQuestion(question),
    );
    this.#lifeAreasPanel.showLoading();
    this.#lifeAreas.loadAll().then((areas) => this.#lifeAreasPanel.render(areas));

    this.#chips = new ExampleChips(
      qs("[data-examples]"),
      config.exampleQuestions,
      (question) => this.#handleQuestion(question),
    );

    new Composer(
      qs("[data-composer]"),
      (question) => this.#handleQuestion(question),
    );

    new ConnectModal(qs("[data-modal]"), qs("[data-connect-open]"));

    // Reproducir video, elegir sugerencia o cambiar versión bíblica
    qs("[data-messages]").addEventListener("click", (event) => {
      const toggle = event.target.closest("[data-suggest-toggle]");
      if (toggle) {
        const box = toggle.closest("[data-suggest-box]");
        const panel = box?.querySelector(".msg__suggest-panel");
        if (panel) {
          const open = panel.hasAttribute("hidden");
          if (open) panel.removeAttribute("hidden");
          else panel.setAttribute("hidden", "");
          toggle.setAttribute("aria-expanded", open ? "true" : "false");
        }
        return;
      }

      const rateBtn = event.target.closest("[data-rate]");
      if (rateBtn) {
        this.#handleRating(rateBtn);
        return;
      }

      const go = event.target.closest("[data-suggest-go]");
      if (go) {
        const box = go.closest("[data-suggest-box]");
        const select = box?.querySelector("[data-suggest-select]");
        if (!select || select.value === "") return;
        this.#handleSuggestionPick(select);
        return;
      }

      const tip = event.target.closest("[data-suggest]");
      if (tip?.dataset.suggest) {
        this.#handleQuestion(tip.dataset.suggest);
        return;
      }

      const versionTab = event.target.closest("[data-bible-version]");
      if (versionTab?.dataset.bibleVersion) {
        const next = setPreferredBibleVersion(versionTab.dataset.bibleVersion);
        applyBibleVersionEverywhere(next);
        return;
      }

      const btn = event.target.closest("[data-play-here]");
      if (!btn) return;
      this.#player.load(
        {
          youtube_id: btn.dataset.youtubeId,
          start_second: Number(btn.dataset.startSecond || 0),
          title: btn.dataset.title || undefined,
          episode: btn.dataset.episode ? Number(btn.dataset.episode) : undefined,
        },
        { autoplay: false },
      );
    });

    qs("[data-messages]").addEventListener("change", (event) => {
      const select = event.target.closest("[data-suggest-select]");
      if (!select) return;
      const go = select.closest("[data-suggest-box]")?.querySelector("[data-suggest-go]");
      if (go) go.disabled = select.value === "";
    });

    this.#view.addBotMessage({ answer: config.welcomeMessage });
  }

  /** Al elegir una opción del desplegable: muestra el contenido o pregunta de nuevo. */
  #handleSuggestionPick(select) {
    let items = [];
    try {
      items = JSON.parse(decodeURIComponent(select.dataset.suggestItems || "[]"));
    } catch {
      items = [];
    }
    const item = items[Number(select.value)];
    if (!item) return;

    if (item.video?.youtube_id || item.excerpt) {
      const label = item.label || item.title || "este tema";
      this.#view.addUserMessage(item.ask || label);
      this.#view.addBotMessage({
        answer:
          item.answer ||
          `Aquí tienes una enseñanza relacionada sobre «${label}» que puede interesarte:`,
        excerpt: item.excerpt || item.preview || undefined,
        video: item.video || undefined,
        source: item.source || (item.video ? "video" : undefined),
      });
      if (item.video?.youtube_id) {
        this.#player.load(item.video, { autoplay: false });
      }
      return;
    }

    this.#handleQuestion(item.ask || item.label);
  }

  async #handleRating(button) {
    const box = button.closest("[data-rate-box]");
    const id = box?.dataset.interactionId;
    const vote = button.dataset.rate;
    if (!box || !id || !vote || box.dataset.busy === "1") return;

    box.dataset.busy = "1";
    box.querySelectorAll("[data-rate]").forEach((btn) => {
      btn.disabled = true;
    });

    let question = "";
    try {
      question = decodeURIComponent(box.dataset.question || "");
    } catch {
      question = "";
    }

    const ok = await this.#analytics.rateAnswer(id, vote, { question });
    const label = box.querySelector(".msg__rate-label");
    if (ok) {
      box.classList.add("msg__rate--done");
      if (label) {
        label.textContent =
          vote === "useful"
            ? "Gracias. Esto nos ayuda a ver qué responde bien."
            : "Gracias. Revisaremos esta pregunta en el dashboard.";
      }
      return;
    }

    box.dataset.busy = "";
    box.classList.add("msg__rate--error");
    box.querySelectorAll("[data-rate]").forEach((btn) => {
      btn.disabled = false;
    });
    if (label) label.textContent = "No se pudo guardar la calificación. Inténtalo de nuevo.";
  }

  /** Flujo de una pregunta, de principio a fin. */
  async #handleQuestion(question) {
    if (this.#busy) return; // evita envíos dobles
    this.#busy = true;

    this.#chips.hide();
    this.#view.addUserMessage(question);
    this.#view.showTyping();
    this.#articlesPanel.showLoading();

    // Chat + artículos en paralelo (artículos = solo lectura pública WP)
    const [response, articles] = await Promise.all([
      this.#service.ask(question),
      this.#articles.recommend(question),
    ]);

    this.#view.hideTyping();
    const interactionId =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}`;
    this.#view.addBotMessage({ ...response, interactionId, question });
    this.#analytics.trackQuestion(question, response, interactionId);

    if (response?.video?.youtube_id) {
      this.#player.load(response.video, { autoplay: false });
    }

    this.#articlesPanel.render(articles, question);

    const areaId = response?.lifeArea?.id ?? null;
    if (areaId) {
      this.#lifeAreasPanel.highlight(areaId);
    } else {
      const match = await this.#lifeAreas.matchQuestion(question);
      if (match?.id) this.#lifeAreasPanel.highlight(match.id);
    }

    this.#busy = false;
  }
}

new App().init();

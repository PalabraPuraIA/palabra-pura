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

import { ChatService } from "./services/ChatService.js";
import { ArticleService } from "./services/ArticleService.js";
import { ChatView } from "./ui/ChatView.js";
import { Composer } from "./ui/Composer.js";
import { ExampleChips } from "./ui/ExampleChips.js";
import { ConnectModal } from "./ui/ConnectModal.js";
import { VideoPlayer } from "./ui/VideoPlayer.js";
import { ArticlesPanel } from "./ui/ArticlesPanel.js";
import { LifeAreasPanel } from "./ui/LifeAreasPanel.js";
import { LifeAreaService } from "./services/LifeAreaService.js";
import { AnalyticsService } from "./services/AnalyticsService.js";

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

    this.#view.addBotMessage({ answer: config.welcomeMessage });
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
    this.#view.addBotMessage(response);
    this.#analytics.trackQuestion(question, response);

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

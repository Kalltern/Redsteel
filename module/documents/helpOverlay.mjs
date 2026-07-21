export class HelpOverlay {
  static toggle() {
    const existing = document.getElementById("redsteel-help-overlay");
    if (existing) existing.remove();
    else this.render();
  }

  static getCombatRoundContent() {
    return `
    <div class="help-category">
      <h2 class="category-title">
        ${game.i18n.localize("REDSTEEL.Help.CombatRound.Title")}
      </h2>

      <div class="card-body">
        ${game.i18n.localize("REDSTEEL.Help.CombatRound.Description")}
      </div>
    </div>
  `;
  }

  static render() {
    const overlay = document.createElement("div");
    overlay.id = "redsteel-help-overlay";

    const grouped = {};
    const CATEGORY_ORDER = ["movement", "combat", "magic", "other"];

    // Group actions
    for (const action of HELP_ACTIONS) {
      if (!grouped[action.type]) grouped[action.type] = [];
      grouped[action.type].push(action);
    }

    // Build rows
    const rows = CATEGORY_ORDER.filter((type) => grouped[type])
      .map((type) => {
        const actions = grouped[type];

        const labelType = game.i18n.localize(`REDSTEEL.Help.Category.${type}`);

        const cards = actions
          .map((action) => {
            const labelName = game.i18n.localize(
              `REDSTEEL.Help.Action.${action.name}`,
            );
            const labelCost = game.i18n.localize(
              `REDSTEEL.Help.Cost.${action.cost}`,
            );
            const labelDescription = game.i18n.localize(
              `REDSTEEL.Help.Description.${action.description}`,
            );
            const cost = game.i18n.localize(`REDSTEEL.Help.Category.cost`);

            return `
              <div class="help-card">

                <div class="card-header">
                  <h3>${labelName}</h3>
                </div>

                <div class="card-meta">
                  <span><b>${cost}:</b> ${labelCost}</span>
                </div>

                <div class="card-body">
                  ${labelDescription}
                </div>

              </div>
            `;
          })
          .join("");

        return `
          <div class="help-category">

            <h2 class="category-title">${labelType}</h2>

            <div class="category-row">
              ${cards}
            </div>

          </div>
        `;
      })
      .join("");

    overlay.innerHTML = `
  <div class="help-board">

    <div class="help-tabs">
      <button class="tab-button active" data-tab="general">
        ${game.i18n.localize("REDSTEEL.Help.Tab.GeneralActions")}
      </button>
      <button class="tab-button" data-tab="round">
        ${game.i18n.localize("REDSTEEL.Help.Tab.CombatRound")}
      </button>
    </div>

    <div class="tab-content active" data-content="general">
      ${rows}
    </div>

    <div class="tab-content" data-content="round">
      ${this.getCombatRoundContent()}
    </div>

  </div>
`;

    document.body.appendChild(overlay);

    const buttons = overlay.querySelectorAll(".tab-button");
    const contents = overlay.querySelectorAll(".tab-content");

    buttons.forEach((btn) => {
      btn.addEventListener("click", () => {
        const target = btn.dataset.tab;

        // Update buttons
        buttons.forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");

        // Update content
        contents.forEach((c) => {
          c.classList.toggle("active", c.dataset.content === target);
        });
      });
    });

    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) overlay.remove();
    });

    const escHandler = (e) => {
      if (e.key === "Escape") {
        overlay.remove();
        document.removeEventListener("keydown", escHandler);
      }
    };

    document.addEventListener("keydown", escHandler);
  }

  static getCombatRoundContent() {
    const t = (key) => game.i18n.localize(`REDSTEEL.Help.Round.${key}`);

    return `
    <div class="help-category">

      <h2 class="category-title">
        ${game.i18n.localize("REDSTEEL.Help.CombatRound.Title")}
      </h2>

      <div class="category-row">

        <div class="help-card">
          <div class="card-header">
            <h3>${t("Step1.Title")}</h3>
          </div>
          <div class="card-body">
            <ul>
              <li>${t("Step1.Effects")}</li>
              <li>${t("Step1.Initiative")}</li>
            </ul>
          </div>
        </div>

        <div class="help-card">
          <div class="card-header">
            <h3>${t("Step2.Title")}</h3>
          </div>
          <div class="card-body">
            ${t("Step2.Intro")}<br><br>
            ${t("Step2.YouHave")}
            <ul>
              <li>${t("Step2.Actions")}</li>
              <li>${t("Step2.FreeActions")}</li>
              <li>${t("Step2.Limit")}</li>
            </ul>
          </div>
        </div>

        <div class="help-card">
          <div class="card-header">
            <h3>${t("Step3.Title")}</h3>
          </div>
          <div class="card-body">
            ${t("Step3.Intro")}
            <ul>
              <li>${t("Step3.Opportunity")}</li>
              <li>${t("Step3.Counter")}</li>
              <li>${t("Step3.Spell")}</li>
            </ul>
          </div>
        </div>

        <div class="help-card">
          <div class="card-header">
            <h3>${t("Step4.Title")}</h3>
          </div>
          <div class="card-body">
            ${t("Step4.End")}<br>
            ${t("Step4.NoEnemies")}<br>
            ${t("Step4.EarlyEnd")}
          </div>
        </div>

      </div>

      <h2 class="category-title" style="margin-top: 30px;">
        ${t("Rules.Title")}
      </h2>

      <div class="category-row">

 <div class="help-card">
  <div class="card-header">
    <h3>${t("Rules.DelayTurn.DelayTitle")}</h3>
  </div>
  <div class="card-body">
    <ul>
      <li>${t("Rules.DelayTurn.DelayText1")}</li>
      <li>${t("Rules.DelayTurn.DelayText2")}</li>
      <li>${t("Rules.DelayTurn.DelayText3")}</li>
    </ul>
  </div>
</div>

<div class="help-card">
  <div class="card-header">
    <h3>${t("Rules.Difficulties.DifficultyTitle")}</h3>
  </div>
  <div class="card-body">
    <ul>
      <li>${t("Rules.Difficulties.DifficultyText1")}</li>
      <li>${t("Rules.Difficulties.DifficultyText2")}</li>
      <li>${t("Rules.Difficulties.DifficultyText3")}</li>
      <li>${t("Rules.Difficulties.DifficultyText4")}</li>
      <li>${t("Rules.Difficulties.DifficultyText5")}</li>
      <li>${t("Rules.Difficulties.DifficultyText6")}</li>
      <li>${t("Rules.Difficulties.DifficultyText7")}</li>
    </ul>
  </div>
</div>

<div class="help-card">
  <div class="card-header">
    <h3>${t("Rules.VersusTests.VersusTitle")}</h3>
  </div>
  <div class="card-body">
    <ul>
      <li>${t("Rules.VersusTests.VersusText1")}</li>
      <li>${t("Rules.VersusTests.VersusText2")}</li>
      <li>${t("Rules.VersusTests.VersusText3")}</li>
      <li>${t("Rules.VersusTests.VersusText4")}</li>      
    </ul>
  </div>
</div>

<div class="help-card">
  <div class="card-header">
    <h3>${t("Rules.Rerolls.RerollsTitle")}</h3>
  </div>
  <div class="card-body">
    <ul>
      <li>${t("Rules.Rerolls.RerollsText1")}</li>
      <li>${t("Rules.Rerolls.RerollsText2")}</li>
      <li>${t("Rules.Rerolls.RerollsText3")}</li>
    </ul>
  </div>
</div>
    </div>
  `;
  }
}

const HELP_ACTIONS = [
  {
    name: "move",
    cost: "oneAction",
    type: "movement",
    description: "move",
  },
  {
    name: "sprint",
    cost: "twoActions",
    type: "movement",
    description: "sprint",
  },
  {
    name: "slowMove",
    cost: "oneAction",
    type: "movement",
    description: "slowMove",
  },
  {
    name: "disengage",
    cost: "twoActions",
    type: "movement",
    description: "disengage",
  },

  {
    name: "aim",
    cost: "oneAction",
    type: "combat",
    description: "aim",
  },
  {
    name: "improvedAim",
    cost: "oneAction",
    type: "combat",
    description: "improvedAim",
  },
  {
    name: "attack",
    cost: "oneAction",
    type: "combat",
    description: "attack",
  },
  {
    name: "sneakAttack",
    cost: "freeAction",
    type: "combat",
    description: "sneakAttack",
  },
  {
    name: "multiAttack",
    cost: "twoActions",
    type: "combat",
    description: "multiAttack",
  },
  {
    name: "opportunityAttack",
    cost: "reaction",
    type: "combat",
    description: "opportunityAttack",
  },

  {
    name: "action",
    cost: "oneAction",
    type: "other",
    description: "action",
  },

  {
    name: "dodge",
    cost: "freeAction",
    type: "combat",
    description: "dodge",
  },

  {
    name: "rest",
    cost: "oneAction",
    type: "other",
    description: "rest",
  },
  {
    name: "reload",
    cost: "reload",
    type: "other",
    description: "reload",
  },

  {
    name: "castSpell",
    cost: "variable",
    type: "magic",
    description: "castSpell",
  },
  {
    name: "reactionSpell",
    cost: "reaction",
    type: "magic",
    description: "reactionSpell",
  },
  {
    name: "focus",
    cost: "oneAction",
    type: "magic",
    description: "focus",
  },
];

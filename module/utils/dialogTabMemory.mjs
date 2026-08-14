/**
 * Per-user memory of the last tab opened in a tabbed dialog.
 *
 * Stored on the user document (flags.redsteel.lastDialogTabs) so every player
 * keeps their own choice and it survives a reload. Reads are local and
 * synchronous; the write is fire-and-forget so tab switching stays instant.
 */

const FLAG_SCOPE = "redsteel";
const FLAG_KEY = "lastDialogTabs";

function getRememberedTab(key) {
  return game.user?.getFlag(FLAG_SCOPE, FLAG_KEY)?.[key] ?? null;
}

function rememberTab(key, tabId) {
  if (!game.user || !tabId) return;
  const stored = game.user.getFlag(FLAG_SCOPE, FLAG_KEY) ?? {};
  if (stored[key] === tabId) return;
  game.user
    .setFlag(FLAG_SCOPE, FLAG_KEY, { ...stored, [key]: tabId })
    .catch((err) => console.warn("Redsteel | Could not store last tab", err));
}

/**
 * Wire up a `.tab-headers` / `.tab-content` pair: open the tab this user last
 * used (falling back to the first one when it no longer exists), and record
 * every switch from then on.
 *
 * @param {jQuery} html   The dialog's rendered content.
 * @param {string} key    Identifier for this dialog, e.g. "combat-abilities".
 */
export function setupDialogTabs(html, key) {
  const $tabs = html.find(".tab-item");
  if (!$tabs.length) return;

  const activate = (tabId) => {
    html.find(".tab-item").removeClass("active");
    html.find(`.tab-item[data-tab="${tabId}"]`).addClass("active");
    html.find(".tab-pane").removeClass("active");
    html.find(`.tab-pane[data-tab="${tabId}"]`).addClass("active");
  };

  const remembered = getRememberedTab(key);
  const $remembered = $tabs.filter(
    (_, el) => String(el.dataset.tab) === String(remembered),
  );
  const initial = ($remembered.length ? $remembered : $tabs.first()).data("tab");
  activate(initial);

  $tabs.on("click", function () {
    const tabId = $(this).data("tab");
    activate(tabId);
    rememberTab(key, tabId);
  });
}

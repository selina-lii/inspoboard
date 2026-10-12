// Vault settings. Each setting applies at once.

import { BACKUP_ALERT_RANGE, PAGE_WIDTH_RANGE, UI_FONT_WEIGHT_RANGE, type ThemeSetting } from "../../io/settings";
import { MovablePanel } from "../app/movable";
import { useEffect, useState, type ReactNode } from "react";
import { CommitField } from "../app/fields";
import { useSession, useSessionState } from "../app/sessionContext";
import { PluginSettings } from "../plugins/PluginSettings";
import { FOLDED_BUTTONS, ZEN_BUTTONS } from "../app/zen";
import { usePlugins } from "../plugins/pluginsContext";
import { isUiLanguage, UI_LANGUAGES } from "../i18n/i18n";
import "./dialogs.css";

export type SettingsSection = "appearance" | "cards" | "topBar" | "zen" | "you" | "plugins";

/** The sections of Settings: a tab for each, in the left column. */
const SECTIONS: readonly { id: SettingsSection; label: string }[] = [
  { id: "appearance", label: "Appearance" },
  { id: "cards", label: "Cards and pages" },
  { id: "topBar", label: "Top bar" },
  { id: "zen", label: "Zen mode" },
  { id: "you", label: "Name and backups" },
  { id: "plugins", label: "Plugins" },
];

export function SettingsDialog({ section: firstSection = "appearance", onClose }: { section?: SettingsSection; onClose(): void }) {
  const session = useSession();
  const { settings } = useSessionState();
  const plugins = usePlugins();
  const [section, setSection] = useState<SettingsSection>(firstSection);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="dialog-backdrop" onMouseDown={onClose}>
      <MovablePanel className="dialog settings" titleClassName="dialog-title" label="Settings" title="Settings" onMouseDown={(event) => event.stopPropagation()}>
        <div className="settings-body">
          <nav className="settings-tabs" role="tablist" aria-label="Settings sections">
            {SECTIONS.map((entry) => (
              <button key={entry.id} role="tab" aria-selected={section === entry.id} className={section === entry.id ? "active" : ""} onClick={() => setSection(entry.id)}>
                {entry.label}
              </button>
            ))}
          </nav>
          <div className="settings-section" role="tabpanel">
            {section === "appearance" && (
              <>
                <label className="setting">
                  <SettingName tip="System follows the computer. The sun/moon button in the top bar also switches it.">Theme</SettingName>
                  <select value={settings.theme} onChange={(event) => void session.updateSettings({ theme: event.target.value as ThemeSetting })}>
                    <option value="system">System</option>
                    <option value="dark">Dark</option>
                    <option value="light">Light</option>
                  </select>
                </label>
                <label className="setting">
                  <SettingName tip="Menus, buttons, and panels. Double-click the slider for normal (400).">Font weight</SettingName>
                  <span className="setting-unit">
                    <input
                      type="range"
                      min={UI_FONT_WEIGHT_RANGE.min}
                      max={UI_FONT_WEIGHT_RANGE.max}
                      step={50}
                      value={settings.uiFontWeight}
                      onChange={(event) => void session.updateSettings({ uiFontWeight: Number(event.target.value) })}
                      onDoubleClick={() => void session.updateSettings({ uiFontWeight: 400 })}
                    />
                    <span className="setting-value">{settings.uiFontWeight}</span>
                  </span>
                </label>
                <label className="setting">
                  <SettingName tip="Menus, buttons, and tips. Your notes do not change.">Language</SettingName>
                  <select
                    translate="no"
                    value={isUiLanguage(settings.uiLanguage) ? settings.uiLanguage : "en"}
                    onChange={(event) => void session.updateSettings({ uiLanguage: event.target.value })}
                  >
                    {UI_LANGUAGES.map((language) => (
                      <option key={language.id} value={language.id}>
                        {language.name}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            )}
            {section === "cards" && (
              <>
                <label className="setting text-setting">
                  <SettingName tip="The width of the text on a page. You can also drag an edge of the text (double-click an edge: 760).">Page width</SettingName>
                  <span className="setting-unit">
                    <CommitField
                      className="setting-input narrow"
                      value={String(settings.pageWidth)}
                      placeholder="760"
                      onCommit={(text) => {
                        const width = Math.round(Number(text.trim()));
                        if (Number.isFinite(width) && width > 0) void session.updateSettings({ pageWidth: Math.min(PAGE_WIDTH_RANGE.max, Math.max(PAGE_WIDTH_RANGE.min, width)) });
                      }}
                    />
                    px
                  </span>
                </label>
                <label className="setting">
                  <input
                    type="checkbox"
                    checked={settings.showItemTitle}
                    onChange={(event) => void session.updateSettings({ showItemTitle: event.target.checked })}
                  />
                  <span>Item title</span>
                </label>
                <label className="setting">
                  <input
                    type="checkbox"
                    checked={settings.showItemDates}
                    onChange={(event) => void session.updateSettings({ showItemDates: event.target.checked })}
                  />
                  <span>Item dates</span>
                </label>
                <label className="setting">
                  <input
                    type="checkbox"
                    checked={settings.readerInvertImages}
                    onChange={(event) => void session.updateSettings({ readerInvertImages: event.target.checked })}
                  />
                  <SettingName tip="With inverted colors (the contrast button of a web page): the pictures invert too. Off: pictures keep their colors. Pictures in a PDF always invert (they are part of the page).">Inverted colors: invert pictures too</SettingName>
                </label>
              </>
            )}
            {section === "topBar" && (
              <div className="setting setting-block">
                <SettingName tip="The other buttons are in the More menu (⋯) at the right of the top bar.">Always show in the top bar</SettingName>
                <span className="zen-buttons">
                  {FOLDED_BUTTONS.map((button) => (
                    <label key={button.id}>
                      <input
                        type="checkbox"
                        checked={settings.topBarButtons.includes(button.id)}
                        onChange={(event) =>
                          void session.updateSettings({
                            topBarButtons: event.target.checked ? [...settings.topBarButtons, button.id] : settings.topBarButtons.filter((id) => id !== button.id),
                          })
                        }
                      />
                      {button.label}
                    </label>
                  ))}
                </span>
              </div>
            )}
            {section === "zen" && (
              <div className="setting setting-block">
                <SettingName tip="Zen mode (in the More menu ⋯, or ⌃⌘Z) hides the bars and shows only these buttons. Esc ends it.">Zen mode buttons</SettingName>
                <span className="zen-buttons">
                  {ZEN_BUTTONS.map((button) => (
                    <label key={button.id}>
                      <input
                        type="checkbox"
                        checked={settings.zenButtons.includes(button.id)}
                        onChange={(event) =>
                          void session.updateSettings({
                            zenButtons: event.target.checked ? [...settings.zenButtons, button.id] : settings.zenButtons.filter((id) => id !== button.id),
                          })
                        }
                      />
                      {button.label}
                    </label>
                  ))}
                </span>
              </div>
            )}
            {section === "you" && (
              <>
                <label className="setting text-setting">
                  <SettingName tip="The signature on your comments.">Your name</SettingName>
                  <CommitField className="setting-input" value={settings.userName} placeholder="Name" onCommit={(name) => void session.updateSettings({ userName: name.trim() })} />
                </label>
                <label className="setting text-setting">
                  <SettingName tip="“Back up” warns when one backup is larger than this.">Backup alert</SettingName>
                  <span className="setting-unit">
                    <CommitField
                      className="setting-input narrow"
                      value={String(Math.round((settings.backupAlertMB / 1024) * 100) / 100)}
                      placeholder="1"
                      onCommit={(text) => {
                        const gigabytes = Number(text.trim());
                        if (Number.isFinite(gigabytes) && gigabytes > 0) void session.updateSettings({ backupAlertMB: Math.max(BACKUP_ALERT_RANGE.min, Math.round(gigabytes * 1024)) });
                      }}
                    />
                    GB
                  </span>
                </label>
              </>
            )}
            {section === "plugins" && (plugins.available ? <PluginSettings /> : <div className="setting setting-help">Plugins work only in the app.</div>)}
          </div>
        </div>
      </MovablePanel>
    </div>
  );
}

/** The name of a setting. Its details show as a tooltip (a dotted line under the name shows that it has one). */
function SettingName({ tip, children }: { tip: string; children: ReactNode }) {
  return (
    <span className="setting-name has-tip" data-tip={tip}>
      {children}
    </span>
  );
}
